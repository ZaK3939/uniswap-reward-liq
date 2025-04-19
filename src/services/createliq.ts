import { Percent } from '@uniswap/sdk-core';
import { tickToPrice, Pool, Position, V4PositionManager } from '@uniswap/v4-sdk';
import type { Address } from 'viem';
import { formatUnits, parseUnits, zeroAddress } from 'viem';
import { getPublicClient, getWalletAccount, getWalletClient } from '../utils/client';
import { TX_CONFIG, CONTRACTS, BOT_ADDRESS, PERMIT2_DOMAIN, PERMIT2_TYPES } from '../config/config';
import { getPositionInfo, getV4Positions } from './positions';
import logger from '../utils/logger';
import type { CreatePositionParams, CreatePositionResult } from '../types';
import { unichain } from '../config/chains';
import { ERC20_ABI, PERMIT2_ABI, POSITION_MANAGER_ABI } from '../abis';
export async function createPosition(params: CreatePositionParams): Promise<CreatePositionResult> {
  // ─── 1) Client & Account ───
  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const chainId = await walletClient.getChainId();
  const account = getWalletAccount();
  if (chainId !== unichain.id) {
    throw new Error(`Chain ID mismatch: expected ${unichain.id}, got ${chainId}`);
  }
  const owner = BOT_ADDRESS;
  if (!owner) throw new Error('Wallet not connected');

  // ─── 2) Parameter extraction ───
  const {
    poolData,
    amount0,
    amount1,
    tickLower,
    tickUpper,
    slippageTolerance = TX_CONFIG.SLIPPAGE_TOLERANCE,
    deadline = Math.floor(Date.now() / 1_000) + 30 * 60,
  } = params;

  // ─── 3) Token & Pool information ───
  const token0 = poolData.token0;
  const token1 = poolData.token1;
  const token0Address = token0.address;
  const token1Address = token1.address;
  logger.info(`Creating ${token0.symbol}/${token1.symbol} @ fee=${poolData.fee / 10000}%`);

  // ─── 4) Pool & Position instances ───
  const pool = new Pool(
    poolData.token0,
    poolData.token1,
    poolData.fee,
    poolData.tickSpacing,
    zeroAddress,
    poolData.sqrtPriceX96.toString(),
    poolData.liquidity.toString(),
    poolData.tick,
  );

  // Parse values reliably
  logger.info(`amount0: ${amount0.toString()}, amount1: ${amount1.toString()}`);
  logger.info(
    `Creating position with amounts: ${formatUnits(amount0, token0.decimals)} ${token0.symbol}, ${formatUnits(
      amount1,
      token1.decimals,
    )} ${token1.symbol}`,
  );

  // Calculate liquidity precisely
  const pos = Position.fromAmounts({
    pool,
    tickLower,
    tickUpper,
    amount0: amount0.toString(),
    amount1: amount1.toString(),
    useFullPrecision: true,
  });
  logger.info(`amount0: ${amount0.toString()}, amount1: ${amount1.toString()}`);
  logger.info(`Position liquidity: ${pos.liquidity.toString()}`);
  logger.info(
    `Price range: ${tickToPrice(pool.token0, pool.token1, tickLower).toSignificant(6)} - ${tickToPrice(
      pool.token0,
      pool.token1,
      tickUpper,
    ).toSignificant(6)}`,
  );

  const MAX_UINT256 = 2n ** 256n - 1n;
  const approval0 = (await publicClient.readContract({
    address: token0Address as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, CONTRACTS.PERMIT2],
  })) as bigint;

  // Check token1 approval
  const approval1 = (await publicClient.readContract({
    address: token1Address as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, CONTRACTS.PERMIT2],
  })) as bigint;

  if (approval0 < parseUnits(amount0.toString(), token0.decimals) * 2n) {
    logger.info(`Approving ${token0.symbol} to Permit2...`);
    const approveTx0 = await walletClient.writeContract({
      account: getWalletAccount(),
      address: token0Address as Address,
      abi: ERC20_ABI,
      chain: unichain,
      functionName: 'approve',
      args: [CONTRACTS.PERMIT2, MAX_UINT256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx0 });
    logger.info(`${token0.symbol} approved to Permit2`);
  } else {
    logger.info(`${token0.symbol} already has sufficient approval to Permit2`);
  }

  // If token1 approval is insufficient, approve it
  if (approval1 < parseUnits(amount1.toString(), token1.decimals) * 2n) {
    logger.info(`Approving ${token1.symbol} to Permit2...`);
    const approveTx1 = await walletClient.writeContract({
      account: getWalletAccount(),
      address: token1Address as Address,
      abi: ERC20_ABI,
      chain: unichain,
      functionName: 'approve',
      args: [CONTRACTS.PERMIT2, MAX_UINT256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx1 });
    logger.info(`${token1.symbol} approved to Permit2`);
  } else {
    logger.info(`${token1.symbol} already has sufficient approval to Permit2`);
  }

  // ─── 5) Slippage settings ───
  const slippagePct = new Percent(Math.floor(slippageTolerance * 100), 10_000);
  logger.info(`Slippage tolerance: ${slippagePct.toFixed(2)}%`);

  // ─── 6) Get Permit2 nonce ───
  // Get nonce for token0
  const allowance0 = await publicClient.readContract({
    address: CONTRACTS.PERMIT2,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [owner, token0Address as Address, CONTRACTS.POSITION_MANAGER],
  });
  const nonce0 = allowance0[2]; // [amount, expiration, nonce]

  // Get nonce for token1
  const allowance1 = await publicClient.readContract({
    address: CONTRACTS.PERMIT2,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [owner, token1Address as Address, CONTRACTS.POSITION_MANAGER],
  });
  const nonce1 = allowance1[2]; // [amount, expiration, nonce]

  // ─── 7) Create permission data ───
  // Set maximum value (2^160-1)
  const MAX_UINT160 = 2n ** 160n - 1n;
  // Create permit2 details data
  const permit = {
    details: [
      {
        token: token0.address,
        amount: MAX_UINT160.toString(),
        expiration: deadline.toString(),
        nonce: nonce0.toString(),
      },
      {
        token: token1.address,
        amount: MAX_UINT160.toString(),
        expiration: deadline.toString(),
        nonce: nonce1.toString(),
      },
    ],
    spender: CONTRACTS.POSITION_MANAGER,
    sigDeadline: deadline.toString(),
  };

  // ─── 8) Create EIP-712 signature ───
  const signature = await walletClient.signTypedData({
    account,
    domain: PERMIT2_DOMAIN(chainId),
    types: PERMIT2_TYPES,
    primaryType: 'PermitBatch',
    message: permit,
  });

  // ─── 9) Create transaction ───
  logger.info(`Calculating add liquidity parameters...`);
  // Get basic liquidity addition parameters without batch Permit
  const { calldata: liqCalldata, value: rawLiqValue } = V4PositionManager.addCallParameters(pos, {
    slippageTolerance: slippagePct,
    recipient: owner as Address,
    deadline: deadline.toString(),
    // Remove to process permits individually
    batchPermit: {
      owner: owner as Address,
      permitBatch: permit,
      signature,
    },
  });

  // Process value
  const liqValue = Array.isArray(rawLiqValue) ? rawLiqValue[0] : rawLiqValue;
  logger.info(`Liquidity value: ${liqValue}`);

  // ─── 10) Send transaction ───
  const calls = [liqCalldata];

  // Explicitly increase gas limit
  const txHash = await walletClient.writeContract({
    account,
    address: CONTRACTS.POSITION_MANAGER as Address,
    chain: unichain,
    abi: POSITION_MANAGER_ABI,
    functionName: 'multicall',
    args: [calls],
    value: BigInt(liqValue),
  });

  logger.info(`Transaction sent: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === 'success') {
    logger.info(`Transaction confirmed: ${receipt.transactionHash}`);

    // ─── 11) Get position & return result ───
    const latest = receipt.logs[2].topics[3] as string;
    logger.info(`Latest position: ${latest}`);
    const info = await getPositionInfo(BigInt(latest));

    if (!info) {
      throw new Error('Position info not found');
    }

    return {
      success: true,
      tokenId: info.tokenId,
      liquidity: info.liquidity.toString(),
      amount0Used: info.token0BalanceFormatted,
      amount1Used: info.token1BalanceFormatted,
      tickLower,
      tickUpper,
      priceLower: info.priceLower.toString(),
      priceUpper: info.priceUpper.toString(),
      transactionHash: receipt.transactionHash,
    };
  } else {
    throw new Error(`Transaction failed: ${receipt.transactionHash}`);
  }
}
