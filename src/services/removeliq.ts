import { Pool, Position, RemoveLiquidityOptions, V4PositionManager } from '@uniswap/v4-sdk';
import { DetailPositionInfo } from '../types';
import { getTokenByAddress } from '../config/tokens';
import { getPublicClient, getWalletAccount, getWalletClient } from '../utils/client';
import { POSITION_MANAGER_ABI } from '../abis';
import { CONTRACTS } from '../config/config';
import { unichain } from '../config/chains';
import logger from '../utils/logger';
import { Percent } from '@uniswap/sdk-core';
import JSBI from 'jsbi';
/**
 * Removes a position if it has gone out of range.
 * @param pos         Full position info object
 * @param slippageTolerance  Maximum allowed slippage
 * @param deadline    Unix timestamp after which tx will revert
 */
export async function removePositionIfOutOfRange(pos: DetailPositionInfo, slippageTolerance: number, deadline: bigint) {
  // Reconstruct the Pool instance at current state
  logger.info(`Removing position ${pos.tokenId} iquidity)`);
  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const account = getWalletAccount();
  const token0 = getTokenByAddress(pos.token0);
  const token1 = getTokenByAddress(pos.token1);
  const pool = new Pool(
    token0,
    token1,
    pos.fee,
    pos.tickSpacing,
    pos.hooks,
    pos.sqrtPriceX96,
    0, // liquidity not needed for reading
    pos.currentTick,
  );
  logger.info(`Pool: ${pool.token0.symbol}/${pool.token1.symbol} (${pool.fee}bps)`);
  // Create a Position object for encoding the remove call

  const position = new Position({
    pool,
    liquidity: JSBI.BigInt(pos.liquidity.toString()),
    tickLower: pos.tickLower,
    tickUpper: pos.tickUpper,
  });
  logger.info(`Removing position ${pos.tokenId} (${pos.liquidity.toString()} liquidity)`);
  const slippagePct = new Percent(Math.floor(slippageTolerance * 100), 10_000);
  const removeOpts: RemoveLiquidityOptions = {
    // CommonOptions
    slippageTolerance: slippagePct, // e.g. new Percent(5, 1000)
    deadline: deadline.toString(), // bigint unix seconds
    // ModifyPositionSpecificOptions
    tokenId: pos.tokenId.toString(), // tokenId of the position to remove
    // RemoveLiquiditySpecificOptions
    liquidityPercentage: new Percent(1, 1), // 100% of your position
    burnToken: true, // burn the NFT after exit
    // permit: …                               // only if needed
  };
  // Build calldata and required value for remove + collect
  logger.info(`position: ${JSON.stringify(position)}`);
  const { calldata, value } = V4PositionManager.removeCallParameters(position, removeOpts);
  logger.info(`Remove calldata: ${calldata}`);
  // Send transaction to PositionManager contract
  const txHash = await walletClient.writeContract({
    account,
    address: CONTRACTS.POSITION_MANAGER,
    chain: unichain,
    abi: POSITION_MANAGER_ABI,
    functionName: 'multicall',
    args: [[calldata]],
    value: BigInt(value.toString()),
  });
  logger.info(`Transaction sent: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { status: 'removed', tokenId: pos.tokenId, txHash: receipt.transactionHash };
}
