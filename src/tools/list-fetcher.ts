/* eslint-disable no-console */
import { providers } from 'ethers';
import lodash from 'lodash';
import { Token, TokenInterface } from '../types';
import { BaseStorage, TokenStorage } from '../storage';
import { getErc20TokenName, getErc20TokenSymbol, getTokenHash } from '../utils';
import { getNetworkArgument, getTokenDeployer, retry } from './utils';
import {
  DATA_PATH,
  getListFileName,
  getPartialListFileName,
  getTokensFileName,
  LIST_ADDRESS_KEY,
  NETWORK_CONFIG,
  PARALLEL_REQUESTS,
} from './contants';

const NETWORK = getNetworkArgument();
const TOKENS_FILE_NAME = getTokensFileName(NETWORK);
const LIST_FILE_NAME = getListFileName(NETWORK);
const TOKEN_TYPES = [
  TokenInterface.ERC20Detailed,
  TokenInterface.ERC721Metadata,
  TokenInterface.ERC1155,
];

type ListStorageRow = {
  [LIST_ADDRESS_KEY]: string;
  type: string;
};

type PreparedStorageRow = {
  address: string;
  type: TokenInterface;
};

async function getAddressRows(): Promise<PreparedStorageRow[]> {
  const listStorage = new BaseStorage<ListStorageRow>(
    DATA_PATH,
    LIST_FILE_NAME,
    (row) => row,
    (row) => row,
  );

  const prepareAddress = (address: string) => address.toLowerCase().replace('\\x', '0x');

  if (await listStorage.exists()) {
    console.log('Loading list of token addresses');
    return (await listStorage.read()).map((row) => ({
      type: Number(row.type),
      address: prepareAddress(row[LIST_ADDRESS_KEY]),
    }));
  }

  const mergedRows: PreparedStorageRow[] = [];

  for (const type of TOKEN_TYPES) {
    const fileName = getPartialListFileName(NETWORK, type);
    const partialListStorage = new BaseStorage<{ [LIST_ADDRESS_KEY]: string }>(
      DATA_PATH,
      fileName,
      (row) => row,
      (row) => row,
    );
    if (await partialListStorage.exists()) {
      console.log(`Loading partial list of ${TokenInterface[type]} token addresses`);
      const partialRows = await partialListStorage.read();
      partialRows.forEach((row) =>
        mergedRows.push({ address: prepareAddress(row[LIST_ADDRESS_KEY]), type }),
      );
    }
  }

  return mergedRows;
}

async function fetch() {
  const isFetchedByAddress = new Map<string, boolean>();
  const tokenStorage = new TokenStorage(DATA_PATH, TOKENS_FILE_NAME);
  const provider = new providers.JsonRpcBatchProvider(NETWORK_CONFIG[NETWORK]);
  const tokensByHash = new Map<string, Token>();

  if (await tokenStorage.exists()) {
    for (const token of await tokenStorage.read()) {
      isFetchedByAddress.set(token.address.toString(), true);
      tokensByHash.set(getTokenHash(token), token);
    }

    console.log(`Found existing token storage with ${isFetchedByAddress.size} tokens`);
  }

  let rows = await getAddressRows();

  if (rows.length === 0) {
    throw new Error('There are no addresses to fetch');
  }

  const oldLength = rows.length;
  console.log(`Loaded ${rows.length} addresses`);
  rows = rows.filter((a) => !isFetchedByAddress.get(a.address));
  const newLength = rows.length;
  if (oldLength - newLength > 0) {
    console.log(`Filtered out ${oldLength - newLength} already fetched tokens`);
  }

  console.log(`Fetching ${rows.length} tokens...`);
  const chunks = lodash.chunk(rows, PARALLEL_REQUESTS);

  for (let i = 0; i < chunks.length; i++) {
    // parallel handing rows
    const chunkRows = chunks[i];

    try {
      await retry({
        times: 15,
        interval: 60 * 1000,
        fn: async () => {
          let finished = 0;
          const chunkTokens: Token[] = [];
          await Promise.all(
            chunkRows.map(async (row) => {
              const { type, address } = row;

              // we can reiterate this address if some chunkRows is failed
              // or a token implements multiple interfaces
              if (
                isFetchedByAddress.get(address) ||
                chunkTokens.find((t) => t.address === address)
              ) {
                return;
              }

              const name = await getErc20TokenName(address, provider);
              const symbol = await getErc20TokenSymbol(address, provider);

              const progress = () =>
                `[${i + 1}/${chunks.length}][${finished + 1}/${chunkRows.length}] ${address} | `;

              if (!name && !symbol) {
                // self-destroyed or unknown token
                console.log(progress() + `Symbol: ${symbol} | Name: ${name}`);
                finished++;
                return;
              }

              const deployer = await getTokenDeployer(address, NETWORK);
              const token: Token = { type, name, symbol, address, deployer };
              const hash = getTokenHash(token);

              console.log(progress() + `Symbol: ${symbol} | Name: ${name} | Deployer: ${deployer}`);

              if (tokensByHash.get(hash)) {
                console.warn(progress() + 'Not a unique hash, skip');
                finished++;
                return;
              }

              chunkTokens.push(token);
              tokensByHash.set(hash, token);
              finished++;
            }),
          );

          if (chunkTokens.length > 0) {
            await tokenStorage.append(chunkTokens);
            chunkTokens.forEach((t) => isFetchedByAddress.set(t.address, true));
          }
        },
      });
    } catch {
      break;
    }
  }

  console.log('Finished');
}

fetch();
