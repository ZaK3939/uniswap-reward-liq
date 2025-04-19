import { CurrencyAmount, Percent } from '@uniswap/sdk-core';
import { tickToPrice, priceToClosestTick, Pool, Position, V4PositionManager } from '@uniswap/v4-sdk';
import type { Address } from 'viem';
import { parseUnits, zeroAddress } from 'viem';
import { getPublicClient, getWalletAccount, getWalletClient } from '../utils/client';
import { POSITION_CONFIG, TX_CONFIG, CONTRACTS, BOT_ADDRESS, PERMIT2_DOMAIN, PERMIT2_TYPES } from '../config/config';
import { getTokenByAddress } from '../config/tokens';
import { nearestUsableTick } from '../utils/tick/tickMath';
import { getPositionInfo, getV4Positions } from './positions';
import logger from '../utils/logger';
import type { CreatePositionParams, CreatePositionResult } from '../types';
import { unichain } from '../config/chains';
import { PERMIT2_ABI, POSITION_MANAGER_ABI } from '../abis';
import { getPoolData } from './pool';
import { log } from 'console';

export async function createPosition(params: CreatePositionParams): Promise<CreatePositionResult> {
  // ─── 1) クライアント＆アカウント ───
  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const owner = BOT_ADDRESS;
  if (!owner) throw new Error('Wallet not connected');

  // ─── 2) パラメータ展開 ───
  const {
    token0: token0Address,
    token1: token1Address,
    fee,
    tickSpacing,
    amount0,
    amount1,
    tickLower,
    tickUpper,
    priceRangePercent = POSITION_CONFIG.DEFAULT_PRICE_RANGE_PERCENT,
    slippageTolerance = TX_CONFIG.SLIPPAGE_TOLERANCE,
    deadline = Math.floor(Date.now() / 1_000) + TX_CONFIG.DEADLINE_MINUTES * 60,
  } = params;

  // ─── 3) トークン & プール情報 ───
  const token0 = getTokenByAddress(token0Address);
  const token1 = getTokenByAddress(token1Address);
  logger.info(`Creating ${token0.symbol}/${token1.symbol} @ fee=${fee / 10000}%`);
  const poolData = await getPoolData(token0, token1, fee, tickSpacing);
  if (tickLower == null || tickUpper == null) {
    throw new Error('tickLower or tickUpper is null');
  }

  // ─── 5) Pool & Position インスタンス ───
  const pool = new Pool(
    poolData.token0,
    poolData.token1,
    poolData.fee,
    poolData.tickSpacing,
    zeroAddress,
    poolData.sqrtPriceX96.toString(),
    poolData.liquidity.toString(),
    poolData.tick,
  );
  const amt0 = parseUnits(amount0.toString(), token0.decimals);
  const amt1 = parseUnits(amount1.toString(), token1.decimals);
  const pos = Position.fromAmounts({
    pool,
    tickLower,
    tickUpper,
    amount0: CurrencyAmount.fromRawAmount(token0, amt0.toString()).quotient,
    amount1: CurrencyAmount.fromRawAmount(token1, amt1.toString()).quotient,
    useFullPrecision: true,
  });
  logger.info(`Position: ${pos.pool.currency0.symbol}&${pos.pool.currency1.symbol}, ${pos.liquidity.toString()}`);
  // ─── 6) PermitBatch データ作成 ───
  const slippagePct = new Percent(Math.floor(slippageTolerance * 100), 10_000);
  logger.info(`Slippage tolerance: ${slippagePct.toFixed()}`);

  // Permit2のnonceを取得
  // token0のnonceを取得
  const [, , nonce0] = await publicClient.readContract({
    address: CONTRACTS.PERMIT2,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [owner, token0Address as Address, CONTRACTS.POSITION_MANAGER],
  });

  // token1のnonceを取得
  const [, , nonce1] = await publicClient.readContract({
    address: CONTRACTS.PERMIT2,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [owner, token1Address as Address, CONTRACTS.POSITION_MANAGER],
  });

  logger.info(`Permit2 nonce0 (token0): ${nonce0}`);
  logger.info(`Permit2 nonce1 (token1): ${nonce1}`);

  // 最大値の設定（2^160-1）
  const MAX_UINT160 = 2n ** 160n - 1n;
  const permitData = {
    details: [
      {
        token: token0.address,
        amount: MAX_UINT160.toString(),
        expiration: deadline.toString(),
        nonce: nonce0.toString(),
      },
      {
        token: token1.address,
        amount: MAX_UINT160.toString(),
        expiration: deadline.toString(),
        nonce: nonce1.toString(),
      },
    ],
    spender: CONTRACTS.POSITION_MANAGER,
    sigDeadline: deadline.toString(),
  };

  const eipMsg = {
    details: permitData.details,
    spender: permitData.spender,
    sigDeadline: permitData.sigDeadline,
  };

  logger.info(`Permit2 details: ${JSON.stringify(permitData.details, null, 2)}`);
  logger.info(`トークン順序: token0=${token0.symbol}(${token0.address}), token1=${token1.symbol}(${token1.address})`);
  logger.info(`eipMsg: ${JSON.stringify(eipMsg, null, 2)}`);

  // EIP-712署名の作成

  const chainId = await walletClient.getChainId();
  const account = getWalletAccount();
  logger.info('Signing EIP-712 message...');
  const signature = await walletClient.signTypedData({
    account,
    domain: PERMIT2_DOMAIN(chainId),
    types: PERMIT2_TYPES,
    primaryType: 'PermitBatch',
    message: eipMsg,
  });
  logger.info(`Permit2 signature: ${signature}`);

  // permitData.detailsの正規化と最大値の使用
  const normalizedDetails = permitData.details.map((d) => ({
    token: d.token,
    amount: MAX_UINT160.toString(), // 最大値を使用
    expiration: d.expiration.toString(),
    nonce: d.nonce.toString(),
  }));

  const normalizedPermitData = {
    ...permitData,
    details: normalizedDetails,
    sigDeadline: permitData.sigDeadline.toString(),
  };

  const permitCalldata = V4PositionManager.encodePermitBatch(owner, normalizedPermitData, signature);
  // 直接流動性追加用のパラメータを取得（permitBatchを含む）
  const { calldata: liqCalldata, value: rawLiqValue } = V4PositionManager.addCallParameters(pos, {
    slippageTolerance: slippagePct,
    recipient: BOT_ADDRESS,
    deadline,
    batchPermit: {
      owner,
      permitBatch: normalizedPermitData,
      signature: signature,
    },
  });

  logger.info('checking calldata');

  // rawLiqValueが配列なら先頭を取り出してbigintに
  const liqValue: bigint = Array.isArray(rawLiqValue) ? BigInt(rawLiqValue[0]) : BigInt(rawLiqValue);

  // ログ出力
  logger.info(`Liquidity calldata: ${liqCalldata}`);
  logger.info(`Liquidity value (wei): ${liqValue}`);

  // 送信（マルチコールではなく直接liqCalldataのみを送信）
  const txHash = await walletClient.writeContract({
    account,
    address: CONTRACTS.POSITION_MANAGER,
    chain: unichain,
    abi: POSITION_MANAGER_ABI,
    functionName: 'multicall',
    args: [[permitCalldata, liqCalldata]],
    value: liqValue,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  logger.info(`Mint TX confirmed: ${receipt.transactionHash}`);

  // ─── 10) ポジション取得 & 結果返却 ───
  const ids = await getV4Positions(BOT_ADDRESS);
  const latest = ids.at(-1);
  if (!latest) {
    throw new Error('No position returned');
  }
  const info = await getPositionInfo(latest.tokenId);
  if (!info) {
    throw new Error('Position info not found');
  }
  return {
    success: true,
    tokenId: latest.tokenId,
    liquidity: info.liquidity.toString(),
    amount0Used: info.token0BalanceFormatted,
    amount1Used: info.token1BalanceFormatted,
    tickLower,
    tickUpper,
    priceLower: info.priceLower.toString(),
    priceUpper: info.priceUpper.toString(),
    transactionHash: receipt.transactionHash,
  };
}
