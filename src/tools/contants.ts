import path from 'path';
import { Network } from 'forta-agent';
import { TokenInterface } from '../types';

export const DATA_PATH = path.resolve(__dirname, '../../data/');
export const LIST_ADDRESS_KEY = 'contract_address'; // name of the column that holds token address
export const ERROR_MAX_RETRY = 25; // 25 attempts
export const ERROR_WAIT_MS = 15 * 1000; // 30s
export const PARALLEL_REQUESTS = 3;

export const NETWORK_CONFIG = require('../../networks.config.json');

export const getTokensFileName = (network: Network) => 'chain-' + network;
export const getListFileName = (network: Network) => 'chain-' + network + '.list';
export const getPartialListFileName = (network: Network, type: TokenInterface) =>
  'chain-' + network + '.list.erc' + type;
