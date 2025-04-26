import 'dotenv/config';

// Import the necessary math utilities
import { SqrtPriceMath } from './sqrtPriceMath';
import { TickMath } from './tickMath';

// Price factor for 1 tick
const TICK_TO_PRICE_FACTOR = 1.0001;

/**
 * Convert price to tick
 * @param price Token0/Token1 price
 * @returns tick value (not adjusted for tick spacing)
 */
export function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(TICK_TO_PRICE_FACTOR));
}

/**
 * Convert tick to price
 * @param tick tick value
 * @returns price of Token0 in terms of Token1
 */
export function tickToPrice(tick: number): number {
  return Math.pow(TICK_TO_PRICE_FACTOR, tick);
}

export function nearestUsableTick(tick: number, tickSpacing: number, rangeWidth: number = 1) {
  // Calculate the nearest multiples of tick spacing
  // Lower bound: largest multiple of tickSpacing less than or equal to current tick
  const lowerTick = Math.floor(tick / tickSpacing) * tickSpacing;

  // Upper bound: smallest multiple of tickSpacing greater than current tick
  let upperTick = Math.ceil(tick / tickSpacing) * tickSpacing;

  if (upperTick <= lowerTick) {
    upperTick = lowerTick + tickSpacing;
  }

  if (rangeWidth === 1) {
    // デフォルト動作
    return {
      tickLower: lowerTick,
      tickUpper: upperTick,
    };
  } else {
    // tickSpacingの倍数を単純に追加
    const extraTicks = rangeWidth - 1;

    return {
      tickLower: lowerTick - extraTicks * tickSpacing,
      tickUpper: upperTick + extraTicks * tickSpacing,
    };
  }
}

/**
 * Get amount of token0 for a liquidity position
 * @param tickLower Lower tick of position
 * @param tickUpper Upper tick of position
 * @param currTick Current tick of the pool
 * @param amount Liquidity amount
 * @param currSqrtPriceX96 Current sqrt price X96
 * @returns Amount of token0
 */
export function getAmount0(
  tickLower: bigint,
  tickUpper: bigint,
  currTick: bigint,
  amount: bigint,
  currSqrtPriceX96: bigint,
): bigint {
  // Get the square root ratios at the ticks
  const sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
  const sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

  let amount0 = 0n;
  const roundUp = amount > 0n;

  if (currTick < tickLower) {
    // Position is entirely below the current tick
    amount0 = SqrtPriceMath.getAmount0Delta(sqrtRatioAX96, sqrtRatioBX96, amount, roundUp);
  } else if (currTick < tickUpper) {
    // Position straddles the current tick
    amount0 = SqrtPriceMath.getAmount0Delta(currSqrtPriceX96, sqrtRatioBX96, amount, roundUp);
  }
  // Position is entirely above current tick - no token0

  return amount0;
}

/**
 * Get amount of token1 for a liquidity position
 * @param tickLower Lower tick of position
 * @param tickUpper Upper tick of position
 * @param currTick Current tick of the pool
 * @param amount Liquidity amount
 * @param currSqrtPriceX96 Current sqrt price X96
 * @returns Amount of token1
 */
export function getAmount1(
  tickLower: bigint,
  tickUpper: bigint,
  currTick: bigint,
  amount: bigint,
  currSqrtPriceX96: bigint,
): bigint {
  // Get the square root ratios at the ticks
  const sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
  const sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);

  let amount1 = 0n;
  const roundUp = amount > 0n;

  if (currTick < tickLower) {
    // Position is entirely below the current tick - no token1
    amount1 = 0n;
  } else if (currTick < tickUpper) {
    // Position straddles the current tick
    amount1 = SqrtPriceMath.getAmount1Delta(sqrtRatioAX96, currSqrtPriceX96, amount, roundUp);
  } else {
    // Position is entirely above the current tick
    amount1 = SqrtPriceMath.getAmount1Delta(sqrtRatioAX96, sqrtRatioBX96, amount, roundUp);
  }

  return amount1;
}

/**
 * Utility function to convert token amount with decimals to human-readable format
 * @param amount Raw token amount
 * @param decimals Token decimals
 * @returns Formatted amount as a string
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const wholePart = amount / divisor;
  const fractionalPart = amount % divisor;

  // Format the fractional part to have leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');

  return `${wholePart}.${fractionalStr}`;
}

/**
 * Calculate price from sqrtPriceX96
 * @param sqrtPriceX96 Square root price in X96 format
 * @returns price Token0/Token1 price
 */
export function calculatePriceFromSqrtPriceX96(sqrtPriceX96: bigint): number {
  const sqrtPrice = Number(sqrtPriceX96) / Math.pow(2, 96);
  return Math.pow(sqrtPrice, 2);
}
