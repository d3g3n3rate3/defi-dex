const { expectRevert } = require('@openzeppelin/test-helpers');

const Dai = artifacts.require('mocks/Dai.sol');
const Rep = artifacts.require('mocks/Rep.sol');
const Bat = artifacts.require('mocks/Bat.sol');
const Zrx = artifacts.require('mocks/Zrx.sol');
const Dex = artifacts.require('Dex.sol');

const SIDE = {
    BUY: 0,
    SELL: 1
}

contract('Simple decentralized exchange', (accounts) => {
    
    let dai, rep, bat, zrx, dex;
    const [trader1, trader2] = [accounts[1], accounts[2]]; // accounts[0] is the admin
    const [DAI, REP, BAT, ZRX] = ['DAI', 'REP', 'BAT', 'ZRX'].map(ticker => web3.utils.fromAscii(ticker)); // create bytes32 representations

    beforeEach(async() => {
        ([dai, rep, bat, zrx] = await Promise.all([
            Dai.new(),
            Rep.new(),
            Bat.new(),
            Zrx.new()
        ]));
        dex = await Dex.new();
        await Promise.all([
            dex.addToken(DAI, dai.address),
            dex.addToken(REP, rep.address),
            dex.addToken(BAT, bat.address),
            dex.addToken(ZRX, zrx.address)
        ]);
        const amount = web3.utils.toWei('1000');
        const seedTokenBalance = async (token, trader) => {
            await token.faucet(trader, amount); // call faucet function to seed token balance
            await token.approve(dex.address, amount, {from: trader}); // call ERC20 approve function to authorize the dex to spend the tokens
        }
        // loop over all tokens and call the seedTokenBalance function
        await Promise.all(
            [dai, rep, bat, zrx].map(token => seedTokenBalance(token, trader1))
        );
        await Promise.all(
            [dai, rep, bat, zrx].map(token => seedTokenBalance(token, trader2))
        );
    });

    it('should deposit tokens', async() => {
        const amount = web3.utils.toWei('100');
        await dex.deposit(amount, DAI, {from: trader1});
        const balance = await dex.traderBalances(trader1, DAI);
        assert(balance.toString() === amount);
    });

    it('should NOT deposit tokens if token was not registered for trading on dex', async() => {
        await expectRevert(dex.deposit(web3.utils.toWei('100'), web3.utils.fromAscii('KNT'), {from: trader1}), 'This token does not exist!');
    });

    it('should withdraw tokens', async() => {
        const amount = web3.utils.toWei('100');
        await dex.deposit(amount, DAI, {from: trader1});
        await dex.withdraw(amount, DAI, {from: trader1});
        const [balanceDex, balanceDai] = await Promise.all([
            dex.traderBalances(trader1, DAI), 
            dai.balanceOf(trader1)
        ]);
        assert(balanceDex.isZero());
        assert(balanceDai.toString() === web3.utils.toWei('1000'));
    });

    it('should NOT withdraw tokens if token balance is insufficient', async() => {
        await dex.deposit(web3.utils.toWei('100'), BAT, {from: trader1});
        await expectRevert(dex.withdraw(web3.utils.toWei('1000'), BAT, {from: trader1}), 'Insufficient token balance!');
    });

    it('should NOT withdraw tokens if token was not registered for trading on dex', async() => {
        await expectRevert(dex.withdraw(web3.utils.toWei('100'), web3.utils.fromAscii('KNT'), {from: trader1}), 'This token does not exist!');
    });

    it('should create limit order', async() => {
        await dex.deposit(web3.utils.toWei('100'), DAI, {from: trader1});
        await dex.createLimitOrder(REP, web3.utils.toWei('10'), 10, SIDE.BUY, {from: trader1});
        let buyOrders = await dex.getOrders(REP, SIDE.BUY);
        let sellOrders = await dex.getOrders(REP, SIDE.SELL);
        assert(buyOrders.length === 1);
        assert(buyOrders[0].trader === trader1);
        assert(buyOrders[0].ticker === web3.utils.padRight(REP, 64)); // bytes32 values are returned from the blockchain with zeroes padded on the right: use web3.utils.padRight(value, 64)) to pad bytes32 values with 64 zeroes
        assert(buyOrders[0].price === '10'); // uint values are returned from the blockchain as a string
        assert(buyOrders[0].amount === web3.utils.toWei('10'));
        assert(sellOrders.length === 0);

        await dex.deposit(web3.utils.toWei('200'), DAI, {from: trader2});
        await dex.createLimitOrder(REP, web3.utils.toWei('10'), 11, SIDE.BUY, {from: trader2});
        buyOrders = await dex.getOrders(REP, SIDE.BUY);
        sellOrders = await dex.getOrders(REP, SIDE.SELL);
        assert(buyOrders.length === 2);
        assert(buyOrders[0].trader === trader2);
        assert(buyOrders[0].price === '11'); // uint values are returned from the blockchain as a string
        assert(buyOrders[1].trader === trader1);
        assert(sellOrders.length === 0);

        await dex.createLimitOrder(REP, web3.utils.toWei('10'), 9, SIDE.BUY, {from: trader2});
        buyOrders = await dex.getOrders(REP, SIDE.BUY);
        sellOrders = await dex.getOrders(REP, SIDE.SELL);
        assert(buyOrders.length === 3);
        assert(buyOrders[0].trader === trader2);
        assert(buyOrders[1].trader === trader1);
        assert(buyOrders[2].trader === trader2);
        assert(buyOrders[2].price === '9'); // uint values are returned from the blockchain as a string
        assert(sellOrders.length === 0);
    });

    it('should NOT create limit order if token was not registered for trading on dex', async() => {
        await expectRevert(dex.createLimitOrder(web3.utils.fromAscii('KNT'), web3.utils.toWei('10'), 10, SIDE.BUY, {from: trader1}), 'This token does not exist!');
    });

    it('should NOT create limit order if token is DAI', async() => {
        await expectRevert(dex.createLimitOrder(DAI, web3.utils.toWei('10'), 10, SIDE.BUY, {from: trader1}), 'You cannot trade in the quote currency!');
    });

    it('should NOT create limit order if token balance is insufficient', async() => {
        await dex.deposit(web3.utils.toWei('99'), REP, {from: trader1});
        await expectRevert(dex.createLimitOrder(REP, web3.utils.toWei('100'), 10, SIDE.SELL, {from: trader1}), 'You have insufficient token balance to make this trade!');
    });

    it('should NOT create limit order if DAI balance is insufficient', async() => {
        await dex.deposit(web3.utils.toWei('99'), DAI, {from: trader1});
        await expectRevert(dex.createLimitOrder(REP, web3.utils.toWei('10'), 10, SIDE.BUY, {from: trader1}), 'You have insufficient DAI balance to make this trade!');
    });

    it('should create market order & match against existing limit order(s)', async() => {
        await dex.deposit(web3.utils.toWei('100'), DAI, {from: trader1});
        await dex.createLimitOrder(REP, web3.utils.toWei('10'), 10, SIDE.BUY, {from: trader1});
        await dex.deposit(web3.utils.toWei('100'), REP, {from: trader2});
        await dex.createMarketOrder(REP, web3.utils.toWei('5'), SIDE.SELL, {from: trader2});
        const balances = await Promise.all([
            dex.traderBalances(trader1, DAI),
            dex.traderBalances(trader1, REP),
            dex.traderBalances(trader2, DAI),
            dex.traderBalances(trader2, REP),
        ]);
        const orders = await dex.getOrders(REP, SIDE.BUY);
        assert(orders[0].filled === web3.utils.toWei('5'));
        assert(balances[0].toString() === web3.utils.toWei('50'));
        assert(balances[1].toString() === web3.utils.toWei('5'));
        assert(balances[2].toString() === web3.utils.toWei('50'));
        assert(balances[3].toString() === web3.utils.toWei('95'));
    });

    it('should NOT create market order if token was not registered for trading on dex', async() => {
        await expectRevert(dex.createMarketOrder(web3.utils.fromAscii('KNT'), web3.utils.toWei('10'), SIDE.BUY, {from: trader1}), 'This token does not exist!');
    });

    it('should NOT create market order if token is DAI', async() => {
        await expectRevert(dex.createMarketOrder(DAI, web3.utils.toWei('10'), SIDE.BUY, {from: trader1}), 'You cannot trade in the quote currency!');
    });

    it('should NOT create market order if token balance is insufficient', async() => {
        await dex.deposit(web3.utils.toWei('99'), REP, {from: trader1});
        await expectRevert(dex.createMarketOrder(REP, web3.utils.toWei('100'), SIDE.SELL, {from: trader1}), 'You have insufficient token balance to make this trade!');
    });

    it('should NOT create market order if DAI balance is insufficient', async() => {
        await dex.deposit(web3.utils.toWei('100'), REP, {from: trader1});
        await dex.createLimitOrder(REP, web3.utils.toWei('100'), 10, SIDE.SELL, {from: trader1});
        await expectRevert(dex.createMarketOrder(REP, web3.utils.toWei('100'), SIDE.BUY, {from: trader2}), 'You have insufficient DAI balance to make this trade!');
    });
});