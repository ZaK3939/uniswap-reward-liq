/**
 * Viem client initialization for Uniswap v4 Unichain integration
 */
import { Account, createPublicClient, createWalletClient, http, PublicClient, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { RPC_CONFIG } from '../config/config';
import logger from './logger';
import { unichain } from '../config/chains';

// Cache clients to avoid recreating them
let publicClient: PublicClient | null = null;
let walletClient: WalletClient | null = null;

/**
 * Initialize a public client for reading from the blockchain
 * @returns Public client
 */
export function getPublicClient(): PublicClient {
  if (publicClient) {
    return publicClient;
  }

  try {
    publicClient = createPublicClient({
      chain: unichain,
      transport: http(RPC_CONFIG.URL, {
        retryCount: RPC_CONFIG.MAX_RETRIES,
        retryDelay: RPC_CONFIG.RETRY_DELAY,
      }),
    });

    return publicClient;
  } catch (err) {
    logger.error('Failed to initialize public client');
    throw err;
  }
}

/**
 * Initialize a wallet client for writing to the blockchain
 * @param privateKey Private key to use (optional, defaults to env var)
 * @returns Wallet client
 */
export function getWalletClient(privateKey?: string): WalletClient {
  if (walletClient) {
    return walletClient;
  }

  try {
    const pkeyToUse = privateKey || process.env.PRIVATE_KEY;

    if (!pkeyToUse) {
      throw new Error('Private key is required. Set PRIVATE_KEY environment variable or pass it as an argument.');
    }

    const account = privateKeyToAccount(pkeyToUse as `0x${string}`);

    walletClient = createWalletClient({
      account,
      chain: unichain,
      transport: http(RPC_CONFIG.URL, {
        retryCount: RPC_CONFIG.MAX_RETRIES,
        retryDelay: RPC_CONFIG.RETRY_DELAY,
      }),
    });

    return walletClient;
  } catch (err) {
    logger.error('Failed to initialize wallet client');
    throw err;
  }
}

/**
 * Reset clients (useful for testing or changing connections)
 */
export function resetClients(): void {
  publicClient = null;
  walletClient = null;
}

/**
 * Get account address from wallet client
 * @returns Account address
 */
export function getAccountAddress(): `0x${string}` {
  const client = getWalletClient();
  if (!client.account) {
    throw new Error('Wallet client is not initialized');
  }
  return client.account.address;
}

export function getWalletAccount(): Account {
  const pkeyToUse = process.env.PRIVATE_KEY;

  if (!pkeyToUse) {
    throw new Error('Private key is required. Set PRIVATE_KEY environment variable or pass it as an argument.');
  }

  const account = privateKeyToAccount(pkeyToUse as `0x${string}`);

  return account;
}
