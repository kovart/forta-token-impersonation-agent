import {
  Finding,
  Initialize,
  HandleTransaction,
  TransactionEvent,
  getEthersBatchProvider,
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

const DATA_PATH = '../data';

const data: DataContainer = {} as any;

export const provideInitialize = (
  data: DataContainer,
  provider: providers.JsonRpcProvider,
): Initialize => {
  return async () => {
    const network = await provider.getNetwork();

    data.provider = provider;
    data.storage = new TokenStorage(DATA_PATH, 'chain-' + network.chainId);
    // all tokens
    data.tokensByAddress = new Map(); // address -> token object
    // legitimate tokens
    data.legitTokenAddressesByName = new Map(); // name -> token address

    if (await data.storage.exists()) {
      const tokens = await data.storage.read();

      for (const token of tokens) {
        if (token.legit) {
          data.legitTokenAddressesByName.set(token.name, token.address);
        }

        data.tokensByAddress.set(token.address, {
          type: token.type,
          name: token.name,
        });
      }
    }

    data.isInitialized = true;
  };
};

export const provideHandleTransaction = (
  data: DataContainer,
  utils: typeof agentUtils,
): HandleTransaction => {
  return async (txEvent: TransactionEvent) => {
    if (!data.isInitialized) throw new Error('Data container is not initialized');

    const findings: Finding[] = [];

    Logger.log('Transaction', txEvent.hash);

    const {
      findCreatedContracts,
      identifyTokenInterface,
      filterTokenLogs,
      getErc20TokenName,
      getErc20TokenSymbol,
    } = utils;

    const handleToken = async (
      address: string,
      type: TokenInterface,
      onFinding: (name: string, legitimateAddress: string) => void,
      logger: (...args: any[]) => void = Logger.log,
    ) => {
      // ERC20 and ERC721 with metadata should implement symbol and name functions.
      // ERC1155 should not, but some contracts implement them too.

      const name =
        (await getErc20TokenSymbol(address, data.provider)) ||
        (await getErc20TokenName(address, data.provider));

      if (!name) return;

      logger('Token name:', name);

      const legitAddress = data.legitTokenAddressesByName.get(name);

      if (legitAddress) {
        onFinding(name, legitAddress);
      } else {
        data.legitTokenAddressesByName.set(name, address);
      }

      data.tokensByAddress.set(address, { name, type });
      await data.storage.append({
        type,
        name,
        address,
        legit: !legitAddress,
      });
    };

    const createdContracts: CreatedContract[] = findCreatedContracts(txEvent);

    for (const createdContract of createdContracts) {
      const deployerAddress = txEvent.from;
      const contractAddress = createdContract.address.toLowerCase();
      const contractType = await identifyTokenInterface(contractAddress, data.provider, Logger.log);

      if (contractType) {
        Logger.log(`Found created ${TokenInterface[contractType]} contract:`, contractAddress);

        await handleToken(contractAddress, contractType, (name, legitimateAddress) => {
          findings.push(
            createImpersonatedTokenDeploymentFinding(
              name,
              deployerAddress,
              legitimateAddress,
              contractAddress,
            ),
          );
        });
      } else {
        Logger.log('Found created contract without token interface:', contractAddress);
      }
    }

    // We checked the created contracts using traces.
    // Unfortunately, not all networks support trace mode,
    // so we will try to find new tokens by their traces in transaction logs.

    // Filter out logs related to ERC20, ERC721, and ERC1155 interfaces
    const logs = filterTokenLogs(txEvent.logs);

    if (logs.length === 0) return findings;

    Logger.log(`Found ${logs.length} logs related to token events`);
    Logger.log(`Found ${logs.length} unique contracts in the logs`);
    const contractAddresses = lodash
      .uniqBy(logs, (log) => log.address)
      .map((v) => v.address.toLowerCase());

    for (let c = 0; c < contractAddresses.length; c++) {
      const contractAddress = contractAddresses[c];

      const logger = (...args: any) => Logger.log(`[${c + 1}/${contractAddresses.length}]`, ...args);

      logger(`Contract:`, contractAddress);

      const token = data.tokensByAddress.get(contractAddress);
      if (token) {
        logger(`Known ${token.name} token (${TokenInterface[token.type]}), skip`);
        continue;
      }

      const tokenType = await identifyTokenInterface(contractAddress, data.provider, logger);

      if (tokenType) {
        logger(`Identified interface: ${TokenInterface[tokenType]}`);
      } else {
        logger(`Cannot identify interface`);
        // Skip this log if token interface is not found
        continue;
      }

      await handleToken(
        contractAddress,
        tokenType,
        (name, legitimateAddress) => {
          findings.push(createImpersonatedTokenFinding(name, legitimateAddress, contractAddress));
        },
        logger,
      );
    }

    return findings;
  };
};

export default {
  initialize: provideInitialize(data, getEthersBatchProvider()),
  handleTransaction: provideHandleTransaction(data, agentUtils),

  provideInitialize,
  provideHandleTransaction,
};
