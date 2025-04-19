import { ERC20_ABI } from '../abis';
import { unichain } from '../config/chains';
import { CONTRACTS } from '../config/config';
import { isNative } from '../config/tokens';
import { getPublicClient, getWalletAccount, getWalletClient } from './client';
import logger from './logger';

/**
 * Execute ERC20 approve if necessary for Permit2.
 */
export async function ensureApproval(
  owner: `0x${string}`,
  tokenAddress: `0x${string}`,
  requiredAmount: bigint,
): Promise<void> {
  if (isNative(tokenAddress)) {
    logger.info(`Native ETH – no approval needed: ${tokenAddress}`);
    return;
  }
  const MAX_UINT256 = 2n ** 256n - 1n;
  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const currentAllowance: bigint = (await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, CONTRACTS.PERMIT2],
  })) as bigint;

  if (currentAllowance < requiredAmount * 2n) {
    logger.info(`Approving ${tokenAddress} for Permit2...`);
    const tx = await walletClient.writeContract({
      account: getWalletAccount(),
      address: tokenAddress,
      abi: ERC20_ABI,
      chain: unichain,
      functionName: 'approve',
      args: [CONTRACTS.PERMIT2, MAX_UINT256],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    logger.info(`${tokenAddress} approved for Permit2`);
  } else {
    logger.info(`${tokenAddress} already has sufficient Permit2 approval`);
  }
}
