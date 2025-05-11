import { TOKEN_ADDRESSES } from '../config/tokens';
import { createLiquidityPosition } from './createLiquidityPosition';

/**
 * Examples of creating different Uniswap V4 positions
 */
async function examples() {
  try {
    // // Example: Create a WETH-USDT position with full range
    // console.log('Creating a WETH-USDT position with full range...');
    // const result = await createLiquidityPosition(
    //   'NATIVE',
    //   TOKEN_ADDRESSES.USDT,
    //   0.002, // 0.25 WETH
    //   4, // 450 USDT
    //   500, // 0.05% fee tier
    //   true, // full range
    //   0, // full range (0 ticks)
    //   {
    //     slippageTolerance: 0.5, // 0.5% slippage tolerance
    //     usePermit2: true,
    //   },
    // );
    const result = await createLiquidityPosition(
      'NATIVE',
      TOKEN_ADDRESSES.USDC,
      0.002, // 0.002 WETH
      4, // 4 USDC
      500, // 0.05% fee tier
      true, // full range
      0, // full range (0 ticks)
      {
        slippageTolerance: 0.5, // 0.5% slippage tolerance
        usePermit2: true,
      },
    );
    console.log('Position created:', result);
  } catch (error) {
    console.error('Error in examples:', error);
  }
}

// Execute the examples
// bun run src/exmaple/testLiq.ts
examples().then(() => console.log('Examples completed!'));
