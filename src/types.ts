import { providers } from 'ethers';
import { TokenStorage } from './storage';

export enum TokenInterface {
  ERC20Detailed = 20,
  ERC721Metadata = 721,
  ERC1155 = 1155,
}

export type CreatedContract = {
  deployer: string;
  address: string;
};

export type Token = {
  name: string | null;
  symbol: string | null;
  type: TokenInterface;
  deployer: string;
  address: string;
};

export type DataContainer = {
  storage: TokenStorage;
  provider: providers.JsonRpcProvider;
  tokensByHash: Map<string, Token>;
  exclusions: {
    name?: string;
    symbol?: string;
  }[];
  isInitialized: boolean;
};
