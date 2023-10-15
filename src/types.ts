import { Database } from 'sqlite';
import MainnetApi from './chain';

export interface AppContext {
  mainnetApi: MainnetApi;
}

export interface Task {
  name: string;
  start: (context: AppContext) => void;
  stop: () => Promise<boolean>;
}

export const CHAIN_STATUS_CODE = {
  SUCCESS: 200,
  ILLEGAL_CID: 400,
  ILLEGAL_SEEDS: 401,
  PLACE_ORDER_FAILED: 402,
  ADD_PREPAID_FAILED: 403,
};
