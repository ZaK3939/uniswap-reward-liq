import 'dotenv/config';
import logger from './utils/logger';
import { analyzeAllPositions, getPositionInfo } from './services/positions';
import { TOKEN_PAIRS } from './config/tokens';
import {
  BOT_ADDRESS,
  DEADLINE_BUFFER_SECONDS,
  MONITORING_INTERVAL_MINUTES,
  OUT_OF_RANGE_THRESHOLD,
  TX_CONFIG,
} from './config/config';

import { CronJob } from 'cron';
import { createPosition } from './services/createliq';
import { CreatePositionParams } from './types';
import { computeCounterpartyAmounts } from './utils/calcAmountForliquidity';
import { removePositionIfOutOfRange } from './services/removeliq';

// Constants
// const TOKEN_PAIR = TOKEN_PAIRS.USDC_USDT;
const TOKEN_PAIR = TOKEN_PAIRS.ETH_USDT;

let currentPositionId: bigint | undefined = undefined;
let outOfRangeCount = 0;
let isProcessing = false;

/**
 * Create initial liquidity position using available balances
 */
async function createInitialPosition(TOKEN_PAIR: any): Promise<void> {
  logger.info('Creating initial position...');

  try {
    const owner = BOT_ADDRESS;
    if (!owner) throw new Error('Wallet not connected');

    // 1) Compute amounts based on balances and current pool price
    const { poolData, amount0, amount1, tickLower, tickUpper } = await computeCounterpartyAmounts(
      owner,
      TOKEN_PAIR.tokenA,
      TOKEN_PAIR.tokenB,
      TOKEN_PAIR.feeTier,
      TOKEN_PAIR.tickSpacing,
    );

    // 2) Build createPosition params
    const params: CreatePositionParams = {
      poolData,
      amount0,
      amount1,
      tickLower,
      tickUpper,
      slippageTolerance: TX_CONFIG.SLIPPAGE_TOLERANCE,
    };

    // 3) Create the position
    const info = await createPosition(params);

    if (!info) {
      logger.error('Failed to create initial position');
      return;
    } else {
      currentPositionId = info.tokenId;
    }
    logger.info(`Position created successfully!`);
  } catch (err: any) {
    logger.error(`Error during position creation: ${err.message || err}`);
  }
}

/**
 * Monitor position in regular interval
 */
function startMonitoring(TOKEN_PAIR: any) {
  logger.info(`Starting monitor: every ${MONITORING_INTERVAL_MINUTES} minutes`);

  const job = new CronJob(
    `*/${MONITORING_INTERVAL_MINUTES} * * * *`,
    async () => {
      if (isProcessing) return;

      if (!currentPositionId) {
        logger.warn('No managed position, creating one...');
        await createInitialPosition(TOKEN_PAIR);

        return;
      }

      try {
        const pos = await getPositionInfo(currentPositionId);
        if (!pos) {
          logger.warn(`Position ${currentPositionId} is closed`);
          currentPositionId = undefined;
          return;
        } else {
          logger.info(
            `Position ${currentPositionId}: range ${pos.priceLower.toFixed(6)} - ${pos.priceUpper.toFixed(
              6,
            )}, current ${pos.currentPrice.toFixed(6)}, inRange=${
              pos.inRange
            }, percentOfPool=${pos.percentOfPool.toFixed(8)}%`,
          );

          if (!pos.inRange) {
            outOfRangeCount++;
            if (outOfRangeCount >= OUT_OF_RANGE_THRESHOLD) {
              const deadline = BigInt(Math.floor(Date.now() / 1000)) + BigInt(DEADLINE_BUFFER_SECONDS);
              logger.info(`Position ${currentPositionId} is out of range for ${outOfRangeCount} intervals`);
              const result = await removePositionIfOutOfRange(pos, TX_CONFIG.SLIPPAGE_TOLERANCE, deadline);
              logger.info(`Removed tokenId=${result.tokenId}, txHash=${result.txHash}`);
              currentPositionId = undefined;
              outOfRangeCount = 0;
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
}

/**
 * Bootstrap
 */
async function main() {
  logger.info('Starting Uniswap v4 Unichain automation bot');

  try {
    // Load existing positions
    const { totalPositions, positions } = await analyzeAllPositions(BOT_ADDRESS);
    logger.info(`======Found ${totalPositions} existing active positions======`);

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
      await createInitialPosition(TOKEN_PAIR);
    }

    startMonitoring(TOKEN_PAIR);
  } catch (err) {
    logger.error(`Initialization error: ${err}`);
    process.exit(1);
  }
}

// Launch
main();
