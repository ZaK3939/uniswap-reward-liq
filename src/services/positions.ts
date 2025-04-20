import { Pool, Position, tickToPrice } from '@uniswap/v4-sdk';
import { BigintIsh } from '@uniswap/sdk-core';
import JSBI from 'jsbi';
import type { Address } from 'viem';
import { formatUnits, zeroAddress } from 'viem';
import { getPublicClient } from '../utils/client';
import logger from '../utils/logger';
import { CONTRACTS, UNICHAIN_SUBGRAPH_URL } from '../config/config';
import { getTokenByAddress } from '../config/tokens';
import { POSITION_MANAGER_ABI } from '../abis';
import type { PositionAnalysis, DetailPositionInfo, PositionInfo } from '../types';
import { GET_POSITIONS_QUERY, GRAPH_POSITIONS_RESPONSE } from '../config/query';
import request from 'graphql-request';
import { getPoolData } from './pool';

function fromPositionInfoValue(value: bigint): PositionInfo {
  return {
    value,
    getPoolId: () => value >> 56n,
    getTickUpper: () => {
      const raw = Number((value >> 32n) & 0xffffffn);
      return raw >= 0x800000 ? raw - 0x1000000 : raw;
    },
    getTickLower: () => {
      const raw = Number((value >> 8n) & 0xffffffn);
      return raw >= 0x800000 ? raw - 0x1000000 : raw;
    },
    hasSubscriber: () => (value & 0xffn) !== 0n,
  };
}

export async function getPositionDetails(tokenId: bigint): Promise<{
  tokenId: bigint;
  tickLower: number;
  tickUpper: number;
  token0: Address;
  token1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  liquidity: bigint;
}> {
  const client = getPublicClient();

  // getPoolAndPositionInfo returns a tuple [poolKey, info]
  const raw = (await client.readContract({
    address: CONTRACTS.POSITION_MANAGER as Address,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPoolAndPositionInfo',
    args: [tokenId],
  })) as [
    {
      currency0: Address;
      currency1: Address;
      fee: number;
      tickSpacing: number;
      hooks: Address;
    },
    bigint,
  ];

  const [poolKey, infoValue] = raw;

  // Decode packed info
  const decoded = fromPositionInfoValue(infoValue);

  // Fetch liquidity
  const liquidityRaw = (await client.readContract({
    address: CONTRACTS.POSITION_MANAGER as Address,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getPositionLiquidity',
    args: [tokenId],
  })) as bigint;

  return {
    tokenId,
    tickLower: decoded.getTickLower(),
    tickUpper: decoded.getTickUpper(),
    token0: poolKey.currency0,
    token1: poolKey.currency1,
    fee: poolKey.fee,
    tickSpacing: poolKey.tickSpacing,
    hooks: poolKey.hooks,
    liquidity: liquidityRaw,
  };
}

export async function getPositionInfo(tokenId: bigint): Promise<DetailPositionInfo | undefined> {
  logger.info(`Fetching position info for tokenId: ${tokenId}`);
  const details = await getPositionDetails(tokenId);
  if (!details || !details.liquidity || details.liquidity === 0n) {
    logger.debug(`Skipping position ${tokenId} with zero liquidity`);
    return undefined;
  }
  const token0 = getTokenByAddress(details.token0);
  const token1 = getTokenByAddress(details.token1);
  const poolData = await getPoolData(token0, token1, details.fee, details.tickSpacing, details.hooks);
  const pool = new Pool(
    poolData.token0,
    poolData.token1,
    poolData.fee,
    poolData.tickSpacing,
    zeroAddress,
    JSBI.BigInt(poolData.sqrtPriceX96.toString()) as BigintIsh,
    JSBI.BigInt(poolData.liquidity.toString()) as BigintIsh,
    poolData.tick,
  );
  const position = new Position({
    pool,
    liquidity: JSBI.BigInt(details.liquidity.toString()),
    tickLower: details.tickLower,
    tickUpper: details.tickUpper,
  });
  const priceLower = Number(tickToPrice(token0, token1, details.tickLower).toSignificant(6));
  const priceUpper = Number(tickToPrice(token0, token1, details.tickUpper).toSignificant(6));
  const currentPrice = Number(tickToPrice(token0, token1, poolData.tick).toSignificant(6));
  const inRange = poolData.tick >= details.tickLower && poolData.tick <= details.tickUpper;
  let percentOfPool: number;
  if (typeof poolData.liquidity === 'bigint' && poolData.liquidity > 0n) {
    percentOfPool = Number((details.liquidity * 100n) / poolData.liquidity);
  } else {
    percentOfPool = 0;
  }
  const raw0 = position.amount0.quotient.toString();
  const raw1 = position.amount1.quotient.toString();
  const token0BalanceFormatted = formatUnits(BigInt(raw0), token0.decimals);
  const token1BalanceFormatted = formatUnits(BigInt(raw1), token1.decimals);
  return {
    ...details,
    priceLower,
    priceUpper,
    currentPrice,
    currentTick: poolData.tick,
    inRange,
    percentOfPool,
    token0Symbol: token0.symbol,
    token1Symbol: token1.symbol,
    token0BalanceFormatted,
    token1BalanceFormatted,
    liquidity: JSBI.BigInt(details.liquidity.toString()) as BigintIsh,
  };
}

export async function analyzeAllPositions(owner: Address): Promise<PositionAnalysis> {
  logger.info('Analyzing all positions...');

  const rawPositions = await getV4Positions(owner);
  const detailedPositions: DetailPositionInfo[] = [];
  let inRangeCount = 0;
  let activeCount = 0;

  for (const { tokenId } of rawPositions) {
    try {
      const info = await getPositionInfo(BigInt(tokenId));
      if (!info?.liquidity || info.liquidity === 0) {
        logger.debug(`Skipping position ${tokenId} with zero liquidity (likely closed)`);
        continue;
      }

      detailedPositions.push(info);

      if (info.inRange) inRangeCount++;
      activeCount++;
    } catch (e: any) {
      logger.error(`Error fetching position ${tokenId}: ${e.message || e}`);
    }
  }

  return {
    totalPositions: detailedPositions.length,
    inRangePositions: inRangeCount,
    positions: detailedPositions,
    timestamp: Date.now(),
  };
}

export async function getV4Positions(owner: Address): Promise<GRAPH_POSITIONS_RESPONSE[]> {
  const headers = {
    Authorization: 'Bearer ' + process.env.GRAPH_KEY,
  };
  const response = await request<{ positions: GRAPH_POSITIONS_RESPONSE[] }>(
    UNICHAIN_SUBGRAPH_URL,
    GET_POSITIONS_QUERY,
    { owner: owner.toLowerCase() },
    headers,
  );
  return response.positions;
}
