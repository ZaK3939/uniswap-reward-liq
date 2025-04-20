import { Pool } from '@uniswap/v4-sdk';
import { Token, BigintIsh } from '@uniswap/sdk-core';
import JSBI from 'jsbi';
import type { Address, PublicClient } from 'viem';
import { createPublicClient, http, zeroAddress } from 'viem';
import logger from '../utils/logger';
import { CONTRACTS } from '../config/config';
import type { PoolData } from '../types';
import { unichain } from '../config/chains';
import STATE_VIEW_ABI from '../abis/stateView';

export async function getPoolData(
  token0: Token,
  token1: Token,
  fee: number,
  tickSpacing: number,
  hooksAddress: Address = zeroAddress,
): Promise<PoolData> {
  const client: PublicClient = createPublicClient({ chain: unichain, transport: http() });

  const [currency0, currency1] = token0.sortsBefore(token1) ? [token0, token1] : [token1, token0];
  const poolId = Pool.getPoolId(currency0, currency1, fee, tickSpacing, hooksAddress);
  const poolIdBytes = `0x${poolId.slice(2).padStart(64, '0')}` as Address;

  logger.info(`Pool ID: ${poolId}, checking stateView: ${CONTRACTS.STATE_VIEW}`);
  // getSlot0 returns [sqrtPriceX96, tick, obsIndex, cardinality]
  const slot0 = (await client.readContract({
    address: CONTRACTS.STATE_VIEW,
    abi: STATE_VIEW_ABI,
    functionName: 'getSlot0',
    args: [poolIdBytes],
  })) as readonly [bigint, number, number, number];
  const [sqrtPriceX96, currentTick] = slot0;

  // getLiquidity returns bigint
  const liquidityRaw = (await client.readContract({
    address: CONTRACTS.STATE_VIEW,
    abi: STATE_VIEW_ABI,
    functionName: 'getLiquidity',
    args: [poolIdBytes],
  })) as bigint;
  logger.info(
    `sqrtPriceX96: ${sqrtPriceX96.toString()}, currentTick: ${currentTick}, liquidityRaw: ${liquidityRaw.toString()}`,
  );
  const pool = new Pool(
    currency0,
    currency1,
    fee,
    tickSpacing,
    hooksAddress,
    JSBI.BigInt(sqrtPriceX96.toString()) as BigintIsh,
    JSBI.BigInt(liquidityRaw.toString()) as BigintIsh,
    currentTick,
  );

  return {
    token0,
    token1,
    fee: pool.fee,
    poolId,
    hooks: pool.hooks as Address,
    sqrtPriceX96,
    tick: pool.tickCurrent,
    tickSpacing: pool.tickSpacing,
    liquidity: liquidityRaw,
  };
}
