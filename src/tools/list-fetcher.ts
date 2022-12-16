/* eslint-disable no-console */
import { providers } from 'ethers';
import { queue } from 'async';
import { Token, TokenInterface } from '../types';
import { BaseStorage, TokenStorage } from '../storage';
import {
  delay,
  getErc20TokenName,
  getErc20TokenSymbol,
  getTokenHash,
  isScamToken,
  retry,
} from '../utils';
import { getNetworkArgument, getTokenDeployer } from './utils';
import {
  DATA_PATH,
  getListFileName,
  getPartialListFileName,
  getTokensFileName,
  LIST_ADDRESS_KEY,
  NETWORK_CONFIG,
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

  let addressCounter = 0;

  const progress = (address: string, text: string) =>
    `Processed [${addressCounter}/${rows.length}]` +
    ` | Explorer queue [${offChainQueue.length()}] | ${address} | ${text}`;

  type UnfinishedToken = Pick<Token, 'symbol' | 'name' | 'address' | 'type'>;

  const offChainQueue = queue<UnfinishedToken>(async (unfinishedToken, callback) => {
    progress(unfinishedToken.address, 'Fetching deployer address');

    const deployer = await retry(() => getTokenDeployer(unfinishedToken.address, NETWORK), {
      wait: 1000 * 30,
    });
    const token: Token = { ...unfinishedToken, deployer };

    console.log(progress(unfinishedToken.address, `Fetched deployer address`));

    const hash = getTokenHash(token);
    tokensByHash.set(hash, token);

    await tokenStorage.append(token);
    isFetchedByAddress.set(token.address, true);

    addressCounter++;

    // 250ms pause
    await delay(250);
    callback();
  }, 1);

  const onChainQueue = queue<PreparedStorageRow>(async (row, callback) => {
    const { type, address } = row;

    console.log(progress(address, 'Processing'));

    if (isFetchedByAddress.get(address)) {
      console.log(progress(address, `Handled address, skip`));
      addressCounter++;
      return callback();
    }

    const [name, symbol] = await Promise.all([
      retry(() => getErc20TokenName(address, provider)),
      retry(() => getErc20TokenSymbol(address, provider)),
    ]);

    if (!name && !symbol) {
      // self-destroyed or unknown token
      console.log(progress(address, `Symbol: ${symbol} | Name: ${name}`));
      addressCounter++;
      return callback();
    }

    if (isScamToken(symbol, name)) {
      console.warn(progress(address, `Scam token, skip: ${[symbol, name].join(', ')}`));
      addressCounter++;
      return callback();
    }

    const hash = getTokenHash({ type, symbol, name });

    if (tokensByHash.get(hash)) {
      console.warn(progress(address, 'Not a unique hash, skip'));
      addressCounter++;
      return callback();
    }

    offChainQueue.push({
      type,
      name,
      symbol,
      address,
    });

    callback();
  }, 10);

  onChainQueue.error(console.error);
  offChainQueue.error(console.error);

  onChainQueue.push(rows);

  console.log('waiting for draining...');
  await onChainQueue.drain();
  await offChainQueue.drain();

  console.log('Finished');
}

fetch();
