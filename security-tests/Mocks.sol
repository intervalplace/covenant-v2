// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Mimics mainnet USDT: 6 decimals, no return values, approve must go through 0.
contract MockUSDT {
    uint8 public constant decimals = 6;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external {
        require(!((a != 0) && (allowance[msg.sender][s] != 0)), "USDT: reset to 0 first");
        allowance[msg.sender][s] = a;
    }
    function transferFrom(address f, address t, uint256 a) external {
        require(allowance[f][msg.sender] >= a, "allowance"); require(balanceOf[f] >= a, "balance");
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= a;
        balanceOf[f] -= a; balanceOf[t] += a;
    }
}

// Canonical WETH9 behaviour
contract MockWETH {
    uint8 public constant decimals = 18;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    receive() external payable { balanceOf[msg.sender] += msg.value; }
    function deposit() external payable { balanceOf[msg.sender] += msg.value; }
    function withdraw(uint256 a) external {
        require(balanceOf[msg.sender] >= a); balanceOf[msg.sender] -= a;
        (bool ok,) = msg.sender.call{value: a}(""); require(ok, "WETH: send failed");
    }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address t, uint256 a) external returns (bool) { require(balanceOf[msg.sender] >= a); balanceOf[msg.sender] -= a; balanceOf[t] += a; return true; }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(balanceOf[f] >= a, "balance");
        if (f != msg.sender && allowance[f][msg.sender] != type(uint256).max) { require(allowance[f][msg.sender] >= a, "allowance"); allowance[f][msg.sender] -= a; }
        balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

// Mimics the Chainlink Feed Registry interface (phase-encoded round ids)
contract MockFeedRegistry {
    struct R { int256 a; uint256 t; }
    mapping(bytes32 => R[]) internal rounds;
    mapping(bytes32 => uint8) internal dec;
    uint16 public constant PHASE = 3;
    function k(address b, address q) internal pure returns (bytes32) { return keccak256(abi.encode(b, q)); }
    function setDecimals(address b, address q, uint8 d) external { dec[k(b, q)] = d; }
    function push(address b, address q, int256 a, uint256 t) external { rounds[k(b, q)].push(R(a, t)); }
    function decimals(address b, address q) external view returns (uint8) { require(rounds[k(b, q)].length > 0, "Feed not found"); return dec[k(b, q)]; }
    function latestRoundData(address b, address q) external view returns (uint80, int256, uint256, uint256, uint80) {
        R[] storage r = rounds[k(b, q)]; require(r.length > 0, "Feed not found");
        uint80 id = uint80((uint256(PHASE) << 64) | r.length); R storage x = r[r.length - 1];
        return (id, x.a, x.t, x.t, id);
    }
    function getRoundData(address b, address q, uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(uint256(id) >> 64 == PHASE, "No data present");
        uint256 n = uint256(id) & type(uint64).max; R[] storage r = rounds[k(b, q)];
        require(n >= 1 && n <= r.length, "No data present");
        R storage x = r[n - 1]; return (id, x.a, x.t, x.t, id);
    }
}

// USDT copy with Tether's transfer-fee switch turned on (bps of each transfer to the owner)
contract FeeUSDT {
    uint8 public constant decimals = 6;
    uint256 public feeBps = 20;
    address public owner = msg.sender;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external { allowance[msg.sender][s] = a; }
    function transferFrom(address f, address t, uint256 a) external {
        require(allowance[f][msg.sender] >= a, "allowance"); require(balanceOf[f] >= a, "balance");
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= a;
        uint256 fee = a * feeBps / 10000;
        balanceOf[f] -= a; balanceOf[t] += a - fee; balanceOf[owner] += fee;
    }
}

// EIP-7702 delegates for hostile buyer wallets
contract RejectEth { receive() external payable { revert("no eth"); } }
contract GasBurner { receive() external payable { while (true) {} } }
