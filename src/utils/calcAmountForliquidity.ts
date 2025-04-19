import { formatUnits, type Address } from 'viem';
import { getTokenPairBalances } from './erc20';
import { getPoolData } from '../services/pool';
import { tickToPrice } from '@uniswap/v4-sdk';
import { getTokenByAddress } from '../config/tokens';
import { log } from 'console';
import logger from './logger';
import { TickMath } from './tick/tickMath';
import { nearestUsableTick } from './tick/calculateTicks';

/**
 * Given a wallet and token pair, determines which token balance is lower (in value) and
 * calculates the required amount of the other token based on current pool price.
 * @param owner - Wallet address to check balances for
 * @param token0Address - Address of first token
 * @param token1Address - Address of second token
 * @param fee - Pool fee tier (e.g. 3000)
 * @param tickSpacing - Tick spacing for the pool
 * @returns Object with amount0 and amount1 as strings (human-readable) to use for creating a position
 */
export async function computeCounterpartyAmounts(
  owner: Address,
  token0Address: Address,
  token1Address: Address,
  fee: number,
  tickSpacing: number,
): Promise<{ amount0: bigint; amount1: bigint; tickLower: number; tickUpper: number }> {
  // 1) オンチェーン残高取得 (raw BigInt と formatted number の両方を返す想定)
  const { token0: bal0, token1: bal1 } = await getTokenPairBalances(owner, token0Address, token1Address);
  const token0 = getTokenByAddress(token0Address);
  const token1 = getTokenByAddress(token1Address);

  // 2) プールデータ取得（√価格・レンジ含む）
  const poolData = await getPoolData(token0, token1, fee, tickSpacing);
  const sqrtRatioCurrentX96 = poolData.sqrtPriceX96;

  const { tickLower, tickUpper } = nearestUsableTick(poolData.tick, tickSpacing);
  logger.info(
    `Pool: ${token0.symbol}/${token1.symbol} @ fee=${fee / 10000}% tickLower=${tickLower} tickUpper=${tickUpper}`,
  );
  const sqrtRatioLowerX96 = TickMath.getSqrtRatioAtTick(BigInt(tickLower));
  const sqrtRatioUpperX96 = TickMath.getSqrtRatioAtTick(BigInt(tickUpper));

  const Q96 = 1n << 96n;

  // 3) raw残高を取り出し
  //TODO: ajust to use small amounts compared to balance
  const percentage = 10n; // 10%
  const multiplier = 100n;
  const bal0Raw: bigint = (bal0.balanceWei * percentage) / multiplier;
  const bal1Raw: bigint = (bal1.balanceWei * percentage) / multiplier;

  // 4) どちらが制約かを判定するため「価格ベースの価値比較」
  //    priceX192 = (√P)² = P × 2^192
  const priceX192 = sqrtRatioCurrentX96 * sqrtRatioCurrentX96;
  //    value0 in token1-raw 単位 = bal0Raw × P = bal0Raw × priceX192 / 2^192
  const value0Raw = (bal0Raw * priceX192) / (Q96 * Q96);
  //    value1Raw = bal1Raw

  let amount0: bigint;
  let amount1: bigint;

  if (value0Raw < bal1Raw) {
    logger.info(
      `Token0 (${token0.symbol}) is the constraint asset. Balances: token0=${formatUnits(
        bal0Raw,
        token0.decimals,
      )}, token1=${formatUnits(bal1Raw, token1.decimals)}`,
    );
    // → token0 が制約資産
    amount0 = bal0Raw;
    // L = amount0 × √P × √P_upper / ((√P_upper - √P) × 2^96)
    const liquidity =
      (bal0Raw * sqrtRatioCurrentX96 * sqrtRatioUpperX96) / ((sqrtRatioUpperX96 - sqrtRatioCurrentX96) * Q96);
    // amount1 = L × (√P - √P_lower) / 2^96
    amount1 = (liquidity * (sqrtRatioCurrentX96 - sqrtRatioLowerX96)) / Q96;
  } else {
    logger.info(
      `Token1 (${token1.symbol}) is the constraint asset. Balances: token0=${formatUnits(
        bal0Raw,
        token0.decimals,
      )}, token1=${formatUnits(bal1Raw, token1.decimals)}`,
    );
    // → token1 が制約資産
    amount1 = bal1Raw;
    // L = amount1 × 2^96 / (√P - √P_lower)
    const liquidity = (bal1Raw * Q96) / (sqrtRatioCurrentX96 - sqrtRatioLowerX96);
    // amount0 = L × (√P_upper - √P) × 2^96 / (√P_upper × √P)
    amount0 = (liquidity * (sqrtRatioUpperX96 - sqrtRatioCurrentX96) * Q96) / (sqrtRatioUpperX96 * sqrtRatioCurrentX96);
  }

  // 5) フォーマットして文字列で返却
  logger.info(
    `Using amounts: token0=${token0.symbol} amount0=${formatUnits(amount0, token0.decimals)}, token1=${
      token1.symbol
    } amount1=${formatUnits(amount1, token1.decimals)}`,
  );
  return {
    amount0,
    amount1,
    tickLower,
    tickUpper,
  };
}
