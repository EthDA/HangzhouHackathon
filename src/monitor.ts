import { ethers } from "ethers";
import { Keyring } from '@polkadot/keyring';
import { AppContext, Task } from './types';
import { makeIntervalTask, logger, sleep } from './utils';
import { 
  OP_ENDPOINT_URL,
  OP_STORAGE_CONTRACT_ADDRESS,
  ETH_DA_EVM_ABI,
  ETH_DA_EVM_TOPICS,
  CRUST_SEEDS,
  CRUST_IPFS_GW
} from './consts';

const fs = require('fs');
const axios = require('axios');
const { create } = require('ipfs-http-client');
const blockFile = './block.json';

/**
 * Handle monitor request
 * @param {AppContext} context
 */
async function handleMonitor(
  context: AppContext
): Promise<void> {
  const provider = new ethers.providers.JsonRpcProvider(OP_ENDPOINT_URL);
  const signer = provider.getSigner();
  const StorageOrderContract = new ethers.Contract(OP_STORAGE_CONTRACT_ADDRESS, ETH_DA_EVM_ABI, provider);

  // Receive an event when ANY transfer occurs
  const searchStep = 1000;
  const storageOrderIface = new ethers.utils.Interface(ETH_DA_EVM_ABI);
  const curBlkNum = await getLatestBlkNum(OP_ENDPOINT_URL);
  if (curBlkNum === -1) {
    logger.error(`Get latest block number failed.`);
    return;
  }
  let fromBlkNum = getBlock();
  if (fromBlkNum === -1) {
    fromBlkNum = curBlkNum;
    saveBlock(fromBlkNum);
  } else if (fromBlkNum > curBlkNum) {
    saveBlock(curBlkNum);
    return;
  }
  const startBlkNum = fromBlkNum + 1;
  let toBlkNum = fromBlkNum + searchStep;
  try {
    while (fromBlkNum <= curBlkNum) {
      const filter = {
        address: [OP_STORAGE_CONTRACT_ADDRESS],
        topics: ETH_DA_EVM_TOPICS,
        fromBlock: "0x".concat(fromBlkNum.toString(16)),
        toBlock: "0x".concat(toBlkNum.toString(16)),
      }
      const events = await axios.post(
        OP_ENDPOINT_URL,
        {
          id: 1,
          jsonrpc: "2.0",
          method: "eth_getLogs",
          params: [filter]
        },
        {
          "content-type": "application/json",
        }
      );
      for (const event of events.data.result) {
        const { args } = storageOrderIface.parseLog(event);
        let tryout = 5;
        while(tryout-- > 0) {
          const data = args.message;
          const txHash = event.transactionHash;
          const { cid: orgCid, size } = await pin2Gateway(data);
          const cid = orgCid.toV0().toString();
          try {
            await context.mainnetApi.order(
              cid,
              size,
              txHash,
              'optimism',
              false
            );
            logger.info(`Place order with cid:'${cid}',size:${size},txHash:'${txHash}' successfully!`)
            break;
          } catch(e: any) {
            logger.error(`Failed to order cid:'${cid}',size:${size},txHash:'${txHash}', error message:${e}, try again${tryout}.`);
            await sleep(3000);
          }
        }
      }
      saveBlock(toBlkNum);
      fromBlkNum = toBlkNum;
      toBlkNum += searchStep;
      await sleep(1000);
    }
    saveBlock(curBlkNum);
    logger.info(`Check block ${startBlkNum} ~ ${curBlkNum} successfully.`);
  } catch (e: any) {
    logger.error(`Get logs from ${fromBlkNum} ~ ${toBlkNum} failed, error ${e.message}.`);
  }
}

/**
 * Get optimism latest block number
 * @param {string} endpoint, optimism endpoint
 * @returns Latest block number
 */
async function getLatestBlkNum(
  endpoint: string
): Promise<number> {
  let tryout = 10;
  while (--tryout >= 0) {
    try {
      const res = await axios.post(
        endpoint,
        {
          id: 1,
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: []
        }
      );
      return parseInt(res.data.result, 16);
    } catch (e: any) {
      logger.warn(`Get block number error:${e}`);
      await sleep(1500);
    }
  }
  return -1;
}

/**
 * Pin data to ipfs gateway
 * @param {string} data
 * @returns Pinned result
 */
async function pin2Gateway(
  data: string
): Promise<any> {
  // Construct auth header
  const keyring = new Keyring();
  const pair = keyring.addFromUri(CRUST_SEEDS);
  const sig = pair.sign(pair.address);
  const sigHex = '0x' + Buffer.from(sig).toString('hex');
  const authHeader = Buffer.from(`sub-${pair.address}:${sigHex}`).toString('base64');

  // Get ipfs client and cid
  const ipfs = create({
      url: CRUST_IPFS_GW + '/api/v0',
      headers: {
          authorization: 'Basic ' + authHeader
      }
  });
  const file = await ipfs.add(data);
  if (!file) {
      throw new Error('IPFS add failed, please try again.');
  }
  return file;
}

/**
 * Get latest monitored block number
 * @returns Block number
 */
function getBlock(): number {
  if (!fs.existsSync(blockFile)) return -1;
  const data = fs.readFileSync(blockFile);
  if (data === '') return -1;
  const json = JSON.parse(data);
  return json.blockNumber;
}

/**
 * Save latest monitored block number
 * @param {number} blockNumber
 */
function saveBlock(
  blockNumber: number
) {
  fs.writeFileSync(blockFile, JSON.stringify({blockNumber:blockNumber}));
}

/**
 * Create monitoring optimism event task
 * @param {AppContext} context
 * @returns Monitor task
 */
export async function createMonitorTask(
  context: AppContext
): Promise<Task> {
  logger.info(`Optimism storage contract address:${OP_STORAGE_CONTRACT_ADDRESS}`);
  logger.info(`Optimism endpoint:${OP_ENDPOINT_URL}`);
  const monitorInterval = 10 * 1000;
  return makeIntervalTask(
    monitorInterval,
    monitorInterval,
    'Monitor',
    context,
    handleMonitor,
  );
}
