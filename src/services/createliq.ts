import { CurrencyAmount, Percent } from '@uniswap/sdk-core';
import { tickToPrice, priceToClosestTick, Pool, Position, V4PositionManager } from '@uniswap/v4-sdk';
import type { Address } from 'viem';
import { formatUnits, parseUnits, zeroAddress } from 'viem';
import { getPublicClient, getWalletAccount, getWalletClient } from '../utils/client';
import { POSITION_CONFIG, TX_CONFIG, CONTRACTS, BOT_ADDRESS, PERMIT2_DOMAIN, PERMIT2_TYPES } from '../config/config';
import { getTokenByAddress } from '../config/tokens';
import { nearestUsableTick } from '../utils/tick/tickMath';
import { getPositionInfo, getV4Positions } from './positions';
import logger from '../utils/logger';
import type { CreatePositionParams, CreatePositionResult } from '../types';
import { unichain } from '../config/chains';
import { ERC20_ABI, PERMIT2_ABI, POSITION_MANAGER_ABI } from '../abis';
import { getPoolData } from './pool';
import JSBI from 'jsbi';

export async function createPosition(params: CreatePositionParams): Promise<CreatePositionResult | undefined> {
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
    // より長いデッドラインを設定（10分→30分）
    deadline = Math.floor(Date.now() / 1_000) + 30 * 60,
  } = params;

  // ─── 3) トークン & プール情報 ───
  const token0 = getTokenByAddress(token0Address);
  const token1 = getTokenByAddress(token1Address);
  logger.info(`Creating ${token0.symbol}/${token1.symbol} @ fee=${fee / 10000}%`);
  const poolData = await getPoolData(token0, token1, fee, tickSpacing);
  if (tickLower == null || tickUpper == null) {
    throw new Error('tickLower or tickUpper is null');
  }

  // ─── 4) Pool & Position インスタンス ───
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

  // 値を確実に解析
  logger.info(`amount0: ${amount0.toString()}, amount1: ${amount1.toString()}`);
  logger.info(
    `Creating position with amounts: ${formatUnits(amount0, token0.decimals)} ${token0.symbol}, ${formatUnits(
      amount1,
      token1.decimals,
    )} ${token1.symbol}`,
  );

  // 流動性計算を正確に行う
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

  const MAX_UINT256 = 2n ** 256n - 1n;
  const approval0 = (await publicClient.readContract({
    address: token0Address as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, CONTRACTS.PERMIT2],
  })) as bigint;

  // トークン1の承認チェック
  const approval1 = (await publicClient.readContract({
    address: token1Address as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, CONTRACTS.PERMIT2],
  })) as bigint;

  if (approval0 < parseUnits(amount0.toString(), token0.decimals) * 2n) {
    logger.info(`Approving ${token0.symbol} to Permit2...`);
    const approveTx0 = await walletClient.writeContract({
      account: getWalletAccount(),
      address: token0Address as Address,
      abi: ERC20_ABI,
      chain: unichain,
      functionName: 'approve',
      args: [CONTRACTS.PERMIT2, MAX_UINT256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx0 });
    logger.info(`${token0.symbol} approved to Permit2`);
  } else {
    logger.info(`${token0.symbol} already has sufficient approval to Permit2`);
  }

  // トークン1の承認が不足している場合は、承認を行う
  if (approval1 < parseUnits(amount1.toString(), token1.decimals) * 2n) {
    logger.info(`Approving ${token1.symbol} to Permit2...`);
    const approveTx1 = await walletClient.writeContract({
      account: getWalletAccount(),
      address: token1Address as Address,
      abi: ERC20_ABI,
      chain: unichain,
      functionName: 'approve',
      args: [CONTRACTS.PERMIT2, MAX_UINT256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx1 });
    logger.info(`${token1.symbol} approved to Permit2`);
  } else {
    logger.info(`${token1.symbol} already has sufficient approval to Permit2`);
  }

  // ─── 5) スリッページ設定 ───
  const slippagePct = new Percent(Math.floor(slippageTolerance * 100), 10_000);
  logger.info(`Slippage tolerance: ${slippagePct.toFixed(2)}%`);

  try {
    // ─── 6) Permit2 nonce取得 ───
    // token0のnonceを取得
    const allowance0 = await publicClient.readContract({
      address: CONTRACTS.PERMIT2,
      abi: PERMIT2_ABI,
      functionName: 'allowance',
      args: [owner, token0Address as Address, CONTRACTS.POSITION_MANAGER],
    });
    const nonce0 = allowance0[2]; // [amount, expiration, nonce]

    // token1のnonceを取得
    const allowance1 = await publicClient.readContract({
      address: CONTRACTS.PERMIT2,
      abi: PERMIT2_ABI,
      functionName: 'allowance',
      args: [owner, token1Address as Address, CONTRACTS.POSITION_MANAGER],
    });
    const nonce1 = allowance1[2]; // [amount, expiration, nonce]

    logger.info(`Permit2 nonce0 (${token0.symbol}): ${nonce0}`);
    logger.info(`Permit2 nonce1 (${token1.symbol}): ${nonce1}`);

    const commonDeadline = Math.floor(Date.now() / 1_000) + 30 * 60;
    // ─── 7) 許可データ作成 ───
    // 最大値の設定（2^160-1）
    const MAX_UINT160 = 2n ** 160n - 1n;
    // permit2のdetailsデータを作成
    const permitData = {
      details: [
        {
          token: token0.address as Address,
          amount: MAX_UINT160.toString(),
          expiration: commonDeadline.toString(),
          nonce: nonce0,
        },
        {
          token: token1.address as Address,
          amount: MAX_UINT160.toString(),
          expiration: commonDeadline.toString(),
          nonce: nonce1,
        },
      ],
      spender: CONTRACTS.POSITION_MANAGER as Address,
      sigDeadline: commonDeadline.toString(),
    };

    // 署名用のメッセージ
    const eipMsg = {
      details: permitData.details,
      spender: permitData.spender,
      sigDeadline: permitData.sigDeadline,
    };
    logger.info(`eipMsg: ${JSON.stringify(eipMsg, null, 2)}`);
    logger.info(`EIP-712 message prepared with deadline: ${deadline} (${new Date(deadline * 1000).toISOString()})`);

    // ─── 8) EIP-712署名の作成 ───
    const chainId = await walletClient.getChainId();
    if (chainId !== unichain.id) {
      throw new Error(`Chain ID mismatch: expected ${unichain.id}, got ${chainId}`);
    }

    const account = getWalletAccount();
    logger.info('Signing EIP-712 message...');

    const signature = await walletClient.signTypedData({
      account,
      domain: PERMIT2_DOMAIN(chainId),
      types: PERMIT2_TYPES,
      primaryType: 'PermitBatch',
      message: eipMsg,
    });

    logger.info(`Signature generated: ${signature.substring(0, 10)}...`);

    // ─── 9) トランザクション作成 ───
    // 分解してステップごとにチェック

    logger.info(`Encoding permitBatch...`);
    const permitCalldata = V4PositionManager.encodePermitBatch(owner as Address, permitData, signature);

    logger.info(`Calculating add liquidity parameters...`);
    // バッチPermitを含まない基本的な流動性追加パラメータを取得
    const { calldata: liqCalldata, value: rawLiqValue } = V4PositionManager.addCallParameters(pos, {
      slippageTolerance: slippagePct,
      recipient: owner as Address,
      deadline: commonDeadline.toString(),
      // 個別にパーミットを処理するために取り除く
      // batchPermit: {
      //   owner: owner as Address,
      //   permitBatch: permitData,
      //   signature,
      // },
    });

    // valueの処理
    const liqValue = Array.isArray(rawLiqValue) ? rawLiqValue[0] : rawLiqValue;
    logger.info(`Liquidity value: ${liqValue}`);

    // ─── 10) トランザクション送信 ───
    // permitとaddLiquidityを別々に処理するマルチコール
    const calls = [permitCalldata, liqCalldata];

    logger.info(`Sending transaction with ${calls.length} calls`);
    logger.info(`Transaction data length: ${calls.join('').length}`);

    // ガスリミットを明示的に増加させる
    const txHash = await walletClient.writeContract({
      account,
      address: CONTRACTS.POSITION_MANAGER as Address,
      chain: unichain,
      abi: POSITION_MANAGER_ABI,
      functionName: 'multicall',
      args: [calls],
      value: BigInt(liqValue),
    });

    logger.info(`Transaction sent: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === 'success') {
      logger.info(`Transaction confirmed: ${receipt.transactionHash}`);

      // ─── 11) ポジション取得 & 結果返却 ───
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
    } else {
      throw new Error(`Transaction failed: ${receipt.transactionHash}`);
    }
  } catch (error) {
    logger.error(`Error creating position: ${error}`);
  }
}
