/**
 * Token definitions for Uniswap v4 Unichain integration
 */
import { Token } from '@uniswap/sdk-core';
import { UNICHAIN_CHAIN_ID } from './config';
import ethAddress, { Address, zeroAddress } from 'viem';
import logger from '../utils/logger';

// Token addresses - replace with actual addresses on Unichain
export const TOKEN_ADDRESSES = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
  USDT: '0x9151434b16b9763660705744891fA906F660EcC5',
  // Add more tokens as needed
} as const;

// Token information
export const TOKEN_INFO = {
  [TOKEN_ADDRESSES.WETH]: {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },
  [TOKEN_ADDRESSES.USDC]: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  [TOKEN_ADDRESSES.USDT]: {
    symbol: 'USDT',
    name: 'USD₮0',
    decimals: 6,
  },
  // Add more token info as needed
} as const;

// Token cache to avoid recreating Token objects
const tokenCache = new Map<string, Token>();

/**
 * Get a Token object for a given address
 * @param address Token address
 * @returns Token object
 */
export function getTokenByAddress(address: string): Token {
  logger.info(`getTokenByAddress: ${address}`);
  // Handle native ETH (zero address)
  if (address === zeroAddress) {
    return new Token(UNICHAIN_CHAIN_ID, zeroAddress as `0x${string}`, 18, 'ETH', 'Ether');
  }

  // Return from cache if available
  if (tokenCache.has(address)) {
    return tokenCache.get(address)!;
  }

  // Look up token metadata using lowercase key
  const info = TOKEN_INFO[address as keyof typeof TOKEN_INFO];
  if (!info) {
    throw new Error(`Token info not found for address: ${address}`);
  }

  // Create new Token instance and cache it
  const token = new Token(UNICHAIN_CHAIN_ID, address as `0x${string}`, info.decimals, info.symbol, info.name);
  tokenCache.set(address, token);
  return token;
}

/**
 * Pre-defined tokens for convenience
 */

export enum FeeAmount {
  LOWEST = 100,
  LOW = 500,
  MEDIUM = 3000,
  HIGH = 10000,
}

export const TICK_SPACINGS: { [amount in FeeAmount]: number } = {
  [FeeAmount.LOWEST]: 1,
  [FeeAmount.LOW]: 10,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 200,
};

/**
 * Common token pairs for convenience
 */
export const TOKEN_PAIRS = {
  ETH_USDT: {
    tokenA: zeroAddress,
    tokenB: TOKEN_ADDRESSES.USDT,
    name: 'ETH/USDT',
    feeTier: 3000,
    tickSpacing: 60,
  },
  USDC_USDT: {
    tokenA: TOKEN_ADDRESSES.USDC,
    tokenB: TOKEN_ADDRESSES.USDT,
    name: 'USDC/USDT',
    feeTier: 100,
    tickSpacing: 1,
  },
  // Add more pairs as needed
} as const;

export function isNative(tokenAddress: Address) {
  return tokenAddress === zeroAddress;
}
