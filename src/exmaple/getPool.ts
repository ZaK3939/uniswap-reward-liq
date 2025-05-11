import { Currency } from '@uniswap/sdk-core';
import type { Address, PublicClient } from 'viem';
import { zeroAddress } from 'viem';
import { getPublicClient } from '../utils/client';
import { STATE_VIEW_ABI } from '../abis';
import { CONTRACTS } from '../config/config';
import { Pool } from '@uniswap/v4-sdk';

/**
 * Type definition for pool data
 */
interface PoolData {
  /** First token */
  token0: Currency;
  /** Second token */
  token1: Currency;
  /** Fee rate */
  fee: number;
  /** Tick spacing */
  tickSpacing: number;
  /** Hook address */
  hooks: Address;
  /** Current square root price */
  sqrtPriceX96: bigint;
  /** Current pool liquidity */
  liquidity: bigint;
  /** Current tick */
  tick: number;
}

/**
 * Get pool state from the StateView contract
 * @param poolId Pool ID
 * @param publicClient PublicClient
 * @returns Pool data [sqrtPriceX96, tick, liquidityRaw]
 */
export async function getPoolStateFromStateView(
  poolId: string,
  publicClient?: PublicClient,
): Promise<[bigint, number, bigint]> {
  const client = publicClient || getPublicClient();

  try {
    // Fetch slot0 and liquidity in parallel
    const [slot0, liquidityRaw] = await Promise.all([
      client.readContract({
        address: CONTRACTS.STATE_VIEW,
        abi: STATE_VIEW_ABI,
        functionName: 'getSlot0',
        args: [poolId as `0x${string}`],
      }),
      client.readContract({
        address: CONTRACTS.STATE_VIEW,
        abi: STATE_VIEW_ABI,
        functionName: 'getLiquidity',
        args: [poolId as `0x${string}`],
      }),
    ]);

    // slot0 returns [sqrtPriceX96, tick, protocolFee, lpFee]
    // Only using the first two values
    const sqrtPriceX96 = (slot0 as any)[0] as bigint;
    const tick = (slot0 as any)[1] as number;

    return [sqrtPriceX96, tick, liquidityRaw as bigint];
  } catch (error) {
    console.error('Failed to fetch pool state:', error);
    return [0n, 0, 0n]; // Fallback values in case of error
  }
}

/**
 * Get pool data
 * @param token0 First token
 * @param token1 Second token
 * @param fee Fee tier
 * @param tickSpacing Tick spacing
 * @param hookAddress Hook address
 * @returns Pool data
 */
export async function getPoolData(
  token0: Currency,
  token1: Currency,
  fee: number,
  tickSpacing: number,
  hookAddress: Address = zeroAddress,
): Promise<PoolData> {
  try {
    const poolId = Pool.getPoolId(token0, token1, fee, tickSpacing, hookAddress);

    // Get pool state from StateView
    const [sqrtPriceX96, tick, liquidity] = await getPoolStateFromStateView(poolId);

    // Construct pool data
    const poolData: PoolData = {
      token0,
      token1,
      fee,
      tickSpacing,
      hooks: hookAddress,
      sqrtPriceX96,
      liquidity,
      tick,
    };

    return poolData;
  } catch (error) {
    console.error('Failed to fetch pool data:', error);

    // Fallback values in case of error
    return {
      token0,
      token1,
      fee,
      tickSpacing,
      hooks: hookAddress,
      sqrtPriceX96: 0n,
      liquidity: 0n,
      tick: 0,
    };
  }
}
