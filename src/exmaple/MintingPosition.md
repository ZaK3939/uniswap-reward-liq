# Uniswap v4 Liquidity Position Minting (V4 SDK & Interface Guide)

## Overview of Uniswap v4 Position Minting

Uniswap v4 introduces a new PositionManager contract and a corresponding V4 SDK to manage liquidity positions. Like v3, liquidity positions are represented as NFTs, but v4 uses a command-based interface for bundling actions (e.g., minting liquidity and transferring tokens) into a single transaction.

The V4 SDK provides high-level classes – Pool, Position, and V4PositionManager – to help construct these transactions in JavaScript/TypeScript. This guide explains how to create (mint) a new liquidity position using the Uniswap v4 SDK and how the Uniswap Interface leverages these tools (with Permit2 signatures and multicall) in combination with viem for a seamless user experience. We will cover:

- Setting up a Pool and Position for minting
- Configuring MintOptions (all parameters, types, and defaults)
- Using V4PositionManager.addCallParameters to get transaction data
- How Uniswap Interface handles position creation (Permit2 for approvals, multicall, viem integration)
- Sample code with explanations and improvements for clarity

## Preparing Pool and Position Objects

Before minting, you need a Pool instance reflecting the current on-chain state and a Position defining your desired liquidity parameters:

### Instantiate Pool

Create a Pool object from the Uniswap v4 SDK using the fetched data. The Pool constructor in v4 is similar to v3 (just make sure to use Currency/Token classes from the v4 SDK for the two assets, and include any hook address if applicable):

```typescript
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

const TOKEN_INFO = {
  [TOKEN_ADDRESSES.USDC]: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    chainId,
    isNative: false,
  },
  // Native ETH
  NATIVE: {
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    chainId,
    isNative: true,
    address: zeroAddress,
  },
} as const;

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

// Simply sort by address to determine token0 and token1
const addressA = tokenAInfo.isNative ? zeroAddress : tokenAInfo.address;
const addressB = tokenBInfo.isNative ? zeroAddress : tokenBInfo.address;

// Simple string comparison for sorting
const token0IsA = addressA.toLowerCase() < addressB.toLowerCase();
const token0 = token0IsA ? tokenA : tokenB;
const token1 = token0IsA ? tokenB : tokenA;
```

> **Note**: In v4, pools are identified by a PoolKey (which includes token0, token1, fee, tick spacing, and hook address). The SDK's Pool class helps manage these details. Ensure that the token order (token0 vs token1) and the hook address match the actual pool.

### Fetch Pool State

Using either on-chain calls or the Uniswap StateView contract, retrieve the pool's current state (current sqrt price, current tick, liquidity, etc.). In code, you might use viem or ethers to call the pool manager or StateView contract for slot0, liquidity, etc. For example (using viem):

```typescript
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { Pool } from '@uniswap/v4-sdk';
import { STATE_VIEW_ABI } from '../abis';

const client = createPublicClient({ chain: mainnet, transport: http() });

const poolId = Pool.getPoolId(token0, token1, fee, tickSpacing, hookAddress);
// Assuming poolId is known and STATE_VIEW_ABI includes getSlot0 and getLiquidity
const [slot0, liquidity] = await Promise.all([
  client.readContract({
    address: STATE_VIEW_ADDRESS,
    abi: STATE_VIEW_ABI,
    functionName: 'getSlot0',
    args: [poolId as `0x${string}`],
  }),
  client.readContract({
    address: .STATE_VIEW_ADDRESS,
    abi: STATE_VIEW_ABI,
    functionName: 'getLiquidity',
    args: [poolId as `0x${string}`],
  }),
]);

// Extract relevant data
const sqrtPriceX96Current = slot0[0] as bigint;
const currentTick = slot0[1] as number;
const currentLiquidity = liquidity as bigint;

// Create Pool instance
const pool = new Pool(
  token0,
  token1,
  fee,
  tickSpacing,
  hooks,
  sqrtPriceX96.toString(),
  liquidity.toString(),
  tick,
);
```

### Define Position Parameters

Decide your position's tick range and liquidity or token amounts. For example, you might choose a range around the current price and an amount of token0 and token1 to deposit. Determine tickLower, tickUpper, and one of:

- desired amount0 and amount1, or
- a specific liquidity amount.

### Create a Position

Use the Position class to represent the liquidity position. The v4 SDK offers static methods similar to v3 (e.g., Position.fromAmounts, Position.fromAmount0, Position.fromAmount1) to compute the maximum liquidity for given token amounts, or you can directly provide a liquidity value. For example, to create a Position from known token amounts:

