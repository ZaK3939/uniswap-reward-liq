import { Address, formatUnits, parseAbi } from 'viem';
import { getPublicClient, getAccountAddress } from './client';
import logger from './logger';
import { ERC20_ABI } from '../abis';

/**
 * Get balances for multiple ERC20 tokens
 * @param address Wallet address to check balances for
 * @param tokenAddresses Array of token contract addresses
 * @returns Promise with token balance information
 */
export async function getMultipleERC20Balances(
  address: Address,
  tokenAddresses: Address[],
): Promise<
  {
    tokenAddress: Address;
    symbol: string;
    balanceWei: bigint;
    balanceFormatted: number;
    decimals: number;
    error?: string;
  }[]
> {
  // Get the client for each call
  const client = getPublicClient();

  const balances = await Promise.all(
    tokenAddresses.map(async (tokenAddress) => {
      try {
        // Get token balance in wei
        const balanceWei = (await client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint;

        // Get token decimals
        const decimals = await client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals',
        });

        // Get token symbol
        const symbol = (await client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'symbol',
        })) as string;

        // Format the balance
        const balanceFormatted = Number(formatUnits(balanceWei, Number(decimals)));

        return {
          tokenAddress,
          symbol,
          balanceWei,
          balanceFormatted,
          decimals: Number(decimals),
        };
      } catch (error) {
        // Log error with your logger
        logger.error(`Error getting balance for token ${tokenAddress}:`, error);
        return {
          tokenAddress,
          symbol: 'ERROR',
          balanceWei: BigInt(0),
          balanceFormatted: 0,
          decimals: 0,
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
    const balances = await getMultipleERC20Balances(walletAddress, [token0Address, token1Address]);
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
