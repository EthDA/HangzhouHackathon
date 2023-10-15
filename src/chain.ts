import { Keyring } from '@polkadot/keyring';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { typesBundleForPolkadot } from '@crustio/type-definitions';
import { checkCid, checkSeeds, sendTxRetry, formatError, sleep, logger } from './utils';
import { CRUST_CHAIN_URL, CRUST_SEEDS } from './consts'
import { Header } from '@polkadot/types/interfaces';
import { CHAIN_STATUS_CODE } from "./types";
import BN from 'bn.js';
import Bluebird from 'bluebird';

export default class MainnetApi {
  private api: any;
  private latestBlock = 0;
  private fileByteFee = new BN(0);
  private fileBaseFee = new BN(0);
  private fileKeysCountFee = new BN(0);

  /**
   * Init Crust mainnet API
   */
  async initApi() {
    // Try to connect to Crust Chain
    this.api = new ApiPromise({
      provider: new WsProvider(CRUST_CHAIN_URL),
      typesBundle: typesBundleForPolkadot
    });
    await this.api.isReadyOrError;
    this.fileByteFee = new BN(await this.api.query.market.fileByteFee());
    this.fileBaseFee = new BN(await this.api.query.market.fileBaseFee());
    this.fileKeysCountFee = new BN(await this.api.query.market.fileKeysCountFee());

    // Show account
    const keyring = new Keyring();
    const address = keyring.createFromUri(CRUST_SEEDS, {}, 'sr25519').address
    const mainnetAddr = keyring.encodeAddress(keyring.decodeAddress(address), 66);
    logger.info(`Crust address:${mainnetAddr}`);
  }

  /**
   * Stop Crust mainnet API
   */
  stop() {
    this.api.disconnect();
  }

  /**
   * Get latest finalized block
   * @returns latest finalized block
   */
  async latestFinalizedBlock(): Promise<number> {
    await this.api.rpc.chain.subscribeFinalizedHeads(
      (head: Header) => {
        this.latestBlock = head.number.toNumber();
      },
    );
    return this.latestBlock;
  }

  /**
   * Ensure connection to Crust mainnet
   */
  private async ensureConnection(): Promise<void> {
    if (!(await this.withApiReady())) {
      logger.info('⛓ Connection broken, waiting for chain running.');
      await Bluebird.delay(6000); // IMPORTANT: Sequential matters(need give time for create ApiPromise)
      await this.initApi(); // Try to recreate api to connect running chain
    }
  }

  /**
   * Check if Crust api is ready
   * @returns ready or not
   */
  private async withApiReady(): Promise<boolean> {
    try {
      await this.api.isReadyOrError;
      return true;
    } catch (e) {
      logger.error(`💥 Error connecting with Chain: %s`, formatError(e));
      return false;
    }
  }

  /**
   * Get storage price by file size and storage time
   * @param {number} size
   * @param {number} years
   * @returns Storage price
   */
  private getPrice(
    size: number,
    years: number
  ): BN {
    return this.fileByteFee
      .mul(new BN(size))
      .divn(1024*1024)
      .add(this.fileBaseFee)
      .add(this.fileKeysCountFee)
      .mul(new BN(years*2));
  }

  /**
   * Place order on Crust mainnet
   * @param {string} cid
   * @param {number} size
   * @param {string} txHash transaction hash on source chain
   * @param {chainType} string
   * @param {boolean} Storage permanetly or not
   */
  async order(
    cid: string, 
    size: number, 
    txHash: string, 
    chainType: string, 
    isPermanent: boolean = false
  ): Promise<void> {
    await this.ensureConnection();

    // Check cid and seeds
    if (!checkCid(cid)) {
      throw new Error(JSON.stringify({
        status_code: CHAIN_STATUS_CODE.ILLEGAL_CID,
        message: `Illegal cid:'${cid}'`,
      }));
    }

    if (!checkSeeds(CRUST_SEEDS)) {
      throw new Error(JSON.stringify({
        status_code: CHAIN_STATUS_CODE.ILLEGAL_SEEDS,
        message: 'Illegal seeds',
      }));
    }

    // Send place order transaction
    const placeOrderTx = this.api.tx.market.placeStorageOrder(cid, size, 0, `{"txHash":"${txHash}","chainType":"${chainType}"}`);
    const placeOrderTxRes = await sendTxRetry(placeOrderTx, CRUST_SEEDS, 10);
    if (!placeOrderTxRes) {
      throw new Error(JSON.stringify({
        status_code: CHAIN_STATUS_CODE.PLACE_ORDER_FAILED,
        message: `Place order cid:${cid} failed`,
      }));
    }

    // Send prepaid transaction
    if (isPermanent) {
      const price = this.getPrice(size, 100);
      const prepaidTx = this.api.tx.market.addPrepaid(cid, price);
      const prepaidTxRes = await sendTxRetry(prepaidTx, CRUST_SEEDS, 10);
      if (!prepaidTxRes) {
        throw new Error(JSON.stringify({
          status_code: CHAIN_STATUS_CODE.ADD_PREPAID_FAILED,
          message: `Add prepaid for cid:${cid} failed`,
        }));
      }
      logger.info(`Add prepaid:${price} to permanent storage for cid:${cid} successfully!`);
    }
  }
}
