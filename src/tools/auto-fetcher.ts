/* eslint-disable no-console */
import { Log, Network } from 'forta-agent';
import { providers } from 'ethers';
import { EventFilter } from '@ethersproject/contracts';
import lodash from 'lodash';
import {
  getErc20TokenName,
  getErc20TokenSymbol,
  getTokenHash,
  identifyTokenInterface,
} from '../utils';
import { Token, TokenInterface } from '../types';
import { TokenStorage } from '../storage';
import { erc1155Iface, erc20Iface, erc721Iface } from '../contants';
import { getNetworkArgument, getTokenDeployer } from './utils';
import {
  DATA_PATH,
  ERROR_MAX_RETRY,
  ERROR_WAIT_MS,
  getTokensFileName,
  NETWORK_CONFIG,
} from './contants';

const NETWORK = getNetworkArgument();
const TOKENS_FILE_NAME = getTokensFileName(NETWORK);
const SCAN_DAYS = 28; // how many days we should process to collect tokens
const LOGS_DAYS = 1; // how many days we should check to compare tokens popularity
const BLOCKS_PER_DAY: Record<Network, number> = {
  [Network.MAINNET]: 6_000,
  [Network.BSC]: 28_000,
  [Network.POLYGON]: 40_000,
  [Network.OPTIMISM]: 60_000,
  [Network.ARBITRUM]: 70_000,
  [Network.AVALANCHE]: 40_000,
  [Network.FANTOM]: 75_000,
} as any;

export function filterTokenLogs(logs: Log[]) {
  const tokenEventTopics = [
    erc20Iface.getEventTopic('Transfer'),
    erc20Iface.getEventTopic('Approval'),
    erc721Iface.getEventTopic('ApprovalForAll'),
    erc1155Iface.getEventTopic('TransferSingle'),
    erc1155Iface.getEventTopic('TransferBatch'),
    erc1155Iface.getEventTopic('ApprovalForAll'),
    erc1155Iface.getEventTopic('URI'),
  ];

  return logs.filter((l) => l.topics.find((t) => tokenEventTopics.includes(t)));
}

async function getLogsNumber(
  filter: EventFilter,
  fromBlock: number,
  toBlock: number,
  provider: providers.JsonRpcProvider,
): Promise<number> {
  let counter = 0;

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
  const tokensByHash = new Map<string, Token>();
  const isHandledByAddress = new Map<string, boolean>();
  let state = { fromBlock, toBlock };

  if (await storage.exists()) {
    logger('Found existing token storage');

    const rows = await storage.read();
    for (const row of rows) {
      const hash = getTokenHash(row);
      tokensByHash.set(hash, row);
      isHandledByAddress.set(row.address.toLowerCase(), true);
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
          .map((l) => l.address.toLowerCase())
          .filter((a) => !isHandledByAddress.get(a));

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

          const type = await identifyTokenInterface(contractAddress, provider, progressLogger);

          if (type) {
            progressLogger(`Token interface: ${TokenInterface[type]}`);
          } else {
            progressLogger(`No matching token interface is found`);
            continue;
          }

          const name = await getErc20TokenName(contractAddress, provider);
          const symbol = await getErc20TokenSymbol(contractAddress, provider);
          const deployer = await getTokenDeployer(contractAddress, NETWORK);

          if (!name || !symbol) {
            progressLogger('Cannot get symbol and name');
            continue;
          }

          progressLogger(`Symbol ${symbol}. Name: ${name}. Deployer: ${deployer}.`);

          const newToken: Token = {
            type: type,
            name: name,
            symbol: symbol,
            address: contractAddress,
            deployer: deployer,
          };

          const tokenHash = getTokenHash(newToken);
          const oldToken = tokensByHash.get(tokenHash);

          if (oldToken) {
            progressLogger(`Token ${oldToken.address} has the same hash`);
            if (oldToken.deployer === newToken.deployer) {
              isHandledByAddress.set(newToken.address, true);
              progressLogger(
                'Existing token was deployed from the same address: ',
                oldToken.deployer,
              );
              continue;
            }
            const popularContractAddress = await getMorePopularToken(
              oldToken.address,
              contractAddress,
              toBlock,
              network,
              provider,
            );
            const isExistingTokenMorePopular = popularContractAddress === oldToken.address;

            progressLogger(
              `${
                isExistingTokenMorePopular ? 'Existing' : 'New '
              } contract is probably more legit ` +
                `since it has more logs over the last ` +
                `${LOGS_DAYS * BLOCKS_PER_DAY[network]} blocks`,
            );

            if (isExistingTokenMorePopular) {
              continue;
            }
          }

          isHandledByAddress.set(newToken.address, true);
          tokensByHash.set(tokenHash, newToken);
          // We redefine new legitimate tokens by writing them to the end.
          // Since initialization of tokens goes from the first record to the last,
          // the last record will overwrite the record of the previous one.
          await storage.append(newToken);
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
  const provider = new providers.JsonRpcProvider(NETWORK_CONFIG[NETWORK]);
  const storage = new TokenStorage(DATA_PATH, TOKENS_FILE_NAME);
  const endBlock = await provider.getBlockNumber();
  await fetch(
    Math.max(0, endBlock - BLOCKS_PER_DAY[NETWORK] * SCAN_DAYS),
    endBlock,
    provider,
    storage,
    NETWORK,
    (...args: any[]) => console.log(Network[NETWORK], ...args),
  );
}

initialize();
