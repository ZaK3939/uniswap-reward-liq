import 'dotenv/config';
import logger from './utils/logger';
import { analyzeAllPositions, getPositionInfo } from './services/positions';
import { TOKEN_PAIRS } from './config/tokens';
import {
  BOT_ADDRESS,
  DEADLINE_BUFFER_SECONDS,
  MONITORING_INTERVAL_MINUTES,
  OUT_OF_RANGE_THRESHOLD,
  REBALANCE_THRESHOLD,
  TX_CONFIG,
} from './config/config';

import { CronJob } from 'cron';
import { createPosition } from './services/createliq';
import { CreatePositionParams } from './types';
import { computeCounterpartyAmounts } from './utils/calcAmountForliquidity';
import { removePositionIfOutOfRange } from './services/removeliq';
import { getTokenPairBalances } from './utils/erc20';

import { PoolKey } from '@uniswap/v4-sdk';
import { zeroAddress } from 'viem';
import { executeSwap } from './services/swaps';
import { fetchPriceUSD } from './utils/price';

// Constants
// const TOKEN_PAIR = TOKEN_PAIRS.USDC_USDT;
const TOKEN_PAIR = TOKEN_PAIRS.ETH_USDT;
const POOL_KEY: PoolKey = {
  currency0: TOKEN_PAIR.tokenA,
  currency1: TOKEN_PAIR.tokenB,
  fee: TOKEN_PAIR.feeTier,
  tickSpacing: TOKEN_PAIR.tickSpacing,
  hooks: TOKEN_PAIR.hooks || zeroAddress,
};

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

          const { token0, token1 } = await getTokenPairBalances(BOT_ADDRESS, TOKEN_PAIR.tokenA, TOKEN_PAIR.tokenB);
          const [token0PriceUSD, token1PriceUSD] = await Promise.all([
            fetchPriceUSD(token0.tokenAddress),
            fetchPriceUSD(token1.tokenAddress),
          ]);
          if (!token0PriceUSD || !token1PriceUSD) {
            logger.error('Failed to fetch token prices');
            return;
          }

          // トークン価値をUSDベースで計算
          const token0ValueUSD = token0.balanceFormatted * token0PriceUSD;
          const token1ValueUSD = token1.balanceFormatted * token1PriceUSD;

          // 総資産価値を計算
          const totalValueUSD = token0ValueUSD + token1ValueUSD;

          // 比率計算 (価値ベース)
          const ratio0 = token0ValueUSD / totalValueUSD;
          const ratio1 = token1ValueUSD / totalValueUSD;

          const deadline = BigInt(Math.floor(Date.now() / 1000)) + BigInt(DEADLINE_BUFFER_SECONDS);

          // 比率での判定（価値ベース）
          if (ratio0 <= REBALANCE_THRESHOLD) {
            const target0USD = totalValueUSD * 0.3;
            const amountToSwapUSD = target0USD - token0ValueUSD;
            const amountToSwapFormatted = amountToSwapUSD / token1PriceUSD;

            logger.info(`Token0 ratio low (${ratio0.toFixed(2)}), swapping ${amountToSwapFormatted} token1`);

            await executeSwap({
              tokenIn: token1.tokenAddress,
              tokenOut: token0.tokenAddress,
              poolKey: POOL_KEY,
              amountIn: amountToSwapFormatted.toFixed(token1.decimals),
              slippageTolerance: TX_CONFIG.SLIPPAGE_TOLERANCE,
              deadline,
            });
          } else if (ratio1 <= REBALANCE_THRESHOLD) {
            const target1USD = totalValueUSD * 0.3;
            const amountToSwapUSD = target1USD - token1ValueUSD;
            const amountToSwapFormatted = amountToSwapUSD / token0PriceUSD;

            logger.info(`Token1 ratio low (${ratio1.toFixed(2)}), swapping ${amountToSwapFormatted} token0`);

            await executeSwap({
              tokenIn: token0.tokenAddress,
              tokenOut: token1.tokenAddress,
              poolKey: POOL_KEY,
              amountIn: amountToSwapFormatted.toFixed(token1.decimals),
              slippageTolerance: TX_CONFIG.SLIPPAGE_TOLERANCE,
              deadline,
            });
          } else {
            logger.info(`Balance ratios token0:${ratio0.toFixed(2)}, token1:${ratio1.toFixed(2)} ok`);
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
