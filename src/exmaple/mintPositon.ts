import { Pool, Position, V4PositionManager, MintOptions } from '@uniswap/v4-sdk';
import { Percent, Token, Ether, Currency } from '@uniswap/sdk-core';
import type { Address } from 'viem';
import { zeroAddress } from 'viem';
import { getPublicClient, getWalletClient, getWalletAccount } from '../utils/client';
import { CONTRACTS, PERMIT2_TYPES } from '../config/config';
import { PERMIT2_ABI, POSITION_MANAGER_ABI } from '../abis';
import { getPoolData } from './getPool';
import { unichain } from '../config/chains';
import { chainId } from './createLiquidityPosition';

/**
 * Type definition for token information
 */
interface TokenInfo {
  /** Chain ID */
  chainId: number;
  /** Token contract address */
  address: Address;
  /** Number of decimal places for the token */
  decimals: number;
  /** Token symbol */
  symbol: string;
  /** Whether it's a native token or not */
  isNative: boolean;
}

/**
 * Mint a V4 position
 * @param user User information
 * @param tokenAInfo Information about the first token
 * @param tokenBInfo Information about the second token
 * @param amountADesired Desired amount of token A
 * @param amountBDesired Desired amount of token B
 * @param fee Fee tier
 * @param fullRange Whether it's a full range position or not
 * @param tickRange Percentage range around current price (as a percentage)
 * @param options Additional options (slippage tolerance, etc.)
 * @returns Position creation result
 */
