import { AppContext, Task } from './types';
import { SubmittableExtrinsic } from '@polkadot/api/promise/types';
import { Keyring } from '@polkadot/keyring';
import Bluebird from 'bluebird';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import { createLogger, format, Logger, transports } from 'winston';

dayjs.extend(duration);

export const Dayjs = dayjs;

const level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

/**
 * Create interval task
 * @param {number} startDelay
 * @param {number} interval
 * @param {string} name
 * @param {AppContext} context
 * @param {(context: AppContext) => Promise<void>} handlerFn
 * @returns an interval task
 */
export async function makeIntervalTask(
  startDelay: number,
  interval: number, // in millseconds
  name: string,
  context: AppContext,
  handlerFn: (context: AppContext) => Promise<void>,
): Promise<Task> {
  logger.info('start task: "%s"', name);
  if (startDelay <= 0 || interval <= 0) {
    throw new Error('invalid arg, interval should be greater than 0');
  }
  let timer: NodeJS.Timeout;
  let stopped = false;

  const doInterval = async () => {
    if (stopped) {
      return;
    }
    try {
      await handlerFn(context);
    } catch (e) {
      logger.error(
        'unexpected exception running task "%s", %s',
        name,
        formatError(e),
      );
    } finally {
      //logger.info('task done: "%s"', name);
      if (!stopped) {
        timer = setTimeout(doInterval, interval);
      }
    }
  };
  return {
    name,
    start: () => {
      logger.info(`task "${name}" started`);
      timer = setTimeout(doInterval, startDelay);
      stopped = false;
    },
    stop: async () => {
      logger.info(`task "${name}" stopped`);
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      return true;
    },
  };
}

const defaultLogger = createLogger({
  level: level,
  format: format.combine(
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    format.colorize(),
    format.errors({ stack: true }),
    format.splat(),
    format.printf((info) => {
      let left = `[${info.timestamp}] ${info.level}: `;
      if (info.modulePrefix) {
        left += info.modulePrefix + ' ';
      }
      if (info.moduleId) {
        left += `[${info.moduleId}]`;
      }
      if (typeof info.message === 'string') {
        return `${left} ${info.message}`;
      }
      const m = JSON.stringify(info.message);
      return `${left} ${m}`;
    }),
  ),
  transports: [
    new transports.Console(),
  ],
});

export interface ChildLoggerConfig {
  moduleId: string;
  modulePrefix?: string;
}

export const logger = createChildLogger({
  moduleId: 'global',
  modulePrefix: '☄',
});

/**
 * Create child logger with configure and parent
 * @param {ChildLoggerConfig} config
 * @param {Logger} loggerParent
 * @returns Child logger
 */
export function createChildLoggerWith(
  config: ChildLoggerConfig,
  loggerParent: Logger,
): Logger {
  return loggerParent.child(config);
}

/**
 * Create child logger with configure
 * @param {ChildLoggerConfig} config
 * @returns Child logger
 */
export function createChildLogger(config: ChildLoggerConfig): Logger {
  return createChildLoggerWith(config, defaultLogger);
}

/**
 * timeout
 * @param {Promise<T>} p 
 * @param {number} timeout
 * @param {T | (() => T} timeoutValue
 * @returns timeout result
 */
export async function timeout<T>(
  p: Promise<T>,
  timeout: number,
  timeoutValue: T | (() => T),
): Promise<T> {
  const emptyResult = {} as any;
  const v = await Bluebird.race([p, Bluebird.delay(timeout, emptyResult)]);
  if (v === emptyResult) {
    if (typeof timeoutValue === 'function') {
      return (timeoutValue as () => T)();
    }
    return timeoutValue;
  }
  return v;
}

/**
 * isJSON
 * @param {string} data 
 * @returns is json or not
 */
export function isJSON(data: string) {
  try {
    JSON.parse(data);
    return true;
  } catch (e: any) {}
  return false;
}

/**
 * sleep
 * @param {number} microsec 
 * @returns promise
 */
export function sleep(microsec: number) {
  return new Promise(resolve => setTimeout(resolve, microsec))
}

/**
 * Check CIDv0 legality
 * @param {string} cid 
 * @returns boolean
 */
export function checkCid(cid: string) {
  return (cid.length === 46 && cid.substr(0, 2) === 'Qm') || (cid.length === 59 && cid.substr(0, 2) === 'ba');
}

/**
 * Check seeds(12 words) legality
 * @param {string} seeds 
 * @returns boolean
 */
export function checkSeeds(seeds: string) {
  return seeds.split(' ').length === 12;
}

/**
 * Send tx to Crust Network
 * @param {import('@polkadot/api/types').SubmittableExtrinsic} tx
 * @param {string} seeds 12 secret words 
 * @param {number} retry time 
 * @returns Promise<boolean> send tx success or failed
 */
export async function sendTxRetry(tx: SubmittableExtrinsic, seeds: string, retry: number) {
  let txRes: any;
  while (retry-- > 0) {
    // Send tx and disconnect chain
    try {
      txRes = await sendTx(tx, seeds);
    } catch(e: any) {
      logger.error('Send transaction failed');
    }
    if (txRes)
      break;
    await sleep(3000);
  }

  return txRes;
}

/**
 * Send tx to Crust Network
 * @param {import('@polkadot/api/types').SubmittableExtrinsic} tx
 * @param {string} seeds 12 secret words 
 * @returns Promise<boolean> send tx success or failed
 */
export async function sendTx(tx: SubmittableExtrinsic, seeds: string) {
  // 1. Load keyring
  logger.info('⛓  Sending tx to chain...');
  const krp = loadKeyringPair(seeds);
    
  // 2. Send tx to chain
  return new Promise((resolve, reject) => {
    tx.signAndSend(krp, ({events = [], status}) => {
      logger.info(
          `  ↪ 💸  Transaction status: ${status.type}, nonce: ${tx.nonce}`
      );

      if (
        status.isInvalid ||
        status.isDropped ||
        status.isUsurped ||
        status.isRetracted
      ) {
        reject(new Error('Invalid transaction'));
      } else {
        // Pass it
      }

      if (status.isInBlock) {
        events.forEach(({event: {method, section}}) => {
          if (section === 'system' && method === 'ExtrinsicFailed') {
            // Error with no detail, just return error
            logger.error('  ↪ ❌  Send transaction failed');
            resolve(false);
          } else if (method === 'ExtrinsicSuccess') {
            logger.info('  ↪ ✅  Send transaction success.');
            resolve(true);
          }
        });
      } else {
        // Pass it
      }
    }).catch((e: any) => {
      reject(e);
    });
  }).catch((e: any) => {});
}

/**
 * Format chain error message
 * @param {any} e
 */
export function formatError(e: any): string {
  return (e as Error).stack || JSON.stringify(e);
}

/**
 * Load keyring pair with seeds
 * @param {string} seeds 
 */
function loadKeyringPair(seeds: string) {
  const kr = new Keyring({
      type: 'sr25519',
  });

  const krp = kr.addFromUri(seeds);
  return krp;
}