```typescript
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

const amountADesired = BigInt(Math.floor(amountA * 10 ** tokenAInfo.decimals));
const amountBDesired = BigInt(Math.floor(amountB * 10 ** tokenBInfo.decimals));

const amount0Desired = token0IsA ? amountADesired.toString() : amountBDesired.toString();
const amount1Desired = token0IsA ? amountBDesired.toString() : amountADesired.toString();

const position = Position.fromAmounts({
  pool,
  tickLower,
  tickUpper,
  amount0: amount0Desired,
  amount1: amount1Desired,
  useFullPrecision: true,
});
```

This calculates the maximum liquidity that can be minted given those amounts and the price range. Alternatively, if you have a specific liquidity amount, you could use `new Position({ pool, tickLower, tickUpper, liquidity })`. The Position object also provides the minimum required amounts via `position.mintAmounts` (amount0 and amount1 needed) and can adjust for slippage later.

## Understanding MintOptions and Its Parameters

Once the Position is defined, the next step is to prepare the MintOptions object. In Uniswap v4 SDK, MintOptions is a type alias that combines three sets of options: CommonOptions, CommonAddLiquidityOptions, and MintSpecificOptions. This structure covers generic transaction settings, options common to any "add liquidity" action, and options unique to minting a new position. Below is a breakdown of each parameter in MintOptions:

- **slippageTolerance** (Percent, required): The maximum price slippage you allow for the pool price during the mint operation. This is used to calculate amount0Min and amount1Min – the minimum amounts of each token that must be accepted (if the price moves unfavorably beyond this tolerance, the transaction will revert). For example, `new Percent(50, 10000)` represents 0.5% tolerance.

- **deadline** (BigintIsh, required): The UNIX timestamp (in seconds) after which the transaction will expire. This protects against the transaction getting stuck pending for too long. You can use `Math.floor(Date.now()/1000) + X` seconds into the future.

- **recipient** (string, required): The Ethereum address that will receive the minted position NFT. Typically this is the user's own address (e.g., from their wallet). The PositionManager will mint the ERC-721 NFT to this address.

- **hookData** (string, optional): Arbitrary data to pass to any pool hook on mint. If the pool uses custom hooks, you can supply data that the hook contract will use when the position is minted. For most pools (no special hook logic), this can be an empty string or omitted.

- **useNative** (NativeCurrency, optional): This flag indicates if one of the tokens is the native currency (ETH, etc.) and should be sent directly as ETH instead of as an ERC20. If useNative is true, one of the pool's currencies must be the chain's native token (e.g., WETH for Ethereum). The SDK will then handle wrapping/unwrapping. For example, if your pair is WETH/USDC and you set `useNative: Native.onChain(1)` (for mainnet ETH), the call will accept ETH for the WETH portion. In practice, useNative ensures the value field in the transaction is set and a SWEEP action is added to refund excess ETH.