async function mintV4Position(
  user: { address: Address },
  tokenAInfo: TokenInfo,
  tokenBInfo: TokenInfo,
  amountADesired: bigint | string,
  amountBDesired: bigint | string,
  fee: number,
  fullRange: boolean = false,
  tickRange: number = 10,
  options?: {
    slippageTolerance?: number;
    deadline?: number;
    usePermit2?: boolean;
  },
) {
  try {
    // 1. Get clients and account
    const publicClient = getPublicClient();
    const walletClient = getWalletClient();
    const account = getWalletAccount();

    // Option parsing
    const slippageTolerance = options?.slippageTolerance ?? 0.5; // Default 0.5%
    const deadlineSeconds = options?.deadline ?? 30 * 60; // Default 30 minutes
    const usePermit2 = options?.usePermit2 ?? false;

    // 2. Create Currency objects from token info (modified part)
    let tokenA: Currency;
    let tokenB: Currency;

    if (tokenAInfo.isNative) {
      tokenA = Ether.onChain(chainId);
    } else {
      tokenA = new Token(chainId, tokenAInfo.address, tokenAInfo.decimals, tokenAInfo.symbol);
    }

    if (tokenBInfo.isNative) {
      tokenB = Ether.onChain(chainId);
    } else {
      tokenB = new Token(chainId, tokenBInfo.address, tokenBInfo.decimals, tokenBInfo.symbol);
    }

    // 4. Simple token sorting using addresses
    // Simply sort by address to determine token0 and token1
    const addressA = tokenAInfo.isNative ? zeroAddress : tokenAInfo.address;
    const addressB = tokenBInfo.isNative ? zeroAddress : tokenBInfo.address;

    // Simple string comparison for sorting
    const token0IsA = addressA.toLowerCase() < addressB.toLowerCase();
    const token0 = token0IsA ? tokenA : tokenB;
    const token1 = token0IsA ? tokenB : tokenA;

    console.log(`Token ordering (simplified): 
      - Token0: ${token0IsA ? tokenAInfo.symbol : tokenBInfo.symbol} (${token0IsA ? addressA : addressB})
      - Token1: ${token0IsA ? tokenBInfo.symbol : tokenAInfo.symbol} (${token0IsA ? addressB : addressA})
    `);

    // 5. Sort amounts based on token order
    const amount0Desired = token0IsA ? amountADesired.toString() : amountBDesired.toString();
    const amount1Desired = token0IsA ? amountBDesired.toString() : amountADesired.toString();

    // 6. Get pool data
    // Fetch pool data using the sorted tokens
    const tickSpacing = getTickSpacingFromFee(fee);

    console.log(`Fetching pool data for:
        - Token0: ${token0.symbol}
        - Token1: ${token1.symbol}
        - Fee: ${fee}
        - Tick spacing: ${tickSpacing}
        - Hook address: ${zeroAddress}
        - Pool ID: ${Pool.getPoolId(token0, token1, fee, tickSpacing, zeroAddress)}
        `);
    const poolData = await getPoolData(token0, token1, fee, tickSpacing, zeroAddress);

    console.log(`Pool data retrieved:
      - sqrtPrice: ${poolData.sqrtPriceX96.toString()}
      - liquidity: ${poolData.liquidity.toString()}
      - current tick: ${poolData.tick}
    `);

    // 7. Calculate tick boundaries based on fullRange and tickRange
    let tickLower: number;
    let tickUpper: number;

    if (fullRange) {
      // Uniswap's minimum and maximum allowed ticks (fixed)
      const MIN_TICK = -887272;
      const MAX_TICK = 887272;

      // Dynamically get tickSpacing based on feeTier
      const tickSpacing = getTickSpacingFromFee(fee);

      // Round tickLower up (closer to the upper direction)
      tickLower = nearestUsableTick(MIN_TICK, tickSpacing, true);

      // Round tickUpper down (closer to the lower direction)
      tickUpper = nearestUsableTick(MAX_TICK, tickSpacing, false);
    } else {
      // Calculate based on percentage range around current tick
      const currentTick = poolData.tick;
      const tickRangeAmount = Math.floor((tickRange / 100) * 10000); // Convert percentage to tick count
      tickLower = Math.floor((currentTick - tickRangeAmount) / tickSpacing) * tickSpacing;
      tickUpper = Math.floor((currentTick + tickRangeAmount) / tickSpacing) * tickSpacing;
    }

    console.log(`Using tick range: ${tickLower} to ${tickUpper} ${fullRange ? '(Full Range)' : ''}`);

    // 8. Create Pool instance
    const pool = new Pool(
      poolData.token0,
      poolData.token1,
      poolData.fee,
      poolData.tickSpacing,
      poolData.hooks,
      poolData.sqrtPriceX96.toString(),
      poolData.liquidity.toString(),
      poolData.tick,
    );

    // 9. Create Position
    const position = Position.fromAmounts({
      pool,
      tickLower,
      tickUpper,
      amount0: amount0Desired,
      amount1: amount1Desired,
      useFullPrecision: true,
    });
    console.log(`Position created with:
        - Amount0: ${position.amount0.toExact()}
        - Amount1: ${position.amount1.toExact()}
        - Liquidity: ${position.liquidity.toString()}
      `);
    console.log(`tickLower: ${position.tickLower}, tickUpper: ${position.tickUpper}`);

    const currentBlock = await publicClient.getBlock();
    const currentBlockTimestamp = Number(currentBlock.timestamp);
    const deadline = currentBlockTimestamp + deadlineSeconds;

    console.log(
      `Current block timestamp: ${currentBlockTimestamp} (${new Date(currentBlockTimestamp * 1000).toISOString()})`,
    );

    console.log(`Set deadline: ${deadline} (${new Date(deadline * 1000).toISOString()})`);

    // 10. Build MintOptions
    const slippagePct = new Percent(Math.floor(slippageTolerance * 100), 10_000);

    const mintOptions: MintOptions = {
      recipient: user.address,
      slippageTolerance: slippagePct,
      deadline: deadline.toString(),
      useNative: tokenAInfo.isNative
        ? Ether.onChain(tokenAInfo.chainId)
        : tokenBInfo.isNative
        ? Ether.onChain(tokenBInfo.chainId)
        : undefined,
    };

    // 11. Configure Permit2 (if usePermit2 is enabled)
    if (usePermit2) {
      // Generate Permit2 only for ERC20 tokens
      const permitDetails = [];

      if (!tokenAInfo.isNative) {
        const [, , nonce] = (await publicClient.readContract({
          account: getWalletAccount(),
          address: CONTRACTS.PERMIT2,
          abi: PERMIT2_ABI,
          functionName: 'allowance',
          args: [user.address, tokenAInfo.address, CONTRACTS.POSITION_MANAGER],
        })) as [bigint, bigint, bigint];
        permitDetails.push({
          token: tokenAInfo.address,
          amount: (2n ** 160n - 1n).toString(), // MAX_UINT160
          expiration: deadline.toString(),
          nonce: nonce.toString(),
        });
      }

      if (!tokenBInfo.isNative) {
        const [, , nonce] = (await publicClient.readContract({
          account: getWalletAccount(),
          address: CONTRACTS.PERMIT2,
          abi: PERMIT2_ABI,
          functionName: 'allowance',
          args: [user.address, tokenBInfo.address, CONTRACTS.POSITION_MANAGER],
        })) as [bigint, bigint, bigint];
        permitDetails.push({
          token: tokenBInfo.address,
          amount: (2n ** 160n - 1n).toString(), // MAX_UINT160
          expiration: deadline.toString(),
          nonce: nonce.toString(),
        });
      }

      if (permitDetails.length > 0) {
        const permitData = {
          details: permitDetails,
          spender: CONTRACTS.POSITION_MANAGER,
          sigDeadline: deadline.toString(),
        };

        // Permit2 signature
        const signature = await walletClient.signTypedData({
          account,
          domain: {
            name: 'Permit2',
            chainId: unichain.id,
            verifyingContract: CONTRACTS.PERMIT2,
          },
          types: PERMIT2_TYPES,
          primaryType: 'PermitBatch',
          message: permitData,
        });

        mintOptions.batchPermit = {
          owner: user.address,
          permitBatch: permitData,
          signature,
        };
      }
    }
    console.log('Permit2 signature result:', mintOptions.batchPermit);

    // 12. Get call data
    const { calldata, value } = V4PositionManager.addCallParameters(position, mintOptions);

    console.log(`Deadline set in MintOptions: ${mintOptions.deadline}`);
    console.log(`Calldata to be sent: ${calldata}`);

    // 13. Send transaction
    const txHash = await walletClient.writeContract({
      account,
      chain: unichain,
      address: CONTRACTS.POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'multicall',
      args: [[calldata]],
      value: BigInt(value),
    });

    // 14. Get receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    console.log('Transaction receipt:', receipt);
    return {
      success: true,
      receipt,
      positionDetails: {
        token0: token0.symbol,
        token1: token1.symbol,
        fee: fee,
        tickLower,
        tickUpper,
        amount0: amount0Desired,
        amount1: amount1Desired,
      },
    };
  } catch (error) {
    console.error('Failed to mint position:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get tick spacing from fee tier
 */
function getTickSpacingFromFee(feeTier: number): number {
  switch (feeTier) {
    case 100:
      return 1; // 0.01%
    case 500:
      return 10; // 0.05%
    case 3000:
      return 60; // 0.3%
    case 10000:
      return 200; // 1%
    default:
      return 60; // Default
  }
}

/**
 * Round tick to a multiple of tickSpacing
 * @param tick The tick value to round
 * @param tickSpacing The tick spacing value
 * @param roundUp True for rounding up, false for rounding down
 */
function nearestUsableTick(tick: number, tickSpacing: number, roundUp: boolean): number {
  if (tick % tickSpacing === 0) return tick;
  if (tick > 0) {
    return roundUp ? tick + (tickSpacing - (tick % tickSpacing)) : tick - (tick % tickSpacing);
  } else {
    return roundUp ? tick - (tick % tickSpacing) : tick - (tickSpacing + (tick % tickSpacing));
  }
}

export { mintV4Position, TokenInfo };
