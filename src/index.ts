import 'dotenv/config';
import { CronJob } from 'cron';
import logger from './utils/logger';
import { getPublicClient, getAccountAddress } from './utils/client';
import { analyzeAllPositions, getPositionInfo } from './services/positions';
import { executeSwap, quoteExactInputSingleV4 } from './services/swaps';
import { createPosition } from './services/createliq';
import { TOKEN_ADDRESSES, TOKEN_INFO, TOKEN_PAIRS } from './config/tokens';
import {
  TX_CONFIG,
  POSITION_CONFIG,
  BOT_ADDRESS,
  MONITORING_INTERVAL_MINUTES,
  OUT_OF_RANGE_THRESHOLD,
} from './config/config';
import { formatEther, formatUnits } from 'viem';
import { ERC20_ABI } from './abis';
import { computeCounterpartyAmounts } from './utils/calcAmountForliquidity';
import { CreatePositionParams } from './types';

// Constants
const TOKEN_PAIR = TOKEN_PAIRS.USDC_USDT;

// State
let outOfRangeCount = 0;
let currentPositionId: bigint | null = null;
let isProcessing = false;

/**
 * Bootstrap
 */
async function main() {
  logger.info('Starting Uniswap v4 Unichain automation bot');

  try {
    // Load existing positions
    const { totalPositions, positions } = await analyzeAllPositions(BOT_ADDRESS);
    logger.info(`Found ${totalPositions} existing active positions`);

    const match = positions.find(
      ({ token0, token1 }) =>
        (token0 === TOKEN_PAIR.tokenA && token1 === TOKEN_PAIR.tokenB) ||
        (token0 === TOKEN_PAIR.tokenB && token1 === TOKEN_PAIR.tokenA),
    );

    if (match) {
      logger.info(`Managing existing position: ID=${match.tokenId}`);
      currentPositionId = match.tokenId;
    }

    if (!currentPositionId) {
      await createInitialPosition();
    }

    startMonitoring();
  } catch (err) {
    logger.error(`Initialization error: ${err}`);
    process.exit(1);
  }
}

/**
 * Create initial liquidity position using available balances
 */
export async function createInitialPosition(): Promise<void> {
  logger.info('Creating initial position...');

  try {
    const owner = BOT_ADDRESS;
    if (!owner) throw new Error('Wallet not connected');

    // 1) Compute amounts based on balances and current pool price
    const { amount0, amount1, tickLower, tickUpper } = await computeCounterpartyAmounts(
      owner,
      TOKEN_PAIR.tokenA,
      TOKEN_PAIR.tokenB,
      TOKEN_PAIR.feeTier,
      TOKEN_PAIR.tickSpacing,
    );

    // 2) Build createPosition params
    const params: CreatePositionParams = {
      token0: TOKEN_PAIR.tokenA,
      token1: TOKEN_PAIR.tokenB,
      fee: TOKEN_PAIR.feeTier,
      tickSpacing: TOKEN_PAIR.tickSpacing,
      amount0,
      amount1,
      tickLower,
      tickUpper,
      priceRangePercent: POSITION_CONFIG.DEFAULT_PRICE_RANGE_PERCENT,
      slippageTolerance: TX_CONFIG.SLIPPAGE_TOLERANCE,
    };

    // 3) Create the position
    const result = await createPosition(params);

    // if (result.success && result.tokenId) {
    //   logger.info(`Position created: ID=${result.tokenId}`);
    //   // reset out-of-range counter or update state as needed
    // } else {
    //   logger.error(`Position creation failed: ${result.error || 'unknown error'}`);
    // }
  } catch (err: any) {
    logger.error(`Error during position creation: ${err.message || err}`);
  }
}

/**
 * Perform a token swap
 */
// async function performSwap(tokenIn: string, tokenOut: string, amount: string): Promise<string | null> {
//   logger.info(`Swapping ${amount} ${tokenIn} -> ${tokenOut}`);

//   try {
//     const result = await executeSwap({
//       tokenIn,
//       tokenOut,
//       fee: TOKEN_PAIR.feeTier,
//       amountIn: amount,
//       slippageTolerance: TX_CONFIG.SLIPPAGE_TOLERANCE,
//     });

