pragma solidity 0.6.3;
pragma experimental ABIEncoderV2; // experimental solidity pragma statement needed because we return an array of structs in one of the functions:

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';

contract Dex {
    
    using SafeMath for uint;
    
    struct Token {
        bytes32 ticker;
        address tokenAddress;
    }
    
    struct Order {
        uint id;
        address trader;
        Side side;
        bytes32 ticker;
        uint amount;
        uint filled;
        uint price;
        uint date;
    }
    
    enum Side {
        BUY,
        SELL
    }
    
    mapping(bytes32 => Token) public tokens;
    bytes32[] public tokenList;
    address public admin;
    mapping(address => mapping(bytes32 => uint)) public traderBalances;
    mapping(bytes32 => mapping(uint => Order[])) public orderBook;
    uint public nextOrderId;
    uint public nextTradeId;
    bytes32 constant DAI = bytes32('DAI'); // saves gas, as the code is not computed at runtime anymore (but at compile time)
    
    event NewTrade(uint tradeId, uint orderId, bytes32 indexed ticker, address indexed trader1, address indexed trader2, uint amount, uint price, uint date);
    
    constructor() public {
        admin = msg.sender;
    }
    
    function getOrders(bytes32 ticker, Side side) external view returns(Order[] memory) {
        return orderBook[ticker][uint(side)];
    }
    
    function getTokens() external view returns(Token[] memory) {
        Token[] memory _tokens = new Token[](tokenList.length);
        for (uint i = 0; i < tokenList.length; i++) {
            _tokens[i] = Token(tokens[tokenList[i]].ticker, tokens[tokenList[i]].tokenAddress);
        }
        return _tokens;
    }
    
    function addToken (bytes32 ticker, address tokenAddress) onlyAdmin() external {
        tokens[ticker] = Token(ticker, tokenAddress);
        tokenList.push(ticker);
    }
    
    // trader needs to call the approve function on his ERC20 token BEFORE calling this function!
    function deposit(uint amount, bytes32 ticker) tokenExists(ticker) external {
        IERC20(tokens[ticker].tokenAddress).transferFrom(msg.sender, address(this), amount);
        traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker].add(amount);
    }
    
    function withdraw(uint amount, bytes32 ticker) tokenExists(ticker) external {
        require(traderBalances[msg.sender][ticker] >= amount, "Insufficient token balance!");
        traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker].sub(amount);
        IERC20(tokens[ticker].tokenAddress).transfer(msg.sender, amount);
    }
    
    function createLimitOrder(bytes32 ticker, uint amount, uint price, Side side) tokenExists(ticker) notDAI(ticker) external {
        if (side == Side.SELL) {
            require(traderBalances[msg.sender][ticker] >= amount, "You have insufficient token balance to make this trade!");
        } else {
            require(traderBalances[msg.sender][DAI] >= amount.mul(price), "You have insufficient DAI balance to make this trade!");
        }
        
        Order[] storage orders = orderBook[ticker][uint(side)];
        orders.push(Order(nextOrderId, msg.sender, side, ticker, amount, 0, price, block.timestamp));
        
        // bubble sort for sorting the orderbook
        uint i = orders.length > 0 ? orders.length - 1 : 0;
        while (i > 0) {
            if (side == Side.BUY && orders[i - 1].price > orders[i].price) { // sort highest price first on buy orders
                break;
            } 
            if (side == Side.SELL && orders[i - 1].price < orders[i].price) { // sort lowest price first on sell orders
                break;
            }
            Order memory order = orders[i - 1];
            orders[i - 1] = orders[i];
            orders[i] = order;
            i = i.sub(1);
        }
        
        nextOrderId = nextOrderId.add(1);
    }
    
    function createMarketOrder(bytes32 ticker, uint amount, Side side) tokenExists(ticker) notDAI(ticker) external {
        if (side == Side.SELL) {
            require(traderBalances[msg.sender][ticker] >= amount, "You have insufficient token balance to make this trade!");
        } 
        
        Order[] storage orders = orderBook[ticker][uint(side == Side.BUY ? Side.SELL : Side.BUY)];
        
        // matching process
        uint i;
        uint remaining = amount;
        while (i < orders.length && remaining > 0) { // if either of the stopping conditions is false, the matching process is stopped
            uint available = orders[i].amount.sub(orders[i].filled);
            uint matched = (remaining > available) ? available : remaining;
            remaining = remaining.sub(matched);
            orders[i].filled = orders[i].filled.add(matched);
            emit NewTrade(nextTradeId, orders[i].id, ticker, orders[i].trader, msg.sender, matched, orders[i].price, block.timestamp);
            if (side == Side.SELL) {
                traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker].sub(matched);
                traderBalances[msg.sender][DAI] = traderBalances[msg.sender][DAI].add(matched.mul(orders[i].price));
                traderBalances[orders[i].trader][ticker] = traderBalances[orders[i].trader][ticker].add(matched);
                traderBalances[orders[i].trader][DAI] = traderBalances[orders[i].trader][DAI].sub(matched.mul(orders[i].price));
            }
            if (side == Side.BUY) {
                require(traderBalances[msg.sender][DAI] >= matched.mul(orders[i].price), "You have insufficient DAI balance to make this trade!");
                traderBalances[msg.sender][ticker] = traderBalances[msg.sender][ticker].add(matched);
                traderBalances[msg.sender][DAI] = traderBalances[msg.sender][DAI].sub(matched.mul(orders[i].price));
                traderBalances[orders[i].trader][ticker] = traderBalances[orders[i].trader][ticker].sub(matched);
                traderBalances[orders[i].trader][DAI] = traderBalances[orders[i].trader][DAI].add(matched.mul(orders[i].price));
            }
            nextTradeId = nextTradeId.add(1);
            i = i.add(1);
        }
        
        // remove 100% filled orders from the orderBook
        i = 0;
        while (i < orders.length && orders[i].filled == orders[i].amount) {
            for (uint j = i; j < orders.length - 1; j++) {
                orders[j] = orders[j + 1];
            }
            orders.pop();
            i = i.add(1);
        }
        
    }
    
    modifier onlyAdmin {
        require(msg.sender == admin, "Only admin is able to call this function!");
        _;
    }
    
    modifier tokenExists(bytes32 ticker) {
        require(tokens[ticker].tokenAddress != address(0), "This token does not exist!");
        _;
    }
    
    modifier notDAI(bytes32 ticker) {
        require(ticker != DAI, "You cannot trade in the quote currency!");
        _;
    }
}