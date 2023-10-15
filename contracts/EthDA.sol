//SPDX-License-Identifier: UnLicensed
pragma solidity ^0.8.19;

contract EthDA {
    address payable public owner;

    event EthDAEvent(string message);

    constructor() {
        owner = payable(msg.sender);
    }

    modifier onlyOwner {
        require(
            msg.sender == owner,
            "Only owner can call this function"
        );
        _;
    }

    function sendEthDAMessage(string calldata message) public onlyOwner {
        emit EthDAEvent(message);
    }
}
