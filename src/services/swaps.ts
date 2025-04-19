import { Percent, CurrencyAmount, TradeType, Token } from '@uniswap/sdk-core';
import { Trade, Pool } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import type { Address } from 'viem';
import { encodeFunctionData, formatUnits, parseUnits, zeroAddress } from 'viem';
import { getPublicClient, getWalletClient, getAccountAddress } from '../utils/client';
import logger from '../utils/logger';
import { CONTRACTS, TX_CONFIG } from '../config/config';
import { getTokenByAddress, TICK_SPACINGS, FeeAmount } from '../config/tokens';
import { UNIVERSAL_ROUTER_ABI, PERMIT2_ABI, V4QUOTER_ABI } from '../abis';
import type { SwapParams, SwapResult } from '../types';
import { unichain } from '../config/chains';
import { SwapRouter, UniswapTrade } from '@uniswap/universal-router-sdk';
import { getPoolData } from './pool';

// --- Helpers ---
async function buildPermit2Calldata(owner: Address, token: Address, amount: bigint, deadline: number): Promise<string> {
  const publicClient = getPublicClient();

  // Fetch nonce
  const [, , nonce] = await publicClient.readContract({
    address: CONTRACTS.PERMIT2,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [owner, token, CONTRACTS.PERMIT2],
  });

  const expiry = JSBI.BigInt(deadline.toString());
  const details = [
    {
      token,
      amount: JSBI.BigInt(amount.toString()),
      expiration: expiry,
      nonce: JSBI.BigInt(nonce.toString()),
    },
  ];
  const permitBatch = {
    details,
    spender: CONTRACTS.UNIVERSAL_ROUTER as Address,
    sigDeadline: expiry,
  };

  // Sign EIP-712
  const wallet = getWalletClient();
  const chainId = await wallet.getChainId();
  const domain = { name: 'Permit2', version: '1', chainId, verifyingContract: CONTRACTS.PERMIT2 as Address };
  const types = {
    PermitDetails: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
    PermitBatch: [
      { name: 'details', type: 'PermitDetails[]' },
      { name: 'spender', type: 'address' },
      { name: 'sigDeadline', type: 'uint256' },
    ],
  };

  const signature = await wallet.signTypedData({
    account: owner,
    domain,
    types,
    primaryType: 'PermitBatch',
    message: permitBatch,
  });

  // Encode calldata
  return encodeFunctionData({
    abi: PERMIT2_ABI as any,
    functionName: 'permitBatch',
    args: [owner, permitBatch, signature],
  });
}

