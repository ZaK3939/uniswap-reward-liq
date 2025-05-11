import { Address, zeroAddress } from 'viem';
import { mintV4Position, TokenInfo } from './mintPositon';
import { get } from 'http';
import { getWalletAccount } from '../utils/client';

export const chainId = 130; // chain ID: Unichain

// Token addresses configuration
export const TOKEN_ADDRESSES = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
  USDT: '0x9151434b16b9763660705744891fA906F660EcC5',
} as const;

// Token information configuration
export const TOKEN_INFO = {
  [TOKEN_ADDRESSES.WETH]: {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    chainId,
    isNative: false,
  },
  [TOKEN_ADDRESSES.USDC]: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    chainId,
    isNative: false,
  },
  [TOKEN_ADDRESSES.USDT]: {
    symbol: 'USDT',
    name: 'USD₮',
    decimals: 6,
    chainId,
    isNative: false,
  },
  // Native ETH
  NATIVE: {
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    chainId,
    isNative: true,
    address: zeroAddress, // Use zero address for native ETH
  },
} as const;

export const userAddress = getWalletAccount().address; // User's wallet address

/**
 * Creates a Uniswap V4 liquidity position
 * @param tokenA First token address or 'NATIVE' for ETH
 * @param tokenB Second token address
 * @param amountA Amount of first token (in decimal format, e.g. 1.5)
 * @param amountB Amount of second token (in decimal format, e.g. 1500)
 * @param feeTier Fee tier (100=0.01%, 500=0.05%, 3000=0.3%, 10000=1%)
 * @param fullRange Whether to create a full-range position
 * @param tickRange Percentage range around current price (e.g. 10 for ±10%)
 * @param options Additional options for creating the position
 */
export async function createLiquidityPosition(
  tokenA: Address | 'NATIVE',
  tokenB: Address,
  amountA: number,
  amountB: number,
  feeTier: 100 | 500 | 3000 | 10000 = 3000,
  fullRange: boolean = false,
  tickRange: number = 10,
  options?: {
    slippageTolerance?: number; // Percentage, e.g. 0.5 for 0.5%
    deadline?: number; // Seconds from now
    usePermit2?: boolean; // Whether to use Permit2 for approvals
  },
) {
  try {
    // Get token information
    const tokenAInfo: TokenInfo =
      tokenA === 'NATIVE'
        ? TOKEN_INFO.NATIVE
        : {
            address: tokenA,
            ...TOKEN_INFO[tokenA as keyof typeof TOKEN_INFO],
          };

    const tokenBInfo: TokenInfo = {
      address: tokenB,
      ...TOKEN_INFO[tokenB as keyof typeof TOKEN_INFO],
    };

    // Convert token amounts to the correct format with decimals
    const amountADesired = BigInt(Math.floor(amountA * 10 ** tokenAInfo.decimals));
    const amountBDesired = BigInt(Math.floor(amountB * 10 ** tokenBInfo.decimals));

    console.log(`Creating position with:
      - Chain ID: ${chainId}
      - Token A: ${tokenAInfo.symbol} (${tokenAInfo.address})
      - Token B: ${tokenBInfo.symbol} (${tokenBInfo.address})
      - Amount A: ${amountA} ${tokenAInfo.symbol} (${amountADesired.toString()} wei)
      - Amount B: ${amountB} ${tokenBInfo.symbol} (${amountBDesired.toString()} wei)
      - Fee Tier: ${feeTier / 10000}%
      - Full Range: ${fullRange}
      - Tick Range: ${tickRange}% (if not full range)
    `);

    // Execute the minting function with updated parameters
    return await mintV4Position(
      { address: userAddress },
      tokenAInfo,
      tokenBInfo,
      amountADesired,
      amountBDesired,
      feeTier,
      fullRange,
      tickRange,
      options,
    );
  } catch (error) {
    console.error('Failed to create liquidity position:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
