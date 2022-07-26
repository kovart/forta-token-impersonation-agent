import { TransactionEvent } from 'forta-agent';
import { Contract, ethers, providers, utils } from 'ethers';
import { CreatedContract, Token, TokenInterface } from './types';
import {
  erc1155Iface,
  erc165Iface,
  erc20Iface,
  erc721Iface,
  INTERFACE_ID_BY_TYPE,
} from './contants';

export function findCreatedContracts(txEvent: TransactionEvent): CreatedContract[] {
  const createdContracts: CreatedContract[] = [];

  for (const trace of txEvent.traces) {
    if (trace.type === 'create') {
      const sender = txEvent.from.toLowerCase();
      const deployer = trace.action.from.toLowerCase();

      // Parity/OpenEthereum trace format contains created address
      // https://github.com/NethermindEth/docs/blob/master/nethermind-utilities/cli/trace.md
      if (trace.result.address) {
        createdContracts.push({
          deployer: deployer,
          address: trace.result.address.toLowerCase(),
        });
        continue;
      }

      // Fallback to more universal way

      if (sender === deployer || createdContracts.find((c) => c.address === deployer)) {
        // for contracts creating other contracts, the nonce would be 1
        const nonce = sender === deployer ? txEvent.transaction.nonce : 1;
        const createdContract = ethers.utils.getContractAddress({ from: deployer, nonce });
        createdContracts.push({
          deployer: deployer,
          address: createdContract.toLowerCase(),
        });
      }
    }
  }

  return createdContracts;
}

function isCodeCompatible(
  code: string,
  iface: utils.Interface,
  items: { functions?: string[]; events?: string[] },
): boolean {
  // Get hashes and remove 0x from the beginning
  const functionSignatures = (items.functions || []).map((name) => iface.getSighash(name).slice(2));
  const eventSignatures = (items.events || []).map((name) => iface.getEventTopic(name).slice(2));

  // check if code includes all the signatures
  return ![...functionSignatures, ...eventSignatures].find((hash) => !code.includes(hash));
}

export async function identifyTokenInterface(
  contractAddress: string,
  provider: providers.JsonRpcProvider,
  logger: (...args: any) => void = () => {},
): Promise<TokenInterface | null> {
  // First of all, let's check with erc165 as it's the most accurate way

  logger('Trying to identify interface with the ERC165');

  const erc165Contract = new Contract(contractAddress, erc165Iface, provider);

  try {
    const tokenInterface = (
      await Promise.all(
        [TokenInterface.ERC20Detailed, TokenInterface.ERC721Metadata, TokenInterface.ERC1155].map(
          async (tokenInterface) => ({
            tokenInterface: tokenInterface,
            isSupported: await erc165Contract.supportsInterface(
              INTERFACE_ID_BY_TYPE[tokenInterface],
            ),
          }),
        ),
      )
    ).find((v) => v.isSupported);

    if (tokenInterface) return tokenInterface.tokenInterface;
  } catch {
    // erc165 is not supported
  }

  // Let's check by function and event signatures inside the contract bytecode.
  // This method works if the contract doesn't use proxies.

  logger('Trying to identify interface using contract bytecode');

  const code = await provider.getCode(contractAddress);

  // https://eips.ethereum.org/EIPS/eip-20
  const isErc20 = isCodeCompatible(code, erc20Iface, {
    functions: ['balanceOf', 'allowance', 'approve', 'transfer', 'transferFrom', 'totalSupply'],
    events: ['Transfer', 'Approval'],
  });
  if (isErc20) {
    if (
      isCodeCompatible(code, erc20Iface, { functions: ['symbol'] }) ||
      isCodeCompatible(code, erc20Iface, { functions: ['name'] })
    ) {
      return TokenInterface.ERC20Detailed;
    }

    return null;
  }

  // https://eips.ethereum.org/EIPS/eip-721
  // 'safeTransferFrom' is ignored due to its overloading
  const isErc721 = isCodeCompatible(code, erc721Iface, {
    functions: [
      'balanceOf',
      'ownerOf',
      'transferFrom',
      'approve',
      'setApprovalForAll',
      'getApproved',
      'isApprovedForAll',
    ],
    events: ['Transfer', 'Approval', 'ApprovalForAll'],
  });
  if (isErc721) {
    if (
      isCodeCompatible(code, erc721Iface, { functions: ['symbol'] }) ||
      isCodeCompatible(code, erc721Iface, { functions: ['name'] })
    ) {
      return TokenInterface.ERC721Metadata;
    }

    return null;
  }

  // https://eips.ethereum.org/EIPS/eip-1155
  // TODO For unknown reasons, signature of 'balanceOf' cannot be found in the bytecode of ERC1155 contracts
  const isErc1155 = isCodeCompatible(code, erc1155Iface, {
    functions: [
      'safeTransferFrom',
      'safeBatchTransferFrom',
      'balanceOfBatch',
      'setApprovalForAll',
      'isApprovedForAll',
    ],
    events: ['TransferSingle', 'TransferBatch', 'ApprovalForAll'],
  });

  if (isErc1155) return TokenInterface.ERC1155;

  logger('Trying to identify ERC20 interface using duck typing');

  try {
    const address1 = utils.hexZeroPad('0x1', 20);
    const address2 = utils.hexZeroPad('0x2', 20);
    const erc20contract = new Contract(contractAddress, erc20Iface, provider);
    await Promise.all([
      erc20contract.balanceOf(address1),
      erc20contract.totalSupply(),
      erc20contract.allowance(address1, address2),
    ]);

    // success if at least one function is fulfilled
    await Promise.any([erc20contract.symbol(), erc20contract.name()]);

    return TokenInterface.ERC20Detailed;
  } catch (e) {
    // not erc20 interface
  }

  return null;
}

export async function getErc20TokenSymbol(
  contractAddress: string,
  provider: providers.JsonRpcProvider,
): Promise<string | null> {
  try {
    const contract = new Contract(contractAddress, erc20Iface, provider);
    return await contract.symbol();
  } catch {}

  return null;
}

export async function getErc20TokenName(
  contractAddress: string,
  provider: providers.JsonRpcProvider,
): Promise<string | null> {
  try {
    const contract = new Contract(contractAddress, erc20Iface, provider);
    return await contract.name();
  } catch {}

  return null;
}

export function getTokenHash(token: Token): string {
  return [token.symbol?.toLowerCase(), token.name?.toLowerCase(), token.type]
    .filter((v) => !!v)
    .join('.');
}
