/**
 * Position monitoring service for Uniswap v4 Unichain integration
 */
import { CronJob } from 'cron';
import fs from 'fs/promises';
import path from 'path';

import { getPositionInfo, analyzeAllPositions, getV4Positions } from './positions';
import logger from '../utils/logger';
import { BOT_ADDRESS, MONITOR_CONFIG } from '../config/config';
import { MonitorConfig, PositionAnalysis } from '../types';
import { Address } from 'viem';

// Store previous position states
const positionStates = new Map<
  bigint,
  {
    inRange: boolean;
    timestamp: number;
  }
>();

/**
 * Position monitor instance
 */
export class PositionMonitor {
  private cronJob: CronJob | null = null;
  private config: MonitorConfig;
  private historyDir: string;

  /**
   * Create a new position monitor
   * @param config Monitor configuration
   */
  constructor(config?: Partial<MonitorConfig>) {
    this.config = {
      interval: config?.interval || MONITOR_CONFIG.INTERVAL,
      positionIds: config?.positionIds,
      notifyOnRangeExit: config?.notifyOnRangeExit !== undefined ? config.notifyOnRangeExit : true,
      notifyOnFeeAccrual: config?.notifyOnFeeAccrual !== undefined ? config.notifyOnFeeAccrual : true,
      minFeeThreshold: config?.minFeeThreshold || '0.0001',
      logFile: config?.logFile || MONITOR_CONFIG.LOG_FILE,
    };

    this.historyDir = path.join('logs', 'history');
  }

  /**
   * Start the position monitor
   */
  public async start(): Promise<void> {
    logger.info('Starting position monitor...');

    // Create history directory if it doesn't exist
    try {
      await fs.mkdir(this.historyDir, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create history directory: ${error}`);
    }

    // Initialize position states
    await this.initializePositionStates(BOT_ADDRESS);

    // Run once immediately
    await this.checkPositions();

    // Schedule periodic checks
    this.cronJob = new CronJob(
      this.config.interval,
      async () => {
        try {
          await this.checkPositions();
        } catch (error) {
          logger.error(`Error in scheduled position check: ${error}`);
        }
      },
      null,
      true,
    );

    logger.info(`Position monitor started. Next check: ${this.cronJob.nextDate().toLocaleString()}`);
  }

  /**
   * Stop the position monitor
   */
  public stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('Position monitor stopped');
    }
  }

  /**
   * Initialize position states with current data
   */
  private async initializePositionStates(address: Address): Promise<void> {
    try {
      // Get positions to monitor
      const responses = await getV4Positions(address);

      if (responses.length === 0) {
        logger.warn('No positions found to monitor');
        return;
      }

      logger.info(`Initializing monitoring for ${responses.length} positions...`);

      // Initialize state for each position
      for (const data of responses) {
        try {
          const tokenId = data.tokenId;
          const position = await getPositionInfo(tokenId);
          if (!position) {
            logger.warn(`Position ${tokenId} not found or has zero liquidity`);
            continue;
          }
          positionStates.set(tokenId, {
            inRange: position.inRange,
            timestamp: Date.now(),
          });

          logger.info(
            `Initialized position ${tokenId}: ${position.token0Symbol}/${position.token1Symbol}, In Range: ${position.inRange}`,
          );
        } catch (error) {
          logger.error(`Failed to initialize position ${data.tokenId}: ${error}`);
        }
      }
    } catch (error) {
      logger.error(`Failed to initialize position states: ${error}`);
    }
  }

  /**
   * Check all positions for changes in range status or fee accrual
   */
  private async checkPositions(): Promise<void> {
    try {
      logger.info('Checking positions...');

      // Get positions to monitor
      const positionIds = await getV4Positions(BOT_ADDRESS);

      if (positionIds.length === 0) {
        logger.warn('No positions found to monitor');
        return;
      }

      // Analyze all positions
      const analysis = await analyzeAllPositions(BOT_ADDRESS);

      // Save analysis to history
      await this.saveAnalysisToHistory(analysis);

      // Check each position for state changes
      for (const position of analysis.positions) {
        const tokenId = position.tokenId;
        const previousState = positionStates.get(tokenId);

        // If this is a new position, just add it to the states
        if (!previousState) {
          positionStates.set(tokenId, {
            inRange: position.inRange,
            timestamp: Date.now(),
          });
          logger.info(`New position detected: ${tokenId} (${position.token0Symbol}/${position.token1Symbol})`);
          continue;
        }

        // Check for range exit/entry
        if (previousState.inRange !== position.inRange && this.config.notifyOnRangeExit) {
          if (position.inRange) {
            logger.info(`🟢 Position ${tokenId} (${position.token0Symbol}/${position.token1Symbol}) has entered range`);
          } else {
            logger.warn(`🔴 Position ${tokenId} (${position.token0Symbol}/${position.token1Symbol}) has exited range`);
          }
        }

        // Update state
        positionStates.set(tokenId, {
          inRange: position.inRange,
          timestamp: Date.now(),
        });
      }

      // Log summary
      logger.info(
        `Position check completed. ${analysis.inRangePositions}/${analysis.totalPositions} positions in range.`,
      );

      // Schedule next check
      if (this.cronJob) {
        logger.info(`Next check: ${this.cronJob.nextDate().toLocaleString()}`);
      }
    } catch (error) {
      logger.error(`Failed to check positions: ${error}`);
    }
  }

  /**
   * Save position analysis to history
   * @param analysis Position analysis
   */
  private async saveAnalysisToHistory(analysis: PositionAnalysis): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const filename = `analysis-${timestamp}.json`;
      const filePath = path.join(this.historyDir, filename);

      await fs.writeFile(filePath, JSON.stringify(analysis, null, 2));
      logger.debug(`Saved analysis to ${filePath}`);
    } catch (error) {
      logger.error(`Failed to save analysis to history: ${error}`);
    }
  }
}

export default PositionMonitor;
