import { createAddress, TestTransactionEvent } from 'forta-agent-tools/lib/tests';
import { erc1155Code, erc20Code, erc721Code, tracesWithCreatedContracts } from './contants';
import { findCreatedContracts, identifyTokenInterface } from '../utils';
import { TokenInterface } from '../types';
import { INTERFACE_ID_BY_TYPE } from '../contants';

const mockContractClass = jest.fn();

jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  Contract: jest.fn().mockImplementation(() => mockContractClass()),
}));

describe('agent utils', () => {
  describe('identifyTokenInterface()', () => {
    const contractAddress = createAddress('0x1');
    const mockProvider = {
      getCode: jest.fn(),
    };
    const mockContract = {
      supportsInterface: jest.fn(),
      balanceOf: jest.fn(),
      totalSupply: jest.fn(),
      allowance: jest.fn(),
      symbol: jest.fn(),
      name: jest.fn(),
    };

    beforeAll(() => {
      mockContractClass.mockReturnValue(mockContract);
    });

    beforeEach(() => {
      mockProvider.getCode.mockClear();
      Object.values(mockContract).forEach((fn) => fn.mockClear());
    });

    afterAll(() => {
      mockContractClass.mockReset();
    });

    it('returns an interface if a contract implements ERC165', async () => {
      const types = [
        TokenInterface.ERC20Detailed,
        TokenInterface.ERC721Metadata,
        TokenInterface.ERC1155,
      ];

      for (const type of types) {
        mockContract.supportsInterface.mockImplementation(
          (interfaceId: string) => interfaceId === INTERFACE_ID_BY_TYPE[type],
        );
        const tokenInterface = await identifyTokenInterface(contractAddress, mockProvider as any);
        expect(tokenInterface).toStrictEqual(type);
      }

      expect(mockProvider.getCode).toBeCalledTimes(0);
    });

    it('returns an interface if a contract contains bytecode of the interface', async () => {
      const entries = [
        [TokenInterface.ERC20Detailed, erc20Code],
        [TokenInterface.ERC721Metadata, erc721Code],
        [TokenInterface.ERC1155, erc1155Code],
      ];

      mockContract.supportsInterface.mockResolvedValue(false);

      for (const [type, code] of entries) {
        mockProvider.getCode.mockResolvedValueOnce(code);
        const tokenInterface = await identifyTokenInterface(contractAddress, mockProvider as any);
        expect(tokenInterface).toStrictEqual(type);
      }
    });

    it('returns an interface if a proxified contract implements ERC20', async () => {
      mockProvider.getCode.mockResolvedValue('0xPROXYCODE');

      mockContract.supportsInterface.mockRejectedValue('Revert');

      mockContract.balanceOf.mockResolvedValue(1);
      mockContract.allowance.mockResolvedValue(100);
      mockContract.totalSupply.mockResolvedValue(200);
      mockContract.symbol.mockResolvedValue('SYMBOL');
      mockContract.name.mockRejectedValue('Revert');

      let tokenInterface = await identifyTokenInterface(contractAddress, mockProvider as any);

      expect(tokenInterface).toStrictEqual(TokenInterface.ERC20Detailed);
      expect(mockContract.balanceOf).toBeCalledTimes(1);
      expect(mockContract.allowance).toBeCalledTimes(1);
      expect(mockContract.totalSupply).toBeCalledTimes(1);
      expect(mockContract.symbol).toBeCalledTimes(1);

      mockContract.symbol.mockClear().mockRejectedValue('Revert');
      mockContract.name.mockClear().mockResolvedValue('NAME');

      tokenInterface = await identifyTokenInterface(contractAddress, mockProvider as any);

      expect(tokenInterface).toStrictEqual(TokenInterface.ERC20Detailed);
      expect(mockContract.name).toBeCalledTimes(1);
    });

    it('returns null if contract implements unknown interface', async () => {
      mockProvider.getCode.mockResolvedValue('0xUNKNOWNCODE');
      mockContract.supportsInterface.mockResolvedValue(false);
      mockContract.balanceOf.mockRejectedValue('Revert');
      mockContract.allowance.mockRejectedValue('Revert');

      const tokenInterface = await identifyTokenInterface(contractAddress, mockProvider as any);

      expect(tokenInterface).toStrictEqual(null);
    });
  });

  describe('findCreatedContracts()', () => {
    let txEvent: TestTransactionEvent;

    beforeEach(() => {
      txEvent = new TestTransactionEvent();
    });

    it('returns empty array if there are no created contracts', () => {
      const createdContracts = findCreatedContracts(txEvent);
      expect(createdContracts).toStrictEqual([]);
    });

    it('returns created contracts', async () => {
      // https://etherscan.io/tx/0x495402df7d45fe36329b0bd94487f49baee62026d50f654600f6771bd2a596ab/advanced

      txEvent.setFrom('0xddb108893104de4e1c6d0e47c42237db4e617acc');
      txEvent.transaction.nonce = 1229;
      txEvent.traces.push(...(tracesWithCreatedContracts as any[]));

      const createdContracts = findCreatedContracts(txEvent);

      expect(createdContracts).toStrictEqual([
        {
          address: '0x6B175474E89094C44Da98b954EedeAC495271d0F'.toLowerCase(),
          deployer: '0xb5b06a16621616875a6c2637948bf98ea57c58fa'.toLowerCase(),
        },
        {
          address: '0x9759a6ac90977b93b58547b4a71c78317f391a28'.toLowerCase(),
          deployer: '0x64a84e558192dd025f3a96775fee8fb530f27177'.toLowerCase(),
        },
      ]);
    });
  });
});
