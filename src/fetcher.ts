import { Network } from 'forta-agent';
import { providers } from 'ethers';
import { Token, TokenInterface } from './types';
import { EventFilter } from '@ethersproject/contracts';
import lodash from 'lodash';
import {
  filterTokenLogs,
  getErc20TokenName,
  getErc20TokenSymbol,
  identifyTokenInterface,
} from './utils';
import { TokenStorage } from './storage';

const networksConfig = require('../networks.config.json');

let NETWORK: Network = Network.MAINNET;

const args = process.argv.slice(2);
if (args[0]) {
  const id = Number(args[0]);
  if (!Network[id]) {
    throw new Error('Unknown chain id: ' + id);
  }
  NETWORK = id;
}

const DATA_PATH = '../data/'
const SCAN_DAYS = 28; // how many days we should process to collect tokens
const LOGS_DAYS = 1; // how many days we should check to compare tokens popularity
const ERROR_MAX_RETRY = 25; // 25 attempts
const ERROR_WAIT_MS = 30 * 1000; // 30s

// stats
const BLOCKS_PER_DAY: Record<Network, number> = {
  [Network.MAINNET]: 6_000,
  [Network.BSC]: 28_000,
  [Network.POLYGON]: 40_000,
  [Network.OPTIMISM]: 60_000,
  [Network.ARBITRUM]: 70_000,
  [Network.AVALANCHE]: 40_000,
  [Network.FANTOM]: 75_000,
} as any;

async function getLogsNumber(
  filter: EventFilter,
  fromBlock: number,
  toBlock: number,
  provider: providers.JsonRpcProvider,
): Promise<number> {
  let counter: number = 0;

  const requests = 5; // parallel requests
  const offset = 200; // logs per request

  const steps: any[] = [];

  let block = fromBlock;
  while (block < toBlock) {
    steps.push({
      fromBlock: block,
      toBlock: Math.min(toBlock, block + offset),
    });
    block += offset;
  }

  for (const stepsChunk of lodash.chunk(steps, requests)) {
    const logs = (
      await Promise.all(
        stepsChunk.map(async (step: any) =>
          (await provider.getLogs({ ...filter, ...step })).map(() => null),
        ),
      )
    ).flat();
    counter += logs.length;
  }

  return counter;
}

async function getMorePopularToken(
  address1: string,
  address2: string,
  toBlock: number,
  network: Network,
  provider: providers.JsonRpcProvider,
): Promise<string> {
  const fromBlock = toBlock - LOGS_DAYS * BLOCKS_PER_DAY[network];

  const [address1LogsNumber, address2LogsNumber] = await Promise.all([
    ...[address1, address2].map((address) =>
      getLogsNumber({ address }, fromBlock, toBlock, provider),
    ),
  ]);

  return address1LogsNumber >= address2LogsNumber ? address1 : address2;
}

