import { Address } from 'cluster';
import { zeroAddress } from 'viem';
import { getTokenByAddress, TICK_SPACINGS, FeeAmount } from '../config/tokens';
import { getPoolData } from '../services/pool';
import { getPublicClient } from './client';
import logger from './logger';

/**
 * Fetches the current USD price of a token
 * @param tokenAddress The address of the token to get the price for
 * @returns The USD price of the token, or null if price cannot be retrieved
 */
export async function fetchPriceUSD(tokenAddress: `0x${string}`): Promise<number | null> {
  try {
    // Define stablecoin addresses for your network
    const stablecoinAddresses = {
      USDC: '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
      USDT: '0x9151434b16b9763660705744891fA906F660EcC5',
    };

    // Check if this token is a stablecoin (USDC, USDT, etc)
    const tokenAddressLower = tokenAddress.toLowerCase();
    for (const [symbol, address] of Object.entries(stablecoinAddresses)) {
      if (address.toLowerCase() === tokenAddressLower) {
        logger.info(`Token is stablecoin (${symbol}), using 1.0 USD price`);
        return 1.0; // Stablecoins are worth 1 USD
      }
    }

    // For ETH and other tokens, try to find a token/stablecoin pool
    const tokenInfo = getTokenByAddress(tokenAddress);

    // Try each stablecoin to find a price pool
    for (const [stableName, stableAddress] of Object.entries(stablecoinAddresses)) {
      try {
        const stableInfo = getTokenByAddress(stableAddress);

        // Try different fee tiers for better liquidity
        const feeTiers = [500, 3000, 10000];

        for (const feeTier of feeTiers) {
          try {
            // Get pool data for token/stablecoin
            const poolData = await getPoolData(
              tokenInfo,
              stableInfo,
              feeTier,
              TICK_SPACINGS[feeTier as FeeAmount],
              zeroAddress,
            );

            if (poolData && poolData.sqrtPriceX96 && poolData.sqrtPriceX96 > 0n) {
              const sqrtRatioX96 = poolData.sqrtPriceX96;

              // BigIntでまず二乗する
              const ratioX192 = sqrtRatioX96 * sqrtRatioX96;

              let priceRatio: number;

              // tokenの順序で計算方法を変える
              if (tokenInfo.address.toLowerCase() === poolData.token0.address.toLowerCase()) {
                // token0/token1
                priceRatio = Number(ratioX192) / Math.pow(2, 192);
                const decimalAdjustment = 10 ** (tokenInfo.decimals - stableInfo.decimals);
                priceRatio = priceRatio * decimalAdjustment;
              } else {
                // token1/token0
                priceRatio = Math.pow(2, 192) / Number(ratioX192);
                const decimalAdjustment = 10 ** (tokenInfo.decimals - stableInfo.decimals);
                priceRatio = priceRatio * decimalAdjustment;
              }

              logger.info(`${tokenInfo.symbol} price in ${stableName} (${feeTier} fee tier): ${priceRatio}`);
              return priceRatio;
            }
          } catch (e) {
            logger.debug(`Failed to get price using ${stableName} pool with fee tier ${feeTier}: ${e}`);
            continue; // Try next fee tier
          }
        }
      } catch (e) {
        logger.debug(`Failed to get price using ${stableName} pools: ${e}`);
        continue; // Try next stablecoin
      }
    }

    // If we get here, we couldn't find a price through direct pools
    logger.warn(`Could not fetch USD price for token ${tokenInfo.symbol} using any pools`);
    return null;
  } catch (error) {
    logger.error(`Error fetching token price: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// export async function quoteExactInputSingleV4(
//   tokenIn: Address,
//   tokenOut: Address,
//   amountInHuman: string,
//   feeTier: number = 3000,
//   hooks: Address = zeroAddress,
// ): Promise<{ amountOutHuman: string; gasEstimate: bigint } | null> {
//   const client = getPublicClient();
//   const inToken = getTokenByAddress(tokenIn);
//   const outToken = getTokenByAddress(tokenOut);

//   const poolData = await getPoolData(inToken, outToken, feeTier, TICK_SPACINGS[feeTier as FeeAmount], hooks);

//   const exactAmount = BigInt(parseUnits(amountInHuman, inToken.decimals).toString());
//   const zeroForOne = tokenIn.toLowerCase() === poolData.token0.address.toLowerCase();
//   const hookData = '0x' as `0x${string}`;

//   const params = {
//     poolKey: {
//       currency0: poolData.token0.address as Address,
//       currency1: poolData.token1.address as Address,
//       fee: feeTier,
//       tickSpacing: poolData.tickSpacing,
//       hooks,
//     },
//     zeroForOne,
//     exactAmount,
//     hookData,
//   };

//   try {
//     // Standard approach - though this will intentionally revert in Uniswap v4
//     const [amountOut, gasEstimate] = (await client.simulateContract({
//       address: CONTRACTS.V4QUOTER,
//       abi: V4QUOTER_ABI,
//       functionName: 'quoteExactInputSingle',
//       args: [params],
//     })) as unknown as [bigint, bigint];

//     // If we somehow get here, use the result
//     return {
//       amountOutHuman: formatUnits(amountOut, outToken.decimals),
//       gasEstimate,
//     };
//   } catch (error: any) {
//     // In Uniswap v4, the quoter INTENTIONALLY reverts with the result
//     logger.info('Processing intentional Uniswap v4 quote revert...');

//     try {
//       // Method 1: Look for direct QuoteSwap error
//       if (error.data?.errorName === 'QuoteSwap' && error.data?.args && error.data.args.length > 0) {
//         const amountOut = BigInt(error.data.args[0].toString());
//         const gasEstimate = BigInt(300000); // Default

//         logger.info(`Quote successful: ${formatUnits(amountOut, outToken.decimals)} ${outToken.symbol}`);
//         return {
//           amountOutHuman: formatUnits(amountOut, outToken.decimals),
//           gasEstimate,
//         };
//       }

//       // Method 2: Handle UnexpectedRevertBytes pattern
//       if (error.cause && error.cause.data && error.cause.data.errorName === 'UnexpectedRevertBytes') {
//         const revertBytes = error.cause.data.args ? error.cause.data.args[0] : null;

//         if (revertBytes) {
//           // Try direct conversion - this worked in our test case
//           try {
//             const amountOut = BigInt(revertBytes);
//             logger.info(
//               `Quote successful (direct conversion): ${formatUnits(amountOut, outToken.decimals)} ${outToken.symbol}`,
//             );

//             return {
//               amountOutHuman: formatUnits(amountOut, outToken.decimals),
//               gasEstimate: BigInt(300000),
//             };
//           } catch (directError) {
//             // Continue to next method if this fails
//           }

//           // Try extracting the last 64 characters (32 bytes for uint256)
//           if (revertBytes.length >= 66) {
//             // 0x + at least 64 chars
//             try {
//               const hexValue = '0x' + revertBytes.slice(-64);
//               const amountOut = BigInt(hexValue);

//               logger.info(
//                 `Quote successful (last 64 chars): ${formatUnits(amountOut, outToken.decimals)} ${outToken.symbol}`,
//               );
//               return {
//                 amountOutHuman: formatUnits(amountOut, outToken.decimals),
//                 gasEstimate: BigInt(300000),
//               };
//             } catch (hex64Error) {
//               // Continue to fallback if this fails
//             }
//           }
//         }
//       }

//       // Fallback: Use pool-based price calculation
//       if (poolData.sqrtPriceX96 && poolData.sqrtPriceX96 > 0n) {
//         const sqrtRatio = poolData.sqrtPriceX96;

//         // Calculate price ratio based on token direction
//         let priceRatio: number;

//         if (zeroForOne) {
//           // token0 to token1: use sqrt price directly
//           priceRatio = Number(sqrtRatio * sqrtRatio) / 2 ** 192;
//         } else {
//           // token1 to token0: invert the price
//           priceRatio = 2 ** 192 / Number(sqrtRatio * sqrtRatio);
//         }

//         // Adjust for token decimals
//         const decimalAdjustment = 10 ** (outToken.decimals - inToken.decimals);
//         priceRatio = priceRatio * decimalAdjustment;

//         // Apply safety margin for slippage (3%)
//         const safetyFactor = 0.97;
//         const estimatedOut = Number(exactAmount) * priceRatio * safetyFactor;

//         // Convert to BigInt for consistent handling
//         const amountOutBigInt = BigInt(Math.floor(estimatedOut));

//         logger.info(
//           `Fallback price calculation: ${formatUnits(amountOutBigInt, outToken.decimals)} ${outToken.symbol}`,
//         );
//         return {
//           amountOutHuman: formatUnits(amountOutBigInt, outToken.decimals),
//           gasEstimate: BigInt(300000),
//         };
//       }
//     } catch (recoveryError) {
//       logger.error('All recovery methods failed:', recoveryError);
//     }

//     logger.error(`Quote failed: ${error instanceof Error ? error.message : String(error)}`);
//     return null;
//   }
// }
