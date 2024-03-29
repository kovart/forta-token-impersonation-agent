import {
  Finding,
  getEthersProvider,
  HandleTransaction,
  Initialize,
  TransactionEvent,
} from 'forta-agent';
import { BotAnalytics, FortaBotStorage, InMemoryBotStorage } from 'forta-bot-analytics';
import * as botUtils from './utils';
import { Logger } from './logger';
import { TokenStorage } from './storage';
import { CreatedContract, DataContainer, Token, TokenInterface } from './types';
import TokenProvider from './token-provider';
import { createFindingMediumSeverity, createFindingHighSeverity } from './findings';
import { DATA_PATH } from './contants';

const data: DataContainer = {} as any;
const botConfig = require('../bot-config.json');
const popularTokens = require('../data/popular-tokens.json');
const isDevelopment = process.env.NODE_ENV !== 'production';

const provideInitialize = (
  data: DataContainer,
  popularTokens: { symbol: string; name: string }[],
  utils: Pick<typeof botUtils, 'getTokenHash'>,
  config: typeof botConfig,
  isDevelopment: boolean,
): Initialize => {
  return async () => {
    data.provider = getEthersProvider();

    const network = await data.provider.getNetwork();

    data.network = network.chainId;
    data.tokenProvider = new TokenProvider(popularTokens);
    data.storage = new TokenStorage(DATA_PATH, 'chain-' + network.chainId);
    data.analytics = new BotAnalytics(
      isDevelopment ? new InMemoryBotStorage(Logger.log) : new FortaBotStorage(Logger.log),
      {
        key: network.chainId.toString(),
        syncTimeout: 60 * 60, // 1h
        maxSyncDelay: 14 * 24 * 60 * 60, // 14d
        observableInterval: 2 * 24 * 60 * 60, // 2d
        defaultAnomalyScore: { [BotAnalytics.GeneralAlertId]: config.defaultAnomalyScore },
        logFn: Logger.log,
      },
    );

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

    const { analytics } = data;

    const {
      findCreatedContracts,
      identifyTokenInterface,
      getErc20TokenName,
      getErc20TokenSymbol,
      getTokenHash,
      isScamToken,
    } = utils;

    await analytics.sync(txEvent.timestamp);

    const createdContracts: CreatedContract[] = findCreatedContracts(txEvent);

    for (const createdContract of createdContracts) {
      const deployerAddress = createdContract.deployer;
      const contractAddress = createdContract.address.toLowerCase();
      const contractType = await identifyTokenInterface(contractAddress, data.provider, Logger.log);

      if (!contractType) {
        Logger.log('Contract without token interface:', contractAddress);
        continue;
      }

      analytics.incrementBotTriggers(txEvent.timestamp);

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

        analytics.incrementAlertTriggers(txEvent.timestamp);

        if (data.tokenProvider.isPopularToken(token)) {
          findings.push(
            createFindingHighSeverity(token, existingToken, analytics.getAnomalyScore()),
          );
        } else {
          findings.push(
            createFindingMediumSeverity(token, existingToken, analytics.getAnomalyScore()),
          );
        }
      } else {
        data.tokensByHash.set(tokenHash, token);
        await data.storage.append(token);
      }
    }

    return findings;
  };
};

export default {
  initialize: provideInitialize(data, popularTokens, botUtils, botConfig, isDevelopment),
  handleTransaction: provideHandleTransaction(data, botUtils),

  provideInitialize,
  provideHandleTransaction,
};