async function fetch(
  fromBlock: number,
  toBlock: number,
  provider: providers.JsonRpcProvider,
  storage: TokenStorage,
  network: Network,
  logger: (...args: any) => void = console.log,
) {
  const tokensByAddress = new Map<string, Token>();
  const legitimateTokenAddressesByName = new Map<string, string>();
  let state = { fromBlock, toBlock };

  if (await storage.exists()) {
    logger('Found existing data');

    const rows = await storage.read();
    for (const row of rows) {
      tokensByAddress.set(row.address, row);
      if (row.legit) {
        legitimateTokenAddressesByName.set(row.name, row.address);
      }
    }

    const storageState = await storage.readState();

    if (storageState) {
      logger('Found storage state', storageState);

      if (storageState.fromBlock <= fromBlock && storageState.toBlock >= toBlock) {
        logger('Specified blocks are already scanned', { fromBlock, toBlock });
        return;
      }

      // Check for edge cases
      if (fromBlock < storageState.fromBlock) {
        logger(
          `'fromBlock' in storage state (${storageState.fromBlock}) is smaller ` +
            `than specified 'fromBlock' (${fromBlock})`,
        );
        logger('Reset storage state');
      } else if (fromBlock > storageState.toBlock) {
        logger(
          `Specified 'fromBlock' (${fromBlock}) is bigger ` +
            `than 'toBlock' in storage state (${storageState.toBlock})`,
        );
        logger('Reset storage state');
      } else {
        state = storageState;
        fromBlock = storageState.toBlock;
        logger(`Changed 'fromBlock' from ${fromBlock} to ${storageState.toBlock}`);
      }
    }
  }

  logger(`Scanning ${fromBlock}-${toBlock} blocks`);

  let attempt = 0;
  for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber++) {
    try {
      const block = await provider.getBlock(blockNumber);

      const receipts = await Promise.all(
        block.transactions.map((hash) => provider.getTransactionReceipt(hash)),
      );

      for (let t = 0; t < block.transactions.length; t++) {
        const receipt = receipts[t];
        const tokenLogs = filterTokenLogs(receipt.logs);

        if (tokenLogs.length === 0) continue;

        const contractAddresses = lodash
          .uniqBy(tokenLogs, (log) => log.address)
          .map((l) => l.address.toLowerCase());

        for (let c = 0; c < contractAddresses.length; c++) {
          const contractAddress = contractAddresses[c];

          const progressLogger = (...args: any) =>
            logger(
              `[B|${blockNumber}|${blockNumber - fromBlock}/${toBlock - fromBlock}]` +
                `[T|${t + 1}/${block.transactions.length}]` +
                `[C|${c + 1}/${contractAddresses.length}]`,
              ...args,
            );

          progressLogger('Contract:', contractAddress);

          const token = tokensByAddress.get(contractAddress);

          if (token) {
            progressLogger(`Known ${token.name} token (${TokenInterface[token.type]}), skip`);
            continue;
          }

          const type = await identifyTokenInterface(contractAddress, provider, progressLogger);

          if (type) {
            progressLogger(`Token interface: ${TokenInterface[type]}`);
          } else {
            progressLogger(`No matching token interface is found`);
            continue;
          }

          const name =
            (await getErc20TokenSymbol(contractAddress, provider)) ||
            (await getErc20TokenName(contractAddress, provider));

          if (!name) {
            progressLogger('Cannot get name');
            continue;
          }

          progressLogger('Token name:', name);

          let legitAddress = legitimateTokenAddressesByName.get(name);

          if (legitAddress) {
            progressLogger(`Contract ${legitAddress} has the same name`);
            const popularContractAddress = await getMorePopularToken(
              legitAddress,
              contractAddress,
              toBlock,
              network,
              provider,
            );
            progressLogger(
              `Contract ${popularContractAddress} is probably more legit ` +
                `since it has more logs over the last ` +
                `${LOGS_DAYS * BLOCKS_PER_DAY[network]} blocks`,
            );

            if (popularContractAddress !== contractAddress) {
              // we save the token after getMorePopularToken() is successfully executed
              // because we are retrying if we caught an error, and if the token is already saved,
              // then we will just skip this iteration
              tokensByAddress.set(contractAddress, { type, name });
              continue;
            }

            legitAddress = contractAddress;
          }

          tokensByAddress.set(contractAddress, { type, name });
          legitimateTokenAddressesByName.set(name, contractAddress);
          // We redefine new legitimate tokens by writing them to the end
          // without changing the value of the previous token.
          // Since iteration of tokens goes from the first record to the last,
          // the last record will overwrite the record of the previous one.
          await storage.append({
            type,
            name,
            address: contractAddress,
            legit: !legitAddress || legitAddress === contractAddress,
          });
        }
      }

      await storage.writeState({ fromBlock: state.fromBlock, toBlock: blockNumber });
      attempt = 0;
    } catch (e) {
      logger(`Error (${attempt + 1})`, e);

      if (attempt + 1 >= ERROR_MAX_RETRY) {
        logger('Retry attempts is exceeded');
        return;
      }

      logger('Waiting....');
      await new Promise((res) => setTimeout(res, ERROR_WAIT_MS));
      blockNumber--;
      attempt++;
    }
  }
}

async function initialize() {
  const provider = new providers.JsonRpcProvider(networksConfig[NETWORK]);
  const storage = new TokenStorage(DATA_PATH, 'chain-' + NETWORK);
  const endBlock = await provider.getBlockNumber();
  fetch(
    Math.max(0, endBlock - BLOCKS_PER_DAY[NETWORK] * SCAN_DAYS),
    endBlock,
    provider,
    storage,
    NETWORK,
    (...args: any[]) => console.log(Network[NETWORK], ...args),
  );
}

initialize();