- **batchPermit** (BatchPermitOptions, optional): Supplies a Permit2 signature to allow the PositionManager to spend your tokens without prior ERC20 approval. Using Permit2 (Uniswap's universal permit contract) avoids needing separate approve() transactions. If provided, this should include:

  - owner: your address (the token holder),
  - permitBatch: an object describing the allowed tokens and amounts (of type AllowanceTransferPermitBatch),
  - signature: the permit2 signature string (signed by the owner).

  The SDK can help generate the permit data. For example, Position.permitBatchData() on your Position can produce the structured data hash to sign for Permit2. After signing off-chain, you include the signature and permit details here. If batchPermit is used, the resulting call data from addCallParameters will bundle the permit and mint in a single multicall so that token allowances are granted just-in-time.

- **createPool** (boolean, optional): If true, indicates that the pool should be created/initialized if it doesn't exist yet. Use this when adding liquidity to a brand new market. When `createPool: true`, you must also provide sqrtPriceX96 (initial price) as described below. The SDK will then include the pool initialization in the transaction. If the pool is already created and initialized, you should not set this (or set it to false).

- **sqrtPriceX96** (BigintIsh, optional): The initial sqrt price for the pool, in Q96 format, used only when creating a new pool. This represents the starting price ratio between the two tokens (token0/token1). You can compute this from a desired price (P) using the formula: `sqrtPriceX96 = floor(sqrt(P) * 2^96)`. The SDK expects this as a BigInt or similar. Only needed if createPool is true; it will be ignored otherwise.

- **migrate** (boolean, optional): Indicates if this mint is part of a v3 to v4 migration process. In most standard use-cases, this will be false (or simply omitted). It's an option reserved for Uniswap's migration contracts/tools and can generally be left unset by developers not performing a migration. If true, the PositionManager might handle some internal accounting differently (e.g., skip certain checks), but if you're just adding new liquidity, you do not need to use this.

### Default Behaviors

All required fields (slippageTolerance, deadline, recipient) must be provided explicitly – there are no internal defaults for these. Optional fields can be omitted if not needed:

- If batchPermit is not provided, it is assumed you have already approved the PositionManager to spend token0 and token1 (so ensure you call `ERC20.approve(positionManagerAddress, amount)` for each token beforehand, or the transaction will revert).
- If useNative is false/omitted, the SDK will assume you are using the ERC20 representations for all tokens (e.g., using WETH directly rather than sending Ether).
- If createPool is false/omitted, the pool must already exist and be initialized; otherwise the transaction will fail. (Pool creation can also be done via a separate `V4PositionManager.createCallParameters()` call if you prefer a two-step approach.)
- If hookData is not set, an empty bytes value will be forwarded to the contract (which is fine for pools without hooks).

Below is a summary table of MintOptions for quick reference:

| Parameter         | Type               | Description                                                 | Required           |
| ----------------- | ------------------ | ----------------------------------------------------------- | ------------------ |
| slippageTolerance | Percent            | Max price movement allowed (for min amount calc)            | Yes                |
| deadline          | BigintIsh          | Tx expiry timestamp (seconds)                               | Yes                |
| recipient         | string             | Address to receive the position NFT                         | Yes                |
| hookData          | string (bytes)     | Data for pool hook (if applicable)                          | No                 |
| useNative         | NativeCurrency     | Use native ETH instead of wrapped token if one is WETH      | No                 |
| batchPermit       | BatchPermitOptions | Permit2 parameters for gasless token approval               | No                 |
| createPool        | boolean            | Create & initialize pool if not existent                    | No (default false) |
| sqrtPriceX96      | BigintIsh          | Initial price (sqrtP) for new pool (required if createPool) | No                 |
| migrate           | boolean            | Mark as part of v3→v4 migration flow                        | No                 |

## Using V4PositionManager to Generate Mint Transaction

With a Position object and MintOptions prepared, the SDK can compute the calldata and value for the position mint. We use the static method `V4PositionManager.addCallParameters(position, options)` which returns a MethodParameters object containing the calldata and value (ETH to send). Example:

```typescript
import { Percent, Token, Ether, Currency } from '@uniswap/sdk-core';
import { MintOptions, V4PositionManager } from '@uniswap/v4-sdk';

// Assume `position` from earlier and userAddress is our recipient
const slippagePct = new Percent(Math.floor(slippageTolerance * 100), 10_000);

const currentBlock = await publicClient.getBlock();
const currentBlockTimestamp = Number(currentBlock.timestamp);
const deadline = currentBlockTimestamp + deadlineSeconds;

const mintOptions: MintOptions = {
  recipient: userAddress,
  slippageTolerance: slippagePct,
  deadline: deadline.toString(),
  useNative: tokenAInfo.isNative
    ? Ether.onChain(tokenAInfo.chainId)
    : tokenBInfo.isNative
    ? Ether.onChain(tokenBInfo.chainId)
    : undefined, // not using native ETH in this example (both tokens are ERC20)
  batchPermit: undefined, // assume tokens are already approved; otherwise supply permit here
  // createPool and sqrtPriceX96 if needed:
  // createPool: true,
  // sqrtPriceX96: initialPrice,
};

if (usePermit2) {
  // Generate Permit2 only for ERC20 tokens
  const permitDetails = [];

  if (!tokenAInfo.isNative) {
    const [, , nonce] = (await publicClient.readContract({
      account: getWalletAccount(),
      address: CONTRACTS.PERMIT2,
      abi: PERMIT2_ABI,
      functionName: 'allowance',
      args: [user.address, tokenAInfo.address, POSITION_MANAGER_ADDRESS],
    })) as [bigint, bigint, bigint];
    permitDetails.push({
      token: tokenAInfo.address,
      amount: (2n ** 160n - 1n).toString(),
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
      args: [user.address, tokenBInfo.address, POSITION_MANAGER_ADDRESS],
    })) as [bigint, bigint, bigint];
    permitDetails.push({
      token: tokenBInfo.address,
      amount: (2n ** 160n - 1n).toString(),
      expiration: deadline.toString(),
      nonce: nonce.toString(),
    });
  }

  if (permitDetails.length > 0) {
    const permitData = {
      details: permitDetails,
      spender: POSITION_MANAGER_ADDRESS,
      sigDeadline: deadline.toString(),
    };

    // Permit2 signature
    const signature = await walletClient.signTypedData({
      account,
      domain: {
        name: 'Permit2',
        chainId: unichain.id,
        verifyingContract: PERMIT2_ADDRESS,
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

const { calldata, value } = V4PositionManager.addCallParameters(position, mintOptions);
```

Under the hood, addCallParameters builds the necessary function calls to the PositionManager contract:

- It will encode a MINT_POSITION command with your position parameters (pool key, tickLower, tickUpper, liquidity from position, and amount0Max/amount1Max derived from your slippage tolerance) and a SETTLE_PAIR command to pull in the tokens. The slippageTolerance is applied to calculate amount0Max and amount1Max – these are the maximum token amounts the contract is allowed to take, ensuring you don't pay more than intended.
- If useNative was true, it would also append a SWEEP command for the native token.
- If batchPermit is provided, the SDK will prepend the permit call (via the Permit2Forwarder) likely using the contract's multicall capability. The PositionManager v4 contract inherits Multicall_v4 and Permit2Forwarder, meaning it can execute multiple sub-calls atomically. The SDK takes advantage of this: it generates a single combined calldata that first uses the Permit2 signature to approve token spending, then performs the modifyLiquidities (mint) action. This way, the user signs one transaction and the contract takes care of both approval and liquidity addition.

The returned MethodParameters has:

- **calldata**: a hex string starting with the function selector (likely for multicall or modifyLiquidities depending on context) and encoding all parameters.
- **value**: a hex string for the amount of ETH (in wei) to send. This will be non-zero if useNative was true (equal to amount0Max or amount1Max of the native token). If neither token is native, value will be "0x0".

> **Note**: If you set `createPool: true`, the SDK will include pool initialization in the call. In practice, this might be done by calling the PoolInitializer_v4.create() through the PositionManager's command sequence. Ensure sqrtPriceX96 is correctly set; otherwise the transaction will revert (pool initialization requires a valid starting price). You could also call `V4PositionManager.createCallParameters(poolKey, sqrtPriceX96)` separately to get the data for pool creation if you want to deploy the pool in a separate transaction, but combining it with the first mint is typically more gas-efficient.

## Executing the Transaction with Viem

After obtaining calldata and value, you need to send the transaction to the blockchain. In a frontend context (like using viem or wagmi hooks), you'd do something like:

```typescript
// Send the transaction
const txHash = await walletClient.writeContract({
  account,
  chain: chainId,
  address: POSITION_MANAGER_ADDRESS,
  abi: POSITION_MANAGER_ABI,
  functionName: 'multicall',
  data: [[calldata]],
  value: BigInt(value),
});

const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
```

This will prompt the user to confirm the transaction (in their wallet). The PositionManager contract will execute the encoded commands:

1. If permit was included, it uses Permit2 to pull allowances (no prior ERC20 approvals needed).
2. It mints the liquidity (initializing the pool if required) and transfers the tokens from the user.
3. It mints an NFT to recipient representing the new position.

Using viem's sendTransaction is straightforward because we already have the raw calldata. We simply specify the to address and attach the value. Since the SDK's calldata is fully formed, we do not need to call a specific ABI function via walletClient.writeContract (in fact, if permit is included, the calldata likely targets the multicall(bytes[]) function on the PositionManager). Sending the raw tx as above is sufficient.

**Gas and Transaction Considerations**: The gasLimit can usually be left for the wallet or provider to estimate. However, v4's multi-command structure might cause estimates to be off if using Permit2 (since it executes external calls to Permit2). It's wise to include a buffer in gas. Also note that if your slippageTolerance is too tight and the price moves, the transaction may fail (since the required token amounts would exceed your specified max). Conversely, if the price moves favorably, you might not spend the full amount0Max/amount1Max – any unspent ETH (with useNative) would be returned via the SWEEP action.

**Example flow in the interface**: A user goes to "New Position" on the Pool tab, selects token A and token B, inputs amounts, and a price range. The app checks if the pool exists. If not, it will ask for an initial price. When the user clicks "Add Liquidity", the app will:

1. If needed, prompt for a Permit2 signature for token A and B (user signs off-chain).
2. Call V4PositionManager.addCallParameters(position, mintOptions) with batchPermit (containing the signature) if step 1 was done.
3. Send the transaction via wagmi/viem.
4. On success, show the position NFT in the interface.
