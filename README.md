# RSI monitoring Bot

An example automated technical analysis trading bot for [Saturn Network](https://saturn.network).
More info on https://forum.saturn.network/t/saturn-trading-bot-guides/4046

Note that the bot does not execute the [ERC20 Approve](https://blog.saturn.network/erc20-approve-explained/) transaction. You'll have to do it manually for each token using the same wallet address if you want to automate trading ERC20 tokens.

More details in the guide on Saturn Forum.

More info about [RSI indicator available here](https://blog.saturn.network/how-does-the-rsi-indicator-work-for-crypto-trading/).

### Config options

```json
{
  "global": {
    "min_ether_in_wallet": "0.1"
  },
  "tokens": [
    {
      "token": "0xac55641cbb734bdf6510d1bbd62e240c2409040f",
      "blockchain": "ETC",
      "rsi_sell": 55.5,
      "rsi_buy": 47
    },
    {
      "token": "0xb9440022a095343b440d590fcd2d7a3794bd76c8",
      "blockchain": "ETH",
      "rsi_sell": 52,
      "rsi_buy": 48
    }
  ]
}
```

#### global

* `min_ether_in_wallet` - the bot will make sure that you keep at least this much ETH or ETC in your trading wallet (for gas fees and HODLing)

#### tokens

* `token` - token's smart contract address
* `blockchain` - token's blockchain
* `rsi_sell` - if RSI is higher than this number (token overbought) then the bot will attempt to market sell all the tokens in the wallet
* `rsi_buy` - if RSI is lower than this number (token oversold) then the bot will attempt to market buy as many tokens as it can
