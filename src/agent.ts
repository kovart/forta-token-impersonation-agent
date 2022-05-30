import {
  Finding,
  Initialize,
  HandleTransaction,
  TransactionEvent,
  getEthersProvider,
} from 'forta-agent';
import { providers } from 'ethers';
import lodash from 'lodash';
import {
  createImpersonatedTokenDeploymentFinding,
  createImpersonatedTokenFinding,
} from './findings';
import * as agentUtils from './utils';
import { Logger } from './logger';
import { TokenStorage } from './storage';
import { CreatedContract, DataContainer, TokenInterface } from './types';

type AgentUtils = typeof agentUtils;

const DATA_PATH = '../data';

const data: DataContainer = {} as any;

const handleTransactionWithTraces = async (
  txEvent: TransactionEvent,
  data: DataContainer,
  utils: AgentUtils,
): Promise<Finding[]> => {
  const findings: Finding[] = [];

  const { findCreatedContracts, identifyTokenInterface, getErc20TokenName, getErc20TokenSymbol } =
    utils;

  const createdContracts: CreatedContract[] = findCreatedContracts(txEvent);

  for (const createdContract of createdContracts) {
    const deployerAddress = txEvent.from;
    const contractAddress = createdContract.address.toLowerCase();
    const contractType = await identifyTokenInterface(contractAddress, data.provider, Logger.log);

    if (!contractType) {
      Logger.log('Found created contract without token interface:', contractAddress);
      continue;
    }

    Logger.log(
      `Found created contract with ${TokenInterface[contractType]} interface:`,
      contractAddress,
    );

    const name =
      (await getErc20TokenSymbol(contractAddress, data.provider)) ||
      (await getErc20TokenName(contractAddress, data.provider));

    if (!name) continue;

    Logger.log('Token name:', name);

    const legitAddress = data.legitTokenAddressesByName.get(name);

    if (legitAddress) {
      findings.push(
        createImpersonatedTokenDeploymentFinding(
          name,
          deployerAddress,
          legitAddress,
          contractAddress,
        ),
      );
    } else {
      data.legitTokenAddressesByName.set(name, contractAddress);
      await data.storage.append({
        name,
        type: contractType,
        address: contractAddress,
        legit: !legitAddress,
      });
    }
  }

  return findings;
};

const handleTransactionWithLogs = async (
  txEvent: TransactionEvent,
  data: DataContainer,
  utils: AgentUtils,
): Promise<Finding[]> => {
  const findings: Finding[] = [];

  const { filterTokenLogs, identifyTokenInterface, getErc20TokenName, getErc20TokenSymbol } = utils;

  // Filter out logs related to ERC20, ERC721, and ERC1155 interfaces
  const logs = filterTokenLogs(txEvent.logs);

  if (logs.length === 0) return findings;

  const contractAddresses = lodash
    .uniqBy(logs, (log) => log.address)
    .map((v) => v.address.toLowerCase())
    .filter((address) => !data.tokensByAddress.has(address));

  Logger.log(`Found ${logs.length} new contracts in the logs`);

  for (let c = 0; c < contractAddresses.length; c++) {
    const contractAddress = contractAddresses[c];

    const logger = (...args: any) => Logger.log(`[${c + 1}/${contractAddresses.length}]`, ...args);

    logger(`Contract:`, contractAddress);

    const contractType = await identifyTokenInterface(contractAddress, data.provider, logger);

    if (contractType) {
      logger(`Token interface: ${TokenInterface[contractType]}`);
    } else {
      logger(`Cannot identify token interface`);
      // Skip this log if token interface is not found
      continue;
    }

    const name =
      (await getErc20TokenSymbol(contractAddress, data.provider)) ||
      (await getErc20TokenName(contractAddress, data.provider));

    if (!name) continue;

    logger('Token name:', name);

    const legitAddress = data.legitTokenAddressesByName.get(name);

    if (legitAddress) {
      findings.push(createImpersonatedTokenFinding(name, legitAddress, contractAddress));
    } else {
      data.legitTokenAddressesByName.set(name, contractAddress);
    }

    data.tokensByAddress.set(contractAddress, { name, type: contractType });
    await data.storage.append({
      name,
      type: contractType,
      address: contractAddress,
      legit: !legitAddress,
    });
  }

  return findings;
};

const provideInitialize = (
  data: DataContainer,
  provider: providers.JsonRpcProvider,
): Initialize => {
  return async () => {
    const network = await provider.getNetwork();

    data.provider = provider;
    data.storage = new TokenStorage(DATA_PATH, 'chain-' + network.chainId);
    // all tokens (used when we cannot detect contract creation and have to check the logs for that)
    data.tokensByAddress = new Map(); // address -> token object
    // legitimate tokens
    data.legitTokenAddressesByName = new Map(); // name -> token address
    // used to select a strategy for handling tokens
    data.isTraceDataSupported = false;

    try {
      await data.provider.send('trace_transaction', [
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      ]);
      data.isTraceDataSupported = true;
    } catch {}

    if (await data.storage.exists()) {
      const tokens = await data.storage.read();

      for (const token of tokens) {
        if (token.legit) {
          data.legitTokenAddressesByName.set(token.name, token.address);
        }

        if (!data.isTraceDataSupported) {
          data.tokensByAddress.set(token.address, {
            type: token.type,
            name: token.name,
          });
        }
      }
    }

    data.isInitialized = true;
  };
};

const provideHandleTransaction = (
  data: DataContainer,
  utils: typeof agentUtils,
): HandleTransaction => {
  return async (txEvent: TransactionEvent) => {
    if (!data.isInitialized) throw new Error('Data container is not initialized');

    const findings: Finding[] = [];

    Logger.log('Transaction', txEvent.hash);

    const handleTransaction = data.isTraceDataSupported
      ? handleTransactionWithTraces
      : handleTransactionWithLogs;

    findings.push(...(await handleTransaction(txEvent, data, utils)));

    return findings;
  };
};

export default {
  initialize: provideInitialize(data, getEthersProvider()),
  handleTransaction: provideHandleTransaction(data, agentUtils),

  provideInitialize,
  provideHandleTransaction,
  handleTransactionWithLogs,
  handleTransactionWithTraces,
};
