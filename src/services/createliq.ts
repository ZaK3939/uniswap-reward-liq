import { Ether, Percent } from '@uniswap/sdk-core';
import { tickToPrice, Pool, Position, V4PositionManager, MintOptions } from '@uniswap/v4-sdk';
import type { Address } from 'viem';
import { formatUnits, parseUnits, zeroAddress } from 'viem';
import { getPublicClient, getWalletAccount, getWalletClient } from '../utils/client';
import { TX_CONFIG, CONTRACTS, BOT_ADDRESS, PERMIT2_DOMAIN, PERMIT2_TYPES, MAX_UINT160 } from '../config/config';
import { getPositionInfo } from './positions';
import logger from '../utils/logger';
import type { CreatePositionParams, CreatePositionResult } from '../types';
import { unichain } from '../config/chains';
import { PERMIT2_ABI, POSITION_MANAGER_ABI } from '../abis';
import { isNative } from '../config/tokens';
import { ensureApproval } from '../utils/approve';

/**
 * Build the details array for Permit2 batch permit.
 */
async function buildPermitDetails(
  owner: Address,
  tokens: { address: Address; decimals: number }[],
  deadline: bigint,
): Promise<
  {
    token: Address;
    amount: string;
    expiration: string;
    nonce: string;
  }[]
> {
  const details: {
    token: Address;
    amount: string;
    expiration: string;
    nonce: string;
  }[] = [];
  const publicClient = getPublicClient();
  for (const { address } of tokens) {
    if (isNative(address)) {
      logger.info(`Native ETH – skipping Permit2 details: ${address}`);
      continue;
    }

    // Read [amount, expiration, nonce] from Permit2 contract
    const [, , nonce] = (await publicClient.readContract({
      account: getWalletAccount(),
      address: CONTRACTS.PERMIT2,
      abi: PERMIT2_ABI,
      functionName: 'allowance',
      args: [owner, address, CONTRACTS.POSITION_MANAGER],
    })) as [bigint, bigint, bigint];

    details.push({
      token: address,
      amount: MAX_UINT160.toString(),
      expiration: deadline.toString(),
      nonce: nonce.toString(),
    });
  }

  return details;
}

export async function signPermit2Payload(payload: {
  details: {
    token: Address;
    amount: string;
    expiration: string;
    nonce: string;
  }[];
  spender: Address;
  sigDeadline: string;
}): Promise<string> {
  const walletClient = getWalletClient();
  const account = getWalletAccount();
  const chainId = await walletClient.getChainId();
  const signature = await walletClient.signTypedData({
    domain: PERMIT2_DOMAIN(chainId),
    types: PERMIT2_TYPES,
    primaryType: 'PermitBatch',
    message: payload,
    account,
  });
  return signature;
}

