import { STATE_VIEW_ABI } from '../../abis';
import { CONTRACTS } from '../../config/config';

export const findClosestInitializedTick = async (
  publicClient: any,
  poolId: string,
  currentTick: number,
  tickSpacing: number,
) => {
  // Look for initialized ticks both above and below the current tick
  let lowerTickBitmapIndex = Math.floor(currentTick / (tickSpacing * 256));
  let upperTickBitmapIndex = lowerTickBitmapIndex + 1;

  // Get both bitmaps
  const lowerBitmap = await publicClient.readContract({
    address: CONTRACTS.STATE_VIEW,
    abi: STATE_VIEW_ABI,
    functionName: 'getTickBitmap',
    args: [poolId as `0x${string}`, lowerTickBitmapIndex],
  });

  const upperBitmap = await publicClient.readContract({
    address: CONTRACTS.STATE_VIEW,
    abi: STATE_VIEW_ABI,
    functionName: 'getTickBitmap',
    args: [poolId as `0x${string}`, upperTickBitmapIndex],
  });

  // Find closest tick below
  let lowerInitializedTick = null;
  for (let i = 255; i >= 0; i--) {
    if ((lowerBitmap >> BigInt(i)) & 1n) {
      lowerInitializedTick = (lowerTickBitmapIndex * 256 + i) * tickSpacing;
      if (lowerInitializedTick <= currentTick) {
        break;
      }
    }
  }

  // Find closest tick above
  let upperInitializedTick = null;
  for (let i = 0; i < 256; i++) {
    if ((upperBitmap >> BigInt(i)) & 1n) {
      upperInitializedTick = (upperTickBitmapIndex * 256 + i) * tickSpacing;
      if (upperInitializedTick > currentTick) {
        break;
      }
    }
  }

  // Return the closest initialized tick to current tick
  if (lowerInitializedTick !== null && upperInitializedTick !== null) {
    if (currentTick - lowerInitializedTick <= upperInitializedTick - currentTick) {
      return lowerInitializedTick;
    } else {
      return upperInitializedTick;
    }
  } else if (lowerInitializedTick !== null) {
    return lowerInitializedTick;
  } else if (upperInitializedTick !== null) {
    return upperInitializedTick;
  }

  throw new Error('No initialized tick found in nearby range');
};
