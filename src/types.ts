import { providers } from 'ethers';
import { TokenStorage } from './storage';

export enum TokenInterface {
  ERC20Detailed = 1,
  ERC721Metadata,
  ERC1155,
}

export type CreatedContract = {
  deployer: string;
  address: string;
};

export type Token = {
  name: string;
  type: TokenInterface;
};

export type DataContainer = {
  storage: TokenStorage;
  provider: providers.JsonRpcProvider;
  tokensByAddress: Map<string, Token>;
  legitTokenAddressesByName: Map<string, string>;
  isInitialized: boolean;
};