//     if (result.success) {
//       logger.info(`Swap result: in=${result.amountIn}, out=${result.amountOut}`);
//       return result.amountOut ?? null;
//     } else {
//       logger.error(`Swap failed: ${result.error}`);
//       return null;
//     }
//   } catch (err) {
//     logger.error(`Swap error: ${err}`);
//     return null;
//   }
// }

/**
 * Handle out-of-range liquidity
 */
// async function handleOutOfRangePosition() {
//   if (!currentPositionId || isProcessing) return;
//   isProcessing = true;

//   try {
//     logger.warn(`Position ${currentPositionId} out of range, rebalancing...`);

//     const pos = await getPositionInfo(currentPositionId);
//     let swapped: string | null = null;

//     if (parseFloat(pos.token0BalanceFormatted || '0') > 0) {
//       const amt = (parseFloat(pos.token0BalanceFormatted!) / 2).toString();
//       swapped = await performSwap(pos.token0, pos.token1, amt);
//     } else if (parseFloat(pos.token1BalanceFormatted || '0') > 0) {
//       const amt = (parseFloat(pos.token1BalanceFormatted!) / 2).toString();
//       swapped = await performSwap(pos.token1, pos.token0, amt);
//     }

//     // Create new position using half balances
//     logger.info('Creating new position post-swap...');

//     const wallet = getAccountAddress();
//     const client = getPublicClient();

//     const ethBal = parseFloat(formatEther(await client.getBalance({ address: wallet }))) * 0.5;
//     const usdcBalRaw = (await client.readContract({
//       address: TOKEN_ADDRESSES.USDC,
//       abi: ERC20_ABI,
//       functionName: 'balanceOf',
//       args: [wallet],
//     })) as bigint;
//     const usdcBal = parseFloat(formatUnits(usdcBalRaw, TOKEN_INFO[TOKEN_ADDRESSES.USDC].decimals)) * 0.5;

//     const newPos = await createPosition({
//       token0: TOKEN_PAIR.tokenA,
//       token1: TOKEN_PAIR.tokenB,
//       fee: TOKEN_PAIR.feeTier,
//       tickSpacing: TOKEN_PAIR.tickSpacing,
//       amount0: ethBal.toString(),
//       amount1: usdcBal.toString(),
//       priceRangePercent: POSITION_CONFIG.DEFAULT_PRICE_RANGE_PERCENT,
//       slippageTolerance: TX_CONFIG.SLIPPAGE_TOLERANCE,
//     });

//     if (newPos.success && newPos.tokenId) {
//       logger.info(`New position created: ID=${newPos.tokenId}`);
//       currentPositionId = newPos.tokenId;
//       outOfRangeCount = 0;
//     } else {
//       logger.error(`New position creation failed: ${newPos.error}`);
//     }
//   } catch (err) {
//     logger.error(`Rebalance error: ${err}`);
//   } finally {
//     isProcessing = false;
//   }
// }

/**
 * Monitor position in regular interval
 */
function startMonitoring() {
  logger.info(`Starting monitor: every ${MONITORING_INTERVAL_MINUTES} minutes`);

  const job = new CronJob(
    `*/${MONITORING_INTERVAL_MINUTES} * * * *`,
    async () => {
      if (isProcessing) return;

      if (!currentPositionId) {
        logger.warn('No managed position, creating one...');
        return await createInitialPosition();
      }

      try {
        const pos = await getPositionInfo(currentPositionId);
        if (!pos) {
          logger.warn(`Position ${currentPositionId} is closed`);
        } else {
          logger.info(
            `Position ${currentPositionId}: range ${pos.priceLower.toFixed(6)} - ${pos.priceUpper.toFixed(
              6,
            )}, current ${pos.currentPrice.toFixed(6)}, inRange=${pos.inRange}`,
          );

          if (!pos.inRange) {
            outOfRangeCount++;
            if (outOfRangeCount >= OUT_OF_RANGE_THRESHOLD) {
              // await handleOutOfRangePosition();
              logger.info(`Position ${currentPositionId} is out of range for ${outOfRangeCount} intervals`);
            }
          } else {
            outOfRangeCount = 0;
          }
        }
      } catch (err) {
        logger.error(`Monitor error: ${err}`);
      }
    },
    null,
    true,
  );

  process.on('SIGINT', () => {
    job.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    job.stop();
    process.exit(0);
  });

  logger.info(`Next run: ${job.nextDate()?.toLocaleString()}`);
}

// Launch
main();
