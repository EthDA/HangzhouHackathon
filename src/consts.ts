import { ethers } from "ethers";
// Load env
require('dotenv').config();

/**
 * Get parameter
 * @param {string} name
 * @returns Parameter
 */
const getParam = (name: string) => {
  const param = process.env[name];
  if (!param) {
    return null;
  }
  return param;
};

/**
 * Get configure parameter, exit if cannot
 * @param {string} name
 * @returns Parameter
 */
const getParamOrExit = (name: string) => {
  const param = process.env[name];
  if (!param) {
    console.error(`Required config param '${name}' missing`);
    process.exit(1);
  }
  return param;
};

/**
 * Get EVM log topics
 * @param Topics tags
 * @returns Log topics
 */
const getTopics = (tags: string[]) => {
  const res: string[] = [];
  for (const tag of tags) {
    res.push(ethers.utils.id(tag));
  }
  return res;
}

export const CRUST_SEEDS = getParamOrExit("CRUST_SEEDS");
export const CRUST_CHAIN_URL = getParamOrExit("CRUST_CHAIN_URL");
export const CRUST_IPFS_GW = getParamOrExit("CRUST_IPFS_GW");
export const DB_PATH = getParamOrExit("DB_PATH");
export const API_PORT = parseInt(getParamOrExit("API_PORT"));

export const OP_ENDPOINT_URL = getParamOrExit("OP_ENDPOINT_URL");
export const OP_STORAGE_CONTRACT_ADDRESS = getParamOrExit("OP_STORAGE_CONTRACT_ADDRESS");

export const TRYOUT = 10;

export const ETH_DA_EVM_ABI = [
  "event EthDAEvent(string message)"
]
const ethDAEVMTopics = [
  "EthDAEvent(string)"
]
export const ETH_DA_EVM_TOPICS = getTopics(ethDAEVMTopics);
