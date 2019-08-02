#!/usr/bin/env node
const axios     = require('axios')
const chalk     = require('chalk')
const ethers    = require('ethers')
const moment    = require('moment')
const _         = require('lodash')
const program   = require('commander')
const Table     = require('easy-table')
const BigNumber = require('bignumber.js')
const Saturn    = require('@saturnnetwork/saturn.js').Saturn

const version   = require('./package.json').version
const saturnApi = 'https://ticker.saturn.network/api/v2'
const epsilon   = new BigNumber('0.00005')

const pipeline = async (funcs) => {
  return await funcs.reduce((promise, func) => {
    return promise.then(result => {
      return func().then(Array.prototype.concat.bind(result))
    })
  }, Promise.resolve([]))
}

function getChainId(chain) {
  if (chain === 'ETC') { return 61 }
  if (chain === 'ETH') { return 1 }
  console.log('Unknown chainId for chain', chain)
  process.exit(1)
}

function rpcNode(chain) {
  if (chain === 'ETC') { return 'https://ethereumclassic.network/' }
  if (chain === 'ETH') { return 'https://mainnet.infura.io/mew' }
  console.log('Unknown chainId for chain', chain)
  process.exit(1)
}

// thx @wizard
function getRSI(saturn, token, network = 'etc', periods = false) {
  return new Promise((resolve, reject) => {
    let x = periods || 14
    saturn.query.ohlcv(token, network || 'etc').then((ohlcvdata) => {
      let period = ohlcvdata.slice(x * -1)
      let avgOpen = _.meanBy(period, (p) => Number(p.open))
      let avgClose = _.meanBy(period, (p) => Number(p.close))
      let RS = avgClose / avgOpen
      let RSI = 100 - (100 / (1 + RS))
      resolve( RSI )
    })
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeSaturnClient(blockchain, program, wallet) {
  let rpcnode = rpcNode(blockchain)
  let chainId = getChainId(blockchain)
  let provider = new ethers.providers.JsonRpcProvider(rpcnode, { chainId: chainId, name: blockchain })

  let saturn
  if (blockchain === 'ETC') {
    saturn = new Saturn(saturnApi, { etc: wallet.connect(provider) })
  } else {
    saturn = new Saturn(saturnApi, { eth: wallet.connect(provider) })
  }

  return saturn
}

let orderInfo = async function(blockchain, tx) {
  let url = `${saturnApi}/orders/by_tx/${blockchain}/${tx}.json`

  let order = await axios.get(url)
  if (order.status !== 200) {
    throw new Error(`API error while fetching trade info. Status code ${trades.status}`)
  }
  let price = new BigNumber(order.data.price)
  let balance = new BigNumber(order.data.balance)
  return {
    price: price,
    tokenbalance: balance,
    etherbalance: price.times(balance)
  }
}

let tokenBalance = async function(blockchain, token, wallet) {
  let url = `${saturnApi}/tokens/balances/${blockchain}/${wallet}/${token}.json`

  let response = await axios.get(url)
  if (response.status !== 200) {
    throw new Error(`API error while fetching trade info. Status code ${trades.status}`)
  }

  return new BigNumber(response.data.balances.walletbalance)
}

let etherBalance = async function(blockchain, wallet) {
  let url = `${saturnApi}/tokens/balances/${blockchain}/${wallet}/0x0000000000000000000000000000000000000000.json`

  let response = await axios.get(url)
  if (response.status !== 200) {
    throw new Error(`API error while fetching trade info. Status code ${trades.status}`)
  }

  return new BigNumber(response.data.balances.walletbalance)
}

async function executeTrade(row, wallet, saturn, action) {
  let url = `${saturnApi}/tokens/show/${row.blockchain}/${row.token}.json`
  let response = await axios.request({
    url: url, headers: { 'Origin': 'rsibot' }
  }).catch(error => {
    return Promise.reject(new Error(error.response))
  })

  let tokenInfo = response.data
  if (action == 'buy') { return await executeBuyTrade(tokenInfo, wallet, saturn) }
  if (action == 'sell') { return await executeSellTrade(tokenInfo, wallet, saturn) }
}

async function executeBuyTrade(info, wallet, saturn) {
  let order = await orderInfo(info.blockchain, info.best_sell_order_tx)
  let myEtherBalance = await etherBalance(info.blockchain, wallet.address)

  if (myEtherBalance.isLessThanOrEqualTo(walletMinimum)) {
    console.log(chalk.red(`
      Unable to buy ${info.blockchain}::${info.symbol}
      Your wallet's ether balance ${chalk.underline(myEtherBalance.toFixed())}
      is less than your config's minimum value of ${chalk.underline(walletMinimum.toFixed())}
      Please send more ether to ${chalk.bgWhite.black.bold(wallet.address)}
    `))
    return false
  }
  let tradeLimit = myEtherBalance.minus(walletMinimum)
  let tradeEtherAmount = tradeLimit.gt(order.etherbalance) ? order.etherbalance : tradeLimit

  let tokenAmount = tradeEtherAmount.dividedBy(order.price).toFixed(parseInt(info.decimals))
  let tx = await saturn[info.blockchain.toLowerCase()].newTrade(tokenAmount, info.best_sell_order_tx)
  console.log(chalk.yellow(`Attempting to buy ${tokenAmount} tokens\ntx: ${chalk.underline(tx)}`))
  await saturn.query.awaitTradeTx(tx, saturn[info.blockchain.toLowerCase()])
}

async function executeSellTrade(info, wallet, saturn) {
  let order = await orderInfo(info.blockchain, info.best_buy_order_tx)
  let myTokenBalance = await tokenBalance(info.blockchain, info.address, wallet.address)

  if (!myTokenBalance.gt(epsilon)) {
    console.log(chalk.red(`
      Unable to sell ${info.blockchain}::${info.symbol}
      You do not have any tokens left. Wait until the RSI swings and the bot buys
      some tokens at oversold, low price as determined by your config.
    `))
    return false
  }

  let tokenAmount = new BigNumber(order.etherbalance).dividedBy(order.price).toFixed(parseInt(info.decimals))
  tokenAmount = new BigNumber(tokenAmount).gt(myTokenBalance) ? myTokenBalance : tokenAmount


  let tx = await saturn[info.blockchain.toLowerCase()].newTrade(tokenAmount, info.best_buy_order_tx)
  console.log(chalk.yellow(`Attempting to sell ${tokenAmount.toFixed()} tokens\ntx: ${chalk.underline(tx)}`))
  await saturn.query.awaitTradeTx(tx, saturn[info.blockchain.toLowerCase()])
}

program
  .version(version, '-v, --version')
  .description('Watch RSI of given token on Saturn Network and auto buy/sell. More details are available at ' + chalk.underline.red('https://forum.saturn.network/t/saturn-trading-bot-guides/4046'))
  .option('-p, --pkey [pkey]', 'Private key of the wallet to use for trading')
  .option('-m, --mnemonic [mnemonic]', 'Mnemonic (i.e. from Saturn Wallet) of the wallet to use for trading')
  .option('-i, --walletid [walletid]', 'If using a mnemonic, choose which wallet to use. Default is Account 2 of Saturn Wallet / MetaMask.', 2)
  .option('-j, --json [json]', 'Trading bot config file')
  .option('-d, --delay [delay]', 'Polling delay in seconds', 60)
  .parse(process.argv)

if (!program.mnemonic && !program.pkey) {
  console.error('At least one of [pkey], [mnemonic] must be supplied')
  process.exit(1)
}

if (program.mnemonic && program.pkey) {
  console.error('Only one of [pkey], [mnemonic] must be supplied')
  process.exit(1)
}

let wallet
if (program.mnemonic) {
  let walletid = parseInt(program.walletid) - 1
  wallet = ethers.Wallet.fromMnemonic(program.mnemonic, `m/44'/60'/0'/0/${walletid}`)
} else {
  wallet = new ethers.Wallet(program.pkey)
}

if (!program.json) {
  console.error('Must specify bot config .json file location')
  process.exit(1)
}

console.log(chalk.green(`Loading rsi-trading-bot v${version} ...`))
console.log(chalk.green(`Trading address: ${chalk.underline(wallet.address)}\nUsing the following strategies`))
let botconfig = require(program.json)
let walletMinimum = new BigNumber(botconfig.global.min_ether_in_wallet)

let trade = async function() {
  try {
    let schedule = []
    // pretty announcements
    let allTokens = await Promise.all(_.map(botconfig.tokens, async (row) => {
      let url = `${saturnApi}/tokens/show/${row.blockchain}/${row.token}.json`
      let response = await axios.request({
        url: url, headers: { 'Origin': 'rsibot' }
      }).catch(error => {
        return Promise.reject(new Error(error.response))
      })

      let tokenInfo = response.data

      return {
        token: row.token.toLowerCase(),
        blockchain: row.blockchain.toUpperCase(),
        tokenName: tokenInfo.name,
        tokenSymbol: tokenInfo.symbol,
        rsi_sell: parseFloat(row.rsi_sell),
        rsi_buy: parseFloat(row.rsi_buy)
      }
    }))

    console.log(chalk.bgCyan.black(new Date().toString()))
    let desiredFields = ['blockchain', 'tokenName', 'tokenSymbol', 'rsi_buy', 'rsi_sell']
    console.log(Table.print(_.map(allTokens, x => _.pick(x, desiredFields)), {
      rsi_sell: { name: 'Sell when RSI above' },
      rsi_buy: { name: 'Buy when RSI below' },
      blockchain: { printer: function (val, width) {
        let text = val === "ETC" ? chalk.black.bgGreen.bold(val) : chalk.black.bgWhite.bold(val)
        return width ? Table.padLeft(text, width) : text
      }}
    }))

    // bot logic
    await Promise.all(_.map(allTokens, async (row) => {
      let blockchain = row.blockchain.toUpperCase()
      let token = row.token.toLowerCase()
      let saturn = makeSaturnClient(blockchain, program, wallet)
      let tokenRSI = await getRSI(saturn, token, blockchain)

      let buyThreshold = parseFloat(row.rsi_buy)
      let sellThreshold = parseFloat(row.rsi_sell)

      console.log(chalk.underline(`RSI for token ${row.tokenName} (${blockchain}::${row.tokenSymbol}) is ${tokenRSI}`))

      if (tokenRSI <= buyThreshold) {
        console.log(`It is less than your buy threshold of ${buyThreshold}`)
        console.log(`💸 It is time to ${chalk.green.bold('buy ' + row.tokenSymbol)}! 💸`)
        schedule.push(async () => await executeTrade(row, wallet, saturn, 'buy'))
      }

      if (tokenRSI >= sellThreshold) {
        console.log(`RSI is greater than your sell threshold of ${sellThreshold}`)
        console.log(`💰 It is time to ${chalk.red.bold('sell ' + row.tokenSymbol)}! 💰`)
        schedule.push(async () => await executeTrade(row, wallet, saturn, 'sell'))
      }
    }))
    if (schedule.length) { await pipeline(schedule) }
  } catch(error) {
    console.log(`An error occurred`)
    console.error(error.message)
    console.log(`Retrying...`)
  }

  setTimeout(trade, parseInt(program.delay) * 1000)
};

(async () => await trade())()
