import { Address, formatUnits, parseAbi } from 'viem';
import { getPublicClient, getAccountAddress } from './client';
import logger from './logger';
import { ERC20_ABI } from '../abis';
import { isNative } from '../config/tokens';
import { TokenBalance } from '../types';

/**
 * Get balances for multiple ERC20 tokens
 * @param address Wallet address to check balances for
 * @param tokenAddresses Array of token contract addresses
 * @returns Promise with token balance information
 */
export async function getMultipleTokenBalances(address: Address, tokenAddresses: Address[]): Promise<TokenBalance[]> {
  const client = getPublicClient();

  const balances = await Promise.all(
    tokenAddresses.map(async (tokenAddress) => {
      try {
        let balanceWei: bigint;
        let decimals: number;
        let symbol: string;
        // Check if the token address is native (ETH)
        // or an ERC20 token
        if (isNative(tokenAddress)) {
          // Native ETH balance
          balanceWei = await client.getBalance({ address });
          decimals = 18;
          symbol = 'ETH';
        } else {
          // ERC20 token balance, decimals, symbol
          balanceWei = (await client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address],
          })) as bigint;

          const rawDecimals = (await client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'decimals',
          })) as bigint;
          decimals = Number(rawDecimals);

          symbol = (await client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'symbol',
          })) as string;
        }

        const balanceFormatted = Number(formatUnits(balanceWei, decimals));
        return {
          tokenAddress,
          symbol,
          balanceWei,
          balanceFormatted,
          decimals,
        };
      } catch (error) {
        logger.error(`Error getting balance for ${tokenAddress}:`, error);
        return {
          tokenAddress,
          symbol: isNative(tokenAddress) ? 'ETH' : 'ERROR',
          balanceWei: BigInt(0),
          balanceFormatted: 0,
          decimals: isNative(tokenAddress) ? 18 : 0,
          error: String(error),
        };
      }
    }),
  );

  return balances;
}

/**
 * Get balances for a specific token pair
 * @param address Wallet address to check balances for (optional - uses connected wallet if not provided)
 * @param token0Address First token address
 * @param token1Address Second token address
 * @returns Token pair balances with labeled properties
 */
export async function getTokenPairBalances(
  address: Address | undefined,
  token0Address: Address,
  token1Address: Address,
) {
  // If no address provided, use the connected wallet
  const walletAddress = address || getAccountAddress();

  try {
    const balances = await getMultipleTokenBalances(walletAddress, [token0Address, token1Address]);
    return {
      token0: balances[0],
      token1: balances[1],
      walletAddress,
    };
  } catch (error) {
    logger.error('Failed to get token pair balances:', error);
    throw error;
  }
}