// --- Main Execution ---
export async function executeSwap(params: SwapParams): Promise<SwapResult> {
  const {
    tokenIn: inAddr,
    tokenOut: outAddr,
    fee,
    amountIn,
    amountOutMinimum,
    slippageTolerance = TX_CONFIG.SLIPPAGE_TOLERANCE,
    recipient,
    deadline = Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_MINUTES * 60,
  } = params;

  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const owner: Address = (recipient as Address) || getAccountAddress();

  // Initialize tokens
  const tokenIn = getTokenByAddress(inAddr);
  const tokenOut = getTokenByAddress(outAddr);
  logger.info(`Swap: ${tokenIn.symbol} → ${tokenOut.symbol}`);

  // 1) Prepare Permit2 calldata
  const amountBi = BigInt(parseUnits(amountIn, tokenIn.decimals).toString());
  const permitCalldata = await buildPermit2Calldata(owner, tokenIn.address as Address, amountBi, deadline);

  // 2) Build Pool & Trade
  const feeTier = fee;
  const poolData = await getPoolData(tokenIn, tokenOut, feeTier, TICK_SPACINGS[feeTier as FeeAmount], zeroAddress);
  const pool = new Pool(
    tokenIn,
    tokenOut,
    feeTier,
    TICK_SPACINGS[feeTier as FeeAmount],
    poolData.hooks as Address,
    poolData.sqrtPriceX96.toString(),
    poolData.liquidity.toString(),
    poolData.tick,
  );

  const inputAmt = CurrencyAmount.fromRawAmount(tokenIn, amountBi.toString());
  const trade = Trade.createUncheckedTrade({
    route: { input: tokenIn, output: tokenOut, pools: [pool] } as any,
    inputAmount: inputAmt,
    outputAmount: CurrencyAmount.fromRawAmount(tokenOut, '0'),
    tradeType: TradeType.EXACT_INPUT,
  });

  // Compute appropriate slippage tolerance based on amountOutMinimum if provided
  const rt = trade;
  let slippagePC: Percent;
  if (amountOutMinimum) {
    const expectedOutBi = JSBI.BigInt(rt.outputAmount.quotient.toString());
    const minOutBi = JSBI.BigInt(parseUnits(amountOutMinimum, tokenOut.decimals).toString());
    if (JSBI.lessThan(minOutBi, JSBI.BigInt('1'))) {
      throw new Error('amountOutMinimum must be greater than zero');
    }
    // Calculate slippage: (expected - min) / expected
    const diff = JSBI.subtract(expectedOutBi, minOutBi);
    const numerator = JSBI.divide(JSBI.multiply(diff, JSBI.BigInt('10000')), expectedOutBi);
    slippagePC = new Percent(numerator.toString(), 10000);
  } else {
    slippagePC = new Percent((slippageTolerance * 100).toString(), 10000);
  }

  // Wrap in UniswapTrade command using computed slippage
  const routerTrade = new UniswapTrade(trade as any, {
    recipient: owner,
    slippageTolerance: slippagePC,
  });

  // 3) Build swap calldata
  const { calldata: swapCalldata, value: swapValue } = SwapRouter.swapCallParameters([routerTrade], { deadline });

  // 4) Execute multicall: permit2 + swap
  const commands = '0x0102'; // PERMIT2 + V3_SWAP codes
  const typedInputs = [permitCalldata as `0x${string}`, swapCalldata as `0x${string}`];

  const txHash = await walletClient.writeContract({
    account: walletClient.account!,
    address: CONTRACTS.UNIVERSAL_ROUTER as Address,
    chain: unichain,
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [commands, typedInputs, BigInt(deadline)],
    value: BigInt(swapValue),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // 5) Format results
  const inAmt = formatUnits(amountBi, tokenIn.decimals);
  const amountOutRaw = BigInt(
    JSBI.lessThan(
      JSBI.BigInt(routerTrade.trade.outputAmount.quotient.toString()),
      JSBI.BigInt(parseUnits(amountOutMinimum || '0', tokenOut.decimals).toString()),
    )
      ? parseUnits(amountOutMinimum || '0', tokenOut.decimals).toString()
      : routerTrade.trade.outputAmount.quotient.toString(),
  );
  const outAmt = formatUnits(amountOutRaw, tokenOut.decimals);

  return {
    success: true,
    amountIn: inAmt,
    amountOut: outAmt,
    transactionHash: receipt.transactionHash,
    effectivePrice: (Number(inAmt) / Number(outAmt)).toFixed(8),
  };
}

export async function quoteExactInputSingleV4(
  tokenIn: Address,
  tokenOut: Address,
  amountInHuman: string,
  feeTier: number = 3000,
  hooks: Address = zeroAddress,
): Promise<{ amountOutHuman: string; gasEstimate: bigint }> {
  const client = getPublicClient();
  const inToken = getTokenByAddress(tokenIn);
  const outToken = getTokenByAddress(tokenOut);

  const exactAmount = BigInt(parseUnits(amountInHuman, inToken.decimals).toString());
  const zeroForOne = tokenIn.toLowerCase() < tokenOut.toLowerCase();
  const hookData = '0x' as `0x${string}`;

  const params = {
    poolKey: {
      currency0: tokenIn,
      currency1: tokenOut,
      fee: feeTier,
      tickSpacing: TICK_SPACINGS[feeTier as FeeAmount],
      hooks,
    },
    zeroForOne,
    exactAmount,
    hookData,
  };

  const [amountOut, gasEstimate] = (await client.simulateContract({
    address: CONTRACTS.V4QUOTER,
    abi: V4QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [params],
  })) as unknown as [bigint, bigint];

  return {
    amountOutHuman: formatUnits(amountOut, outToken.decimals),
    gasEstimate,
  };
}
