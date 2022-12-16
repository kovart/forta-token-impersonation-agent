import {
  Finding,
  getEthersProvider,
  HandleTransaction,
  Initialize,
  TransactionEvent,
} from 'forta-agent';
import * as botUtils from './utils';
import { Logger } from './logger';
import { TokenStorage } from './storage';
import { CreatedContract, DataContainer, Token, TokenInterface } from './types';
import { createImpersonatedTokenFinding } from './findings';
import { DATA_PATH } from './contants';

const data: DataContainer = {} as any;
const botConfig = require('../bot-config.json');

const provideInitialize = (
  data: DataContainer,
  utils: Pick<typeof botUtils, 'getTokenHash'>,
  config: typeof botConfig,
): Initialize => {
  return async () => {
    data.provider = getEthersProvider();
    const network = await data.provider.getNetwork();

    data.storage = new TokenStorage(DATA_PATH, 'chain-' + network.chainId);
    data.exclusions = config.exclude || [];
    data.tokensByHash = new Map();
    if (await data.storage.exists()) {
      const tokens = await data.storage.read();
      for (const token of tokens) {
        data.tokensByHash.set(utils.getTokenHash(token), token);
      }
      Logger.log(`Loaded ${tokens.length} tokens`);
    }

    data.isInitialized = true;
  };
};

const provideHandleTransaction = (
  data: DataContainer,
  utils: typeof botUtils,
): HandleTransaction => {
  return async (txEvent: TransactionEvent) => {
    if (!data.isInitialized) throw new Error('Data container is not initialized');

    const findings: Finding[] = [];

    const {
      findCreatedContracts,
      identifyTokenInterface,
      getErc20TokenName,
      getErc20TokenSymbol,
      getTokenHash,
      isScamToken,
    } = utils;

    const createdContracts: CreatedContract[] = findCreatedContracts(txEvent);

    for (const createdContract of createdContracts) {
      const deployerAddress = createdContract.deployer;
      const contractAddress = createdContract.address.toLowerCase();
      const contractType = await identifyTokenInterface(contractAddress, data.provider, Logger.log);

      if (!contractType) {
        Logger.log('Contract without token interface:', contractAddress);
        continue;
      }

      const name = await getErc20TokenName(contractAddress, data.provider);
      const symbol = await getErc20TokenSymbol(contractAddress, data.provider);

      Logger.log(
        `Contract with ${TokenInterface[contractType]} interface |`,
        `Symbol ${symbol}. Name: ${name}.`,
      );

      if (!name && !symbol) continue;

      const token: Token = {
        name,
        symbol,
        type: contractType,
        address: contractAddress,
        deployer: deployerAddress,
      };

      // check if we should ignore this token
      let isIgnored = false;
      for (const exclusion of data.exclusions) {
        if (exclusion.symbol) isIgnored = exclusion.symbol === symbol;
        if (!isIgnored && exclusion.name) isIgnored = exclusion.name === name;
        if (isIgnored) break;
      }

      if (!isIgnored) {
        isIgnored = isScamToken(symbol, name);
      }

      if (isIgnored) continue;

      const tokenHash = getTokenHash(token);
      const existingToken = data.tokensByHash.get(tokenHash);

      if (existingToken) {
        if (existingToken.deployer === token.deployer) {
          Logger.log('Existing token was deployed from the same address:', existingToken.deployer);
          continue;
        }
        findings.push(createImpersonatedTokenFinding(token, existingToken));
      } else {
        data.tokensByHash.set(tokenHash, token);
        await data.storage.append(token);
      }
    }

    return findings;
  };
};

export default {
  initialize: provideInitialize(data, botUtils, botConfig),
  handleTransaction: provideHandleTransaction(data, botUtils),

  provideInitialize,
  provideHandleTransaction,
};
