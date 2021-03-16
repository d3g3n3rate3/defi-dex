import React, { useState, useEffect } from "react";
import Header from './Header.js';
import Footer from './Footer.js';
import Wallet from './Wallet.js';
import NewOrder from './NewOrder.js';
import AllOrders from './AllOrders.js';
import MyOrders from './MyOrders.js';
import AllTrades from './AllTrades.js';

const SIDE = {
  BUY: 0,
  SELL: 1
};

function App({ web3, accounts, contracts }) {
  const [tokens, setTokens] = useState([]);
  const [user, setUser] = useState({
    accounts: [],
    balances: {
      tokenDex: 0,
      tokenWallet: 0
    },
    selectedToken: undefined
  });
  const [orders, setOrders] = useState({
    buy: [],
    sell: []
  });
  const [trades, setTrades] = useState([]);
  // define listener state representing the websocket connections listening for events fired by the smart contract
  const [listener, setListener] = useState(undefined);

  const getBalances = async (account, token) => {
    const tokenDex = await contracts.dex.methods.traderBalances(account, web3.utils.fromAscii(token.ticker)).call();
    const tokenWallet = await contracts[token.ticker].methods.balanceOf(account).call();
    return { tokenDex, tokenWallet };
  }

  const getOrders = async token => {
    const orders = await Promise.all([
      contracts.dex.methods.getOrders(web3.utils.fromAscii(token.ticker),SIDE.BUY).call(),
      contracts.dex.methods.getOrders(web3.utils.fromAscii(token.ticker),SIDE.SELL).call()
    ]);
    return {
      buy: orders[0],
      sell: orders[1]
    };
  }

  // listen to smart contract events
  const listenToTrades = token => {
    // define a set to avoid duplicate events
    const tradeIds = new Set();
    // wipe the trade events array every time a new token is selected
    setTrades([]); 
    const listener = contracts.dex.events.NewTrade({ // specify the name of the event to listen to
      filter: {ticker: web3.utils.fromAscii(token.ticker)}, // pass a filter to filter on any field that is marked as indexed in the solidity code, in this case: only select events that are relevent to the currently selected token
      fromBlock: 0 // from which block to start listening for events? For production = the block of deployment of the smart contract
    }).on('data', newTrade => { // callback function triggered every time there is a new event
      if(tradeIds.has(newTrade.returnValues.tradeId)) return; // skip setTrades when the tradeId is already in the tradeIds set
      tradeIds.add(newTrade.returnValues.tradeId);
      setTrades(trades => ([...trades, newTrade.returnValues])); // use .returnValues to access the data fields of the event 
    });
    // cancel the previous websocket connection to avoid too many open threads
    setListener(listener);
  }

  const deposit = async amount => {
    // approve the dex smart contract to spend the tokens, before calling the deposit function of the dex smart contract
    await contracts[user.selectedToken.ticker].methods.approve(contracts.dex.options.address, amount).send({from: user.accounts[0]});
    await contracts.dex.methods.deposit(amount, web3.utils.fromAscii(user.selectedToken.ticker)).send({from: user.accounts[0]});
    const balances = await getBalances(user.accounts[0], user.selectedToken);
    // use callback function to update the state and not overwrite everything
    setUser(user => ({...user, balances}));
  }

  const withdraw = async amount => {
    await contracts.dex.methods.withdraw(amount, web3.utils.fromAscii(user.selectedToken.ticker)).send({from: user.accounts[0]});
    const balances = await getBalances(user.accounts[0], user.selectedToken);
    // use callback function to update the state and not overwrite everything
    setUser(user => ({...user, balances}));
  }

  const createMarketOrder = async (amount, side) => {
    await contracts.dex.methods.createMarketOrder(web3.utils.fromAscii(user.selectedToken.ticker), amount, side).send({from: user.accounts[0]});
    const orders = await getOrders(user.selectedToken);
    setOrders(orders);
  }

  const createLimitOrder = async (amount, price, side) => {
    await contracts.dex.methods.createLimitOrder(web3.utils.fromAscii(user.selectedToken.ticker), amount, price, side).send({from: user.accounts[0]});
    const orders = await getOrders(user.selectedToken);
    setOrders(orders);
  }

  // every time the user changes the token, the user state will be updated
  const selectToken = async token => {
    setUser({...user, selectedToken: token}); // copy over all field with ...user and only override selectedToken with the new value
  }

  useEffect(() => {
    const init = async() => {
      const rawTokens = await contracts.dex.methods.getTokens().call();
      const tokens = rawTokens.map(token => ({
        ...token,
        ticker: web3.utils.hexToUtf8(token.ticker)
      }));
      const [balances, orders] = await Promise.all([
        getBalances(accounts[0], tokens[0]),
        getOrders(tokens[0])
      ]);
      listenToTrades(tokens[0]);
      setTokens(tokens);
      setUser({accounts, balances, selectedToken: tokens[0]});
      setOrders(orders);
    }
    init();
  }, []);

  useEffect(() => {
    const init = async() => {
      const [balances, orders] = await Promise.all([
        getBalances(accounts[0], user.selectedToken),
        getOrders(user.selectedToken)
      ]);
      listenToTrades(user.selectedToken);
      setUser(user => ({...user, balances}));
      setOrders(orders);
    }
    if(typeof user.selectedToken !== 'undefined') {
      init();
    }
  }, [user.selectedToken], () => {
    listener.unsubscribe(); // remove the previous websocket listener (via callback function that is executed every time this hook is executed)
  });

  if(typeof user.selectedToken === 'undefined') {
    return(<div>Loading...</div>)
  }

  return (
    <div id="app">
      <Header contracts={contracts} tokens={tokens} user={user} selectToken={selectToken} />
      <main className="container-fluid">
        <div className="row">
          <div className="col-sm-4 first-col">
            <Wallet user={user} deposit={deposit} withdraw={withdraw} />
            {user.selectedToken.ticker !== 'DAI' ? (
              <NewOrder createMarketOrder={createMarketOrder} createLimitOrder={createLimitOrder}/>
            ) : null}
          </div>
          {user.selectedToken.ticker !== 'DAI' ? (
              <div className="col-sm-8">
                <AllTrades trades={trades} />
                <AllOrders orders={orders} />
                <MyOrders orders={{
                  buy: orders.buy.filter(order => order.trader.toLowerCase() === user.accounts[0].toLowerCase()),
                  sell: orders.sell.filter(order => order.trader.toLowerCase() === user.accounts[0].toLowerCase())
                }} />
              </div>
            ) : null}
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default App;
