// https://github.com/Uniswap/sdks/blob/92b765bdf2759e5e6639a01728a96df81efbaa2b/sdks/v3-sdk/src/utils/tickMath.ts

function mulShift(val: bigint, mulBy: bigint): bigint {
  return (val * mulBy) >> 128n;
}

export class TickMath {
  /**
   * The minimum tick that can be used on any pool.
   */
  static MIN_TICK = -887272n;
  /**
   * The maximum tick that can be used on any pool.
   */
  static MAX_TICK = 887272n;

  /**
   * The sqrt ratio corresponding to the minimum tick that could be used on any pool.
   */
  static MIN_SQRT_RATIO = 4295128739n;
  /**
   * The sqrt ratio corresponding to the maximum tick that could be used on any pool.
   */
  static MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

  /**
   * Returns the sqrt ratio as a Q64.96 for the given tick. The sqrt ratio is computed as sqrt(1.0001)^tick
   * @param tick the tick for which to compute the sqrt ratio
   */
  static getSqrtRatioAtTick(tick: bigint): bigint {
    if (tick < TickMath.MIN_TICK || tick > TickMath.MAX_TICK) {
      throw new Error('TICK');
    }
    const absTick = tick < 0n ? -tick : tick;

    let ratio: bigint =
      (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;

    if ((absTick & 0x2n) !== 0n) ratio = mulShift(ratio, 0xfff97272373d413259a46990580e213an);
    if ((absTick & 0x4n) !== 0n) ratio = mulShift(ratio, 0xfff2e50f5f656932ef12357cf3c7fdccn);
    if ((absTick & 0x8n) !== 0n) ratio = mulShift(ratio, 0xffe5caca7e10e4e61c3624eaa0941cd0n);
    if ((absTick & 0x10n) !== 0n) ratio = mulShift(ratio, 0xffcb9843d60f6159c9db58835c926644n);
    if ((absTick & 0x20n) !== 0n) ratio = mulShift(ratio, 0xff973b41fa98c081472e6896dfb254c0n);
    if ((absTick & 0x40n) !== 0n) ratio = mulShift(ratio, 0xff2ea16466c96a3843ec78b326b52861n);
    if ((absTick & 0x80n) !== 0n) ratio = mulShift(ratio, 0xfe5dee046a99a2a811c461f1969c3053n);
    if ((absTick & 0x100n) !== 0n) ratio = mulShift(ratio, 0xfcbe86c7900a88aedcffc83b479aa3a4n);
    if ((absTick & 0x200n) !== 0n) ratio = mulShift(ratio, 0xf987a7253ac413176f2b074cf7815e54n);
    if ((absTick & 0x400n) !== 0n) ratio = mulShift(ratio, 0xf3392b0822b70005940c7a398e4b70f3n);
    if ((absTick & 0x800n) !== 0n) ratio = mulShift(ratio, 0xe7159475a2c29b7443b29c7fa6e889d9n);
    if ((absTick & 0x1000n) !== 0n) ratio = mulShift(ratio, 0xd097f3bdfd2022b8845ad8f792aa5825n);
    if ((absTick & 0x2000n) !== 0n) ratio = mulShift(ratio, 0xa9f746462d870fdf8a65dc1f90e061e5n);
    if ((absTick & 0x4000n) !== 0n) ratio = mulShift(ratio, 0x70d869a156d2a1b890bb3df62baf32f7n);
    if ((absTick & 0x8000n) !== 0n) ratio = mulShift(ratio, 0x31be135f97d08fd981231505542fcfa6n);
    if ((absTick & 0x10000n) !== 0n) ratio = mulShift(ratio, 0x9aa508b5b7a84e1c677de54f3e99bc9n);
    if ((absTick & 0x20000n) !== 0n) ratio = mulShift(ratio, 0x5d6af8dedb81196699c329225ee604n);
    if ((absTick & 0x40000n) !== 0n) ratio = mulShift(ratio, 0x2216e584f5fa1ea926041bedfe98n);
    if ((absTick & 0x80000n) !== 0n) ratio = mulShift(ratio, 0x48a170391f7dc42444e8fa2n);

    if (tick > 0n) {
      const MAX_UINT_256 = 2n ** 256n - 1n;
      ratio = MAX_UINT_256 / ratio;
    }

    // Equivalent to: ratio / 2^32 + (ratio % 2^32 > 0 ? 1 : 0)
    const result = ratio >> 32n;
    const remainder = ratio & ((1n << 32n) - 1n);
    return result + (remainder > 0n ? 1n : 0n);
  }
}

/**
 * Adjust raw tick to be a multiple of the tick spacing
 * @param tick raw tick
 * @param tickSpacing tick spacing of the pool
 * @returns tick adjusted to be a multiple of tickSpacing
 */
export function nearestUsableTick(tick: number, tickSpacing: number): number {
  // Calculate the nearest multiples of tick spacing
  const floor = Math.floor(tick / tickSpacing) * tickSpacing;
  const ceil = Math.ceil(tick / tickSpacing) * tickSpacing;

  // Determine which one is closer to the original tick
  return tick - floor < ceil - tick ? floor : ceil;
}
