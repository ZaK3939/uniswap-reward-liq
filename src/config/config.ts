/**
 * Global configuration for Uniswap v4 Unichain integration
 */
import 'dotenv/config';
import { TypedDataDomain } from 'viem';
import { Address, privateKeyToAddress } from 'viem/accounts';

export const MONITORING_INTERVAL_MINUTES = 6;
export const OUT_OF_RANGE_THRESHOLD = 10;
export const BALANCE_RATIO = 40n; // 40% Ratio of available balance to use for creating positions
export const DEADLINE_BUFFER_SECONDS = 300;
export const REBALANCE_THRESHOLD = 0.1; // 10% threshold for rebalancing
export const TICK_RANGE = 5; //1: only one tick, 2: 1 + 1 both side

export const MAX_UINT160 = 2n ** 160n - 1n;
// Network configuration
export const UNICHAIN_CHAIN_ID = 130; // Replace with actual Unichain Chain ID

export const UNICHAIN_SUBGRAPH_URL = `https://gateway.thegraph.com/api/subgraphs/id/EoCvJ5tyMLMJcTnLQwWpjAtPdn74PcrZgzfcT5bYxNBH`;

// Contract addresses - replace with actual addresses on Unichain
export const CONTRACTS = {
  POOL_MANAGER: '0x1f98400000000000000000000000000000000004', // PoolManager
  POSITION_MANAGER: '0x4529a01c7a0410167c5740c487a8de60232617bf', // NonfungiblePositionManager
  UNIVERSAL_ROUTER: '0xef740bf23acae26f6492b10de645d6b98dc8eaf3', // UniversalRouter
  STATE_VIEW: '0x86e8631a016f9068c3f085faf484ee3f5fdee8f2', // StateView
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3', // Permit2
  V4QUOTER: '0x333e3c607b141b18ff6de9f258db6e77fe7491e0',
} as const;

// RPC configuration
export const RPC_CONFIG = {
  URL: process.env.RPC_URL || 'https://unichain-rpc.publicnode.com',
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // milliseconds
};

// Position monitoring configuration
export const MONITOR_CONFIG = {
  INTERVAL: '*/5 * * * *', // Every 5 minutes (cron format)
  LOG_FILE: 'position-monitor.log',
};

// Default transaction settings
export const TX_CONFIG = {
  SLIPPAGE_TOLERANCE: 0.5, // 0.5%
  DEADLINE_MINUTES: 20, // 20 minutes
  GAS_LIMIT_MULTIPLIER: 1.2, // Multiply estimated gas by this factor
};

// Position creation defaults
export const POSITION_CONFIG = {
  DEFAULT_PRICE_RANGE_PERCENT: 1.0, // 1% price range
  DEFAULT_FEE_TIER: 3000, // 0.3%
  DEFAULT_TICK_SPACING: 60, // Medium fee
};

export const BOT_ADDRESS = privateKeyToAddress(process.env.PRIVATE_KEY as Address);

export function PERMIT2_DOMAIN(chainId: number): TypedDataDomain {
  return {
    name: 'Permit2',
    chainId,
    verifyingContract: CONTRACTS.PERMIT2,
  };
}

export const PERMIT2_TYPES = {
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
  PermitBatch: [
    { name: 'details', type: 'PermitDetails[]' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
};