export async function createPosition(params: CreatePositionParams): Promise<CreatePositionResult> {
  // ─── 1) Client & Account ───
  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const account = getWalletAccount();
  const chainId = await walletClient.getChainId();

  if (chainId !== unichain.id) {
    throw new Error(`Chain ID mismatch: expected ${unichain.id}, got ${chainId}`);
  }
  const owner = BOT_ADDRESS;
  if (!owner) throw new Error('Wallet not connected');

  // ─── 2) Parameter extraction ───
  const {
    poolData,
    amount0,
    amount1,
    tickLower,
    tickUpper,
    slippageTolerance = TX_CONFIG.SLIPPAGE_TOLERANCE,
    deadline = Math.floor(Date.now() / 1_000) + 30 * 60,
  } = params;

  // ─── 3) Token & Pool information ───
  const token0 = poolData.token0;
  const token1 = poolData.token1;
  logger.info(`Creating ${token0.symbol}/${token1.symbol} @ fee=${poolData.fee / 10000}%`);

  const currency0 = poolData.token0.address === zeroAddress ? Ether.onChain(chainId) : poolData.token0;
  const currency1 = poolData.token1.address === zeroAddress ? Ether.onChain(chainId) : poolData.token1;
  // ─── 4) Pool & Position instances ───
  const pool = new Pool(
    currency0,
    currency1,
    poolData.fee,
    poolData.tickSpacing,
    zeroAddress,
    poolData.sqrtPriceX96.toString(),
    poolData.liquidity.toString(),
    poolData.tick,
  );

  // Parse values reliably
  logger.info(`amount0: ${amount0.toString()}, amount1: ${amount1.toString()}`);
  logger.info(
    `Creating position with amounts: ${formatUnits(amount0, token0.decimals)} ${token0.symbol}, ${formatUnits(
      amount1,
      token1.decimals,
    )} ${token1.symbol}`,
  );

  // Calculate liquidity precisely
  const pos = Position.fromAmounts({
    pool,
    tickLower,
    tickUpper,
    amount0: amount0.toString(),
    amount1: amount1.toString(),
    useFullPrecision: true,
  });
  logger.info(`amount0: ${amount0.toString()}, amount1: ${amount1.toString()}`);
  logger.info(`Position liquidity: ${pos.liquidity.toString()}`);
  logger.info(
    `Price range: ${tickToPrice(pool.token0, pool.token1, tickLower).toSignificant(6)} - ${tickToPrice(
      pool.token0,
      pool.token1,
      tickUpper,
    ).toSignificant(6)}`,
  );

  // Step 1: Ensure approvals for ERC20 tokens
  await ensureApproval(owner, token0.address, parseUnits(amount0.toString(), token0.decimals));
  await ensureApproval(owner, token1.address, parseUnits(amount1.toString(), token1.decimals));

  // ─── 5) Slippage settings ───
  const slippagePct = new Percent(Math.floor(slippageTolerance * 100), 10_000);
  logger.info(`Slippage tolerance: ${slippagePct.toFixed(2)}%`);

  // ─── 6) Get batch permit ───
  const details = await buildPermitDetails(owner, [token0, token1], BigInt(deadline));

  const permit2Payload = {
    details,
    spender: CONTRACTS.POSITION_MANAGER,
    sigDeadline: deadline.toString(),
  };
  const signature = await signPermit2Payload(permit2Payload);

  // Base add-liquidity options (common to all pools)
  // 2) Construct a MintOptions object
  const mintOpts: MintOptions = {
    slippageTolerance: slippagePct, // Percent
    deadline: deadline.toString(), // BigintIsh
    recipient: owner as Address, // required for Mint
    batchPermit: {
      // optional batch permit
      owner: owner as Address,
      permitBatch: permit2Payload,
      signature,
    },
    ...(pool.token0.isNative
      ? { useNative: pool.token0 as Ether }
      : pool.token1.isNative
      ? { useNative: pool.token1 as Ether }
      : {}), // optional `useNative`
    // createPool?: boolean,                  // (optional)
    // migrate?: boolean,                     // (optional)
    // sqrtPriceX96?: BigintIsh,              // (optional)
  };

  // 3) Call the SDK
  const { calldata: liqCalldata, value: rawLiqValue } = V4PositionManager.addCallParameters(pos, mintOpts);

  // Log the amount of ETH (in wei) that will be attached to the transaction
  logger.info('ETH to send (wei):', BigInt(rawLiqValue.toString()));

  // ─── 10) Send transaction ───
  const calls = [liqCalldata];

  // Explicitly increase gas limit
  const txHash = await walletClient.writeContract({
    account,
    address: CONTRACTS.POSITION_MANAGER as Address,
    chain: unichain,
    abi: POSITION_MANAGER_ABI,
    functionName: 'multicall',
    args: [calls],
    value: BigInt(rawLiqValue.toString()),
  });

  logger.info(`Transaction sent: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === 'success') {
    logger.info(`Transaction confirmed: ${receipt.transactionHash}`);

    // ─── 11) Get position & return result ───
    let latest: string;
    if (pool.token0.isNative || pool.token1.isNative) {
      latest = receipt.logs[1].topics[3] as string;
    } else {
      latest = receipt.logs[2].topics[3] as string;
    }
    logger.info(`Latest position: ${latest}`);
    const info = await getPositionInfo(BigInt(latest));

    if (!info) {
      throw new Error('Position info not found');
    }

    return {
      success: true,
      tokenId: info.tokenId,
      liquidity: info.liquidity.toString(),
      amount0Used: info.token0BalanceFormatted,
      amount1Used: info.token1BalanceFormatted,
      tickLower,
      tickUpper,
      priceLower: info.priceLower.toString(),
      priceUpper: info.priceUpper.toString(),
      transactionHash: receipt.transactionHash,
    };
  } else {
    throw new Error(`Transaction failed: ${receipt.transactionHash}`);
  }
}
