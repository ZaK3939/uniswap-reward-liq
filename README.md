# Uniswap v4 Liquidity Management Bot

This bot automates the management of liquidity positions in Uniswap v4 pools. It creates and manages positions in a concentrated liquidity range to optimize returns.

## Overview

The bot performs the following operations:

1. Scans existing positions in the user's wallet
2. Creates new positions when necessary
3. Monitors positions regularly (every 5 minutes)
4. Calculates optimal token amounts based on current pool prices
5. Handles transaction approvals and submissions

## How It Works

### Position Creation Process

When creating a position, the bot:

1. Gets pool information using the token pair and fee tier
2. Calculates appropriate token amounts based on wallet balances
3. Approves tokens to Permit2 contract (if not already approved)
4. Signs an EIP-712 message for the transaction
5. Submits the transaction to create the position
6. Confirms the transaction was successful
7. Verifies the position was created successfully

## Configuration

Create a `.env` file with the following variables:

```
# Private key for the wallet
PRIVATE_KEY=your_private_key_here

# The Graph API key (if needed)
GRAPH_KEY=your_api_key

# Optional: Percentage of balance to use (defaults to 50%)
```

## Example Usage

The logs show the bot:

1. Starting up and analyzing existing positions
2. Creating initial positions with USDC/USDT at 0.01% fee
3. Setting a narrow price range (1.0001 - 1.0002)
4. Approving tokens to Permit2 contract
5. Creating positions with calculated amounts
6. Monitoring every 5 minutes and creating new positions as needed

## Notes

- The bot uses a percentage of your token balance for each position (default 50%)
- Positions are created with a very narrow price range for stablecoin pairs
- Slippage tolerance is set at 0.50%
- The bot handles signing and transaction submission automatically
- Proper token approvals are managed for you
