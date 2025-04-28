/**
 * Type definitions for Uniswap v4 Unichain integration
 */
import { Token, Percent, BigintIsh } from '@uniswap/sdk-core';
import { Address } from 'viem';
import JSBI from 'jsbi';
import { PoolKey } from '@uniswap/v4-sdk';

/**
 * Position details interface
 */
export interface PositionDetails {
  tokenId: bigint;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: BigintIsh;
}

/**
 * Extended position details with additional analysis
 */
export interface DetailPositionInfo extends PositionDetails {
  tickSpacing: number;
  hooks: Address;
  priceLower: number;
  priceUpper: number;
  sqrtPriceX96: JSBI;
  currentPrice: number;
  currentTick: number;
  inRange: boolean;
  percentOfPool: number;
  token0Symbol?: string;
  token1Symbol?: string;
  token0BalanceFormatted?: string;
  token1BalanceFormatted?: string;
}

/**
 * Position creation parameters
 */
export interface CreatePositionParams {
  poolData: PoolData;
  amount0: bigint;
  amount1: bigint;
  tickLower: number;
  tickUpper: number;
  slippageTolerance?: number;
  deadline?: number;
}

/**
 * Create position result
 */
export interface CreatePositionResult {
  success: boolean;
  tokenId?: bigint;
  liquidity?: string;
  amount0Used?: string;
  amount1Used?: string;
  tickLower?: number;
  tickUpper?: number;
  priceLower?: string;
  priceUpper?: string;
  transactionHash?: string;
  error?: string;
}

/**
 * Swap parameters
 */
export interface SwapParams {
  poolKey: PoolKey;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  slippageTolerance: number;
  deadline: bigint;
}

/**
 * Swap result
 */
export interface SwapResult {
  success: boolean;
  amountIn?: string;
  amountOut?: string;
  transactionHash?: string;
  effectivePrice?: string;
  priceImpact?: string;
  error?: string;
}

// Token balance with complete information
export interface TokenBalance {
  tokenAddress: `0x${string}`;
  symbol: string;
  balanceWei: bigint;
  balanceFormatted: number;
  decimals: number;
  error?: string;
}

/**
 * Position monitoring configuration
 */
export interface MonitorConfig {
  interval: string; // Cron expression
  positionIds?: string[]; // Specific position IDs to monitor (optional)
  notifyOnRangeExit?: boolean;
  notifyOnFeeAccrual?: boolean;
  minFeeThreshold?: string; // Minimum fee to notify about
  logFile?: string;
}

/**
 * Position analysis result
 */
export interface PositionAnalysis {
  totalPositions: number;
  inRangePositions: number;
  positions: DetailPositionInfo[];
  timestamp: number;
}

/**
 * Transaction options
 */
export interface TransactionOptions {
  slippageTolerance?: Percent;
  deadline?: number;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

/**
 * Pool data interface
 */
export interface PoolData {
  token0: Token;
  token1: Token;
  fee: number;
  poolId: string;
  hooks: Address;
  sqrtPriceX96: bigint;
  tick: number;
  tickSpacing: number;
  liquidity: bigint;
}

export interface PositionInfo {
  value: bigint;
  getPoolId(): bigint;
  getTickUpper(): number;
  getTickLower(): number;
  hasSubscriber(): boolean;
}
