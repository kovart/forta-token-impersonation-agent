import path from 'path';
import { utils } from 'ethers';
import { Network } from 'forta-agent';
import Erc20Abi from './abi/erc20.json';
import Erc165Abi from './abi/erc165.json';
import Erc721Abi from './abi/erc721.json';
import Erc1155Abi from './abi/erc1155.json';
import { TokenInterface } from './types';

export const erc165Iface = new utils.Interface(Erc165Abi);
export const erc20Iface = new utils.Interface(Erc20Abi);
export const erc721Iface = new utils.Interface(Erc721Abi);
export const erc1155Iface = new utils.Interface(Erc1155Abi);

export const DATA_PATH = path.resolve(__dirname, '../data');
export const TRACE_API_SUPPORT: { [network: number]: boolean } = {
  [Network.MAINNET]: true,
};

export const INTERFACE_ID_BY_TYPE = {
  [TokenInterface.ERC20Detailed]: '0x36372b07',
  [TokenInterface.ERC721Metadata]: '0x5b5e139f',
  [TokenInterface.ERC1155]: '0xd9b67a26',
};
