import { Percent, CurrencyAmount, TradeType, Token } from '@uniswap/sdk-core';
import { Pool, PoolKey, Route, Trade } from '@uniswap/v4-sdk';
import type { Address } from 'viem';
import { decodeErrorResult, encodeAbiParameters, encodePacked, formatUnits, parseUnits, zeroAddress } from 'viem';
import { getPublicClient, getWalletClient, getAccountAddress } from '../utils/client';
import logger from '../utils/logger';
import { CONTRACTS, MAX_UINT160 } from '../config/config';
import { getTokenByAddress, isNative } from '../config/tokens';
import { UNIVERSAL_ROUTER_ABI, PERMIT2_ABI, STATE_VIEW_ABI } from '../abis';
import type { SwapParams, SwapResult } from '../types';
import { unichain } from '../config/chains';
import { getPoolData } from './pool';
import { signPermit2Payload } from './createliq';
import { findClosestInitializedTick } from '../utils/tick/findClosestInitializedTick';

// --- Helpers ---
/**
 * Build Permit2 details for a token
 */
async function buildPermitDetails(
  owner: Address,
  token: Address,
  deadline: bigint,
): Promise<
  {
    token: Address;
    amount: string;
    expiration: string;
    nonce: string;
  }[]
> {
  const details: {
    token: Address;
    amount: string;
    expiration: string;
    nonce: string;
  }[] = [];
  // Skip if native token (ETH)
  if (isNative(token)) {
    logger.info(`Native ETH – skipping Permit2 details: ${token}`);
    return [];
  }

  const publicClient = getPublicClient();

  // Fetch nonce
  const [, , nonce] = (await publicClient.readContract({
    account: getAccountAddress(),
    address: CONTRACTS.PERMIT2,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [owner, token, CONTRACTS.PERMIT2],
  })) as [bigint, bigint, bigint];
  details.push({
    token: token,
    amount: MAX_UINT160.toString(),
    expiration: deadline.toString(),
    nonce: nonce.toString(),
  });
  return details;
}

function encodeV4SwapParams(
  poolKey: PoolKey,
  amountIn: bigint,
  minAmountOut: bigint,
  zeroForOne: boolean = true,
): {
  command: `0x${string}`;
  encodedParams: `0x${string}`;
} {
  // 1.
  // https://docs.uniswap.org/contracts/v4/reference/periphery/libraries/Actions
  const actions = encodePacked(
    ['uint8', 'uint8', 'uint8'],
    [0x06, 0x0c, 0x0f], // Actions: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
  );
  // 2. ExactInputSingleParams
  const exactInputSingleParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          {
            type: 'tuple',
            name: 'poolKey',
            components: [
              { type: 'address', name: 'currency0' },
              { type: 'address', name: 'currency1' },
              { type: 'uint24', name: 'fee' },
              { type: 'int24', name: 'tickSpacing' },
              { type: 'address', name: 'hooks' },
            ],
          },
          { type: 'bool', name: 'zeroForOne' },
          { type: 'uint128', name: 'amountIn' },
          { type: 'uint128', name: 'amountOutMinimum' },
          { type: 'bytes', name: 'hookData' },
        ],
      },
    ],
    [
      {
        poolKey: {
          currency0: poolKey.currency0 as Address,
          currency1: poolKey.currency1 as Address,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: '0x0000000000000000000000000000000000000000',
        },
        zeroForOne,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        hookData: '0x',
      },
    ],
  );

  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const settleInputParams = encodeAbiParameters(
    [
      { type: 'address', name: 'token' },
      { type: 'uint128', name: 'amount' },
    ],
    [inputCurrency as Address, amountIn],
  );

  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;
  const settleOutputParams = encodeAbiParameters(
    [
      { type: 'address', name: 'token' },
      { type: 'uint128', name: 'amount' },
    ],
    [outputCurrency as Address, 0n],
  );

  const params = [exactInputSingleParams, settleInputParams, settleOutputParams];

  const inputs = encodeAbiParameters(
    [
      { type: 'bytes', name: 'actions' },
      { type: 'bytes[]', name: 'params' },
    ],
    [actions, params],
  );

  // https://github.com/Uniswap/universal-router/blob/main/contracts/libraries/Commands.sol
  const commands = encodePacked(['uint8'], [0x10]);

  return {
    command: commands as `0x${string}`,
    encodedParams: inputs as `0x${string}`,
  };
}

