// https://github.com/Uniswap/sdks/blob/30b98e09d0486cd5cc3e4360e3277eb7cb60d2d5/sdks/v3-sdk/src/utils/fullMath.ts#L4

const Q96 = 2n ** 96n;
export class FullMath {
  public static mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
    const product = a * b;
    let result = product / denominator;
    if (product % denominator !== 0n) result = result + 1n;
    return result;
  }
}

export class SqrtPriceMath {
  public static getAmount0Delta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundUp: boolean,
  ): bigint {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
    }

    const numerator1 = liquidity << 96n;
    const numerator2 = sqrtRatioBX96 - sqrtRatioAX96;

    return roundUp
      ? FullMath.mulDivRoundingUp(FullMath.mulDivRoundingUp(numerator1, numerator2, sqrtRatioBX96), 1n, sqrtRatioAX96)
      : (numerator1 * numerator2) / sqrtRatioBX96 / sqrtRatioAX96;
  }

  public static getAmount1Delta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundUp: boolean,
  ): bigint {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
    }

    const difference = sqrtRatioBX96 - sqrtRatioAX96;

    return roundUp ? FullMath.mulDivRoundingUp(liquidity, difference, Q96) : (liquidity * difference) / Q96;
  }
}