// --- Main Execution ---
export async function executeSwap(params: SwapParams): Promise<SwapResult> {
  const { tokenIn: inToken, tokenOut: outToken, poolKey, amountIn, slippageTolerance, deadline } = params;

  try {
    const publicClient = getPublicClient();
    const walletClient = getWalletClient();
    const owner = getAccountAddress();

    // Initialize tokens
    const tokenIn = getTokenByAddress(inToken);
    const tokenOut = getTokenByAddress(outToken);
    logger.info(`Swap: ${tokenIn.symbol} → ${tokenOut.symbol}`);

    // 1) Parse amount
    const amountBi = BigInt(parseUnits(amountIn.toString(), tokenIn.decimals).toString());

    // 2) Build Permit2 details if needed -> skip

    // 3) Build Pool & Trade
    const feeTier = poolKey.fee;
    const tickSpacing = poolKey.tickSpacing;
    const poolData = await getPoolData(tokenIn, tokenOut, feeTier, tickSpacing, zeroAddress);
    logger.info(`currency0: ${poolData.token0.symbol}, currency1: ${poolData.token1.symbol}`);
    const poolId = Pool.getPoolId(poolData.token0, poolData.token1, feeTier, poolData.tickSpacing, zeroAddress);
    logger.info(`Pool ID: ${poolId}`);

    // 4) Get Slot0 data
    const slot0 = (await publicClient.readContract({
      address: CONTRACTS.STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: 'getSlot0',
      args: [poolId as `0x${string}`],
    })) as readonly [bigint, number, number, number];

    let currentTick = slot0[1];

    // 5) Find closest initialized ticks and get tick data
    const initializedTick = await findClosestInitializedTick(publicClient, poolId, currentTick, poolData.tickSpacing);

    const tickData = (await publicClient.readContract({
      address: CONTRACTS.STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: 'getTickInfo',
      args: [poolId as `0x${string}`, initializedTick],
    })) as readonly [bigint, bigint, bigint, bigint];

    // 6) Create tick data array with synthetic tick if needed
    const tickDataArray = [
      {
        index: initializedTick,
        liquidityGross: tickData[0].toString(),
        liquidityNet: tickData[1].toString(),
        feeGrowthOutside0X128: tickData[2].toString(),
        feeGrowthOutside1X128: tickData[3].toString(),
      },
    ];

    if (tickDataArray.length === 1) {
      const syntheticTickIndex =
        initializedTick > currentTick
          ? initializedTick - poolData.tickSpacing * 100 // Below current
          : initializedTick + poolData.tickSpacing * 100; // Above current

      const oppositeLiquidityNet = -BigInt(tickData[1].toString());

      tickDataArray.push({
        index: syntheticTickIndex,
        liquidityGross: tickData[0].toString(),
        liquidityNet: oppositeLiquidityNet.toString(),
        feeGrowthOutside0X128: '0',
        feeGrowthOutside1X128: '0',
      });
    }

    // 7) Create the pool with proper tick data
    const pool = new Pool(
      poolData.token0,
      poolData.token1,
      feeTier,
      poolData.tickSpacing,
      poolData.hooks,
      poolData.sqrtPriceX96.toString(),
      poolData.liquidity.toString(),
      currentTick,
      tickDataArray,
    );

    logger.info(`Pool: ${pool.token0.symbol}/${pool.token1.symbol} (${pool.fee}bps)`);

    // 8) Calculate input and output amounts
    const inputAmt = CurrencyAmount.fromRawAmount(tokenIn, amountBi.toString());
    const [outputAmtWithCurrency, _] = await pool.getOutputAmount(inputAmt);
    const outputAmt = outputAmtWithCurrency as CurrencyAmount<Token>;

    // 9) Create route and trade
    const route = new Route([pool], tokenIn, tokenOut);
    const trade = Trade.createUncheckedTrade({
      route,
      inputAmount: inputAmt,
      outputAmount: outputAmt,
      tradeType: TradeType.EXACT_INPUT,
    });

    // 10) Set slippage tolerance
    const slippagePC = new Percent((slippageTolerance * 100).toString(), 10000);
    logger.info(`Slippage tolerance: ${slippagePC.toFixed(2)}%`);
    const minOutputAmt = trade.minimumAmountOut(slippagePC);

    logger.info(
      `Trade: ${trade.inputAmount.toSignificant(6)} ${
        trade.inputAmount.currency.symbol
      } → ${trade.outputAmount.toSignificant(6)} ${trade.outputAmount.currency.symbol}`,
    );
    logger.info(`Min output (with slippage): ${minOutputAmt.toSignificant(6)} ${trade.outputAmount.currency.symbol}`);
    // 11) TODO: permit2 check -> if needed, pls sign from uniswap frontend
    // 12) Execute transaction
    const swapValue = isNative(tokenIn.address) ? amountBi : 0n;

    // ref https://medium.com/@mujtabarehman123456789/how-to-swap-tokens-on-uniswap-v4-using-the-universal-router-b0e18f1c16b2
    logger.info(`Executing swap only: Command=0x10`);
    logger.info(
      `creating swap command with currency0: ${poolData.token0.address}, currency1: ${poolData.token1.address}`,
    );
    logger.info(`fee: ${feeTier}, tickSpacing: ${poolData.tickSpacing}`);
    logger.info(`amountIn: ${amountBi}, minAmountOut: ${BigInt(minOutputAmt.quotient.toString())}`);
    const zeroForOne = poolData.token0.address === tokenIn.address;
    const { command, encodedParams } = encodeV4SwapParams(
      {
        currency0: poolData.token0.address,
        currency1: poolData.token1.address,
        fee: feeTier,
        tickSpacing: poolData.tickSpacing,
        hooks: '0x0000000000000000000000000000000000000000',
      },
      amountBi,
      BigInt(minOutputAmt.quotient.toString()),
      zeroForOne,
    );

    const txHash = await walletClient.writeContract({
      account: walletClient.account!,
      address: CONTRACTS.UNIVERSAL_ROUTER,
      chain: unichain,
      abi: UNIVERSAL_ROUTER_ABI,
      functionName: 'execute',
      args: [command, [encodedParams]],
      value: swapValue,
    });

    logger.info(`Transaction submitted: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    logger.info(`Transaction confirmed! Gas used: ${receipt.gasUsed}`);

    // 13) Format and return results
    const inAmt = formatUnits(amountBi, tokenIn.decimals);
    const outAmt = outputAmt.toExact();

    return {
      success: true,
      amountIn: inAmt,
      amountOut: outAmt,
      effectivePrice: (Number(inAmt) / Number(outAmt)).toFixed(8),
    };
  } catch (error) {
    logger.error(`Swap failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      success: false,
      error: `Swap failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
