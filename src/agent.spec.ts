import { HandleTransaction, Network } from 'forta-agent';
import { createAddress, TestTransactionEvent } from 'forta-agent-tools/lib/tests';
import agent from './agent';
import { CreatedContract, DataContainer, Token, TokenInterface } from './types';
import {
  createImpersonatedTokenDeploymentFinding,
  createImpersonatedTokenFinding,
} from './findings';
import { CsvRow } from './storage';

const { provideInitialize, provideHandleTransaction } = agent;

const mockStorage = {
  append: jest.fn(),
  read: jest.fn(),
  exists: jest.fn(),
};

jest.mock('./storage', () => ({
  ...jest.requireActual('./storage'),
  TokenStorage: jest.fn().mockImplementation(() => mockStorage),
}));

const Address = { create: (val: number | string) => createAddress('0x' + val) };

describe('token impersonation agent', () => {
  describe('initialize()', () => {
    const mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: Network.MAINNET }),
    };

    const rows: CsvRow[] = [
      {
        address: Address.create(1),
        name: 'TKN1',
        type: TokenInterface.ERC20Detailed,
        legit: true,
      },
      {
        address: Address.create(2),
        name: 'TKN2',
        type: TokenInterface.ERC721Metadata,
        legit: true,
      },
      {
        address: Address.create(3),
        name: 'TKN3',
        type: TokenInterface.ERC20Detailed,
        legit: true,
      },
      // Due to fetcher optimizations, this one should replace the previous legit token (first item)
      {
        address: Address.create(4),
        name: 'TKN1',
        type: TokenInterface.ERC721Metadata,
        legit: true,
      },
      // Should be cached, but not legit
      { address: Address.create(5), name: 'TKN2', type: TokenInterface.ERC1155, legit: false },
    ];

    it('initializes correctly if storage is empty', async () => {
      mockStorage.exists.mockResolvedValueOnce(false);
      const data: DataContainer = {} as any;
      const chainId = Network.MAINNET;
      const traceableNetworksMap = { [chainId]: true };
      mockProvider.getNetwork.mockResolvedValue({ chainId });
      const initialize = provideInitialize(data, mockProvider as any, traceableNetworksMap);
      await initialize();

      expect(data.provider).toStrictEqual(mockProvider);
      expect(data.tokensByAddress).toBeInstanceOf(Map);
      expect(data.tokensByAddress.size).toStrictEqual(0);
      expect(data.legitTokenAddressesByName).toBeInstanceOf(Map);
      expect(data.legitTokenAddressesByName.size).toStrictEqual(0);
      expect(data.isTraceDataSupported).toStrictEqual(true);
      expect(data.isInitialized).toStrictEqual(true);
    });

    it('initializes correctly if Trace API is supported', async () => {
      const chainId = Network.MAINNET;
      const traceableNetworksMap = { [chainId]: true };

      mockProvider.getNetwork.mockResolvedValue({ chainId });
      mockStorage.exists.mockResolvedValue(true);
      mockStorage.read.mockResolvedValue(rows);

      const data: DataContainer = {} as any;
      const initialize = provideInitialize(data, mockProvider as any, traceableNetworksMap);
      await initialize();

      expect(data.provider).toStrictEqual(mockProvider);
      expect(data.tokensByAddress).toBeInstanceOf(Map);
      expect(data.tokensByAddress.size).toStrictEqual(0);
      expect(data.legitTokenAddressesByName).toBeInstanceOf(Map);
      expect(data.legitTokenAddressesByName.size).toStrictEqual(3);
      expect(data.isTraceDataSupported).toStrictEqual(true);
      expect(data.isInitialized).toStrictEqual(true);
    });

    it('initializes correctly if Trace API is not supported', async () => {
      const chainId = Network.MAINNET;
      const traceableNetworksMap = { [chainId]: false };
      mockProvider.getNetwork.mockResolvedValue({ chainId });
      mockStorage.exists.mockResolvedValue(true);
      mockStorage.read.mockResolvedValue(rows);

      const data = {} as any;
      const initialize = provideInitialize(data, mockProvider as any, traceableNetworksMap);
      await initialize();

      expect(data.provider).toStrictEqual(mockProvider);
      expect(data.tokensByAddress).toBeInstanceOf(Map);
      expect(data.tokensByAddress.size).toStrictEqual(5);
      expect(data.legitTokenAddressesByName).toBeInstanceOf(Map);
      expect(data.legitTokenAddressesByName.size).toStrictEqual(3);
      expect(data.isTraceDataSupported).toStrictEqual(false);
      expect(data.isInitialized).toStrictEqual(true);

      const expectedTokensEntries: [string, Token][] = [
        [Address.create(1), { type: TokenInterface.ERC20Detailed, name: 'TKN1' }],
        [Address.create(2), { type: TokenInterface.ERC721Metadata, name: 'TKN2' }],
        [Address.create(3), { type: TokenInterface.ERC20Detailed, name: 'TKN3' }],
        [Address.create(4), { type: TokenInterface.ERC721Metadata, name: 'TKN1' }],
        [Address.create(5), { type: TokenInterface.ERC1155, name: 'TKN2' }],
      ];

      for (const [address, token] of expectedTokensEntries) {
        expect(data.tokensByAddress.get(address)).toStrictEqual(token);
      }

      const expectedLegitTokensEntries: [string, string][] = [
        ['TKN1', Address.create(4)],
        ['TKN2', Address.create(2)],
        ['TKN3', Address.create(3)],
      ];

      for (const [name, address] of expectedLegitTokensEntries) {
        expect(data.legitTokenAddressesByName.get(name)).toStrictEqual(address);
      }
    });
  });

  describe('handleTransaction()', () => {
    const mockProvider = {};
    const mockStorage = {
      read: jest.fn(),
      exists: jest.fn(),
      append: jest.fn(),
    };
    const mockData = {
      storage: mockStorage,
      provider: mockProvider,
      tokensByAddress: new Map<string, Token>(),
      legitTokenAddressesByName: new Map<string, string>(),
      isTraceDataSupported: false,
      isInitialized: true,
    };
    const mockUtils = {
      findCreatedContracts: jest.fn(),
      identifyTokenInterface: jest.fn(),
      filterTokenLogs: jest.fn(),
      getErc20TokenName: jest.fn(),
      getErc20TokenSymbol: jest.fn(),
    };
    const handleTransaction: HandleTransaction = provideHandleTransaction(
      mockData as any,
      mockUtils as any,
    );
    let txEvent: TestTransactionEvent;

    const createCreatedContract = (
      address: string,
      deployer: string = Address.create('DEPLOYER'),
    ): CreatedContract => ({ address, deployer });

    const createTokenLog = (contractAddress: string) => ({ address: contractAddress });

    describe('trace data is supported', () => {
      beforeEach(() => {
        txEvent = new TestTransactionEvent();
        Object.values(mockUtils).forEach((fn) => fn.mockClear());
        Object.values(mockStorage).forEach((fn) => fn.mockClear());
        mockData.tokensByAddress = new Map();
        mockData.legitTokenAddressesByName = new Map();
        mockData.isTraceDataSupported = true;
      });

      it('returns empty findings if transaction is empty', async () => {
        mockUtils.findCreatedContracts.mockReturnValueOnce([]);

        const findings = await handleTransaction(txEvent);

        expect(mockUtils.findCreatedContracts).toBeCalledTimes(1);
        expect(mockUtils.identifyTokenInterface).toBeCalledTimes(0);
        expect(findings).toStrictEqual([]);
      });

      it('returns empty findings if there is a created token in traces', async () => {
        const createdContracts: CreatedContract[] = [createCreatedContract(Address.create(1))];

        mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
        mockUtils.identifyTokenInterface.mockResolvedValueOnce(TokenInterface.ERC20Detailed);
        mockUtils.getErc20TokenName.mockResolvedValueOnce(null);
        mockUtils.getErc20TokenSymbol.mockResolvedValueOnce('SYMBOL');

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);
      });

      it('returns empty findings if contract has unknown interface', async () => {
        const createdContracts: CreatedContract[] = [createCreatedContract(Address.create(1))];

        mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
        mockUtils.identifyTokenInterface.mockResolvedValue(null);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockResolvedValue('SYMBOL');

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);
      });

      it('returns empty findings if there is a token without symbol and name', async () => {
        const createdContracts: CreatedContract[] = [createCreatedContract(Address.create(1))];

        mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
        mockUtils.identifyTokenInterface.mockResolvedValue(TokenInterface.ERC20Detailed);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockResolvedValue(null);

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);
      });

      it('returns a finding if there is creation of an impersonating token', async () => {
        const senderAddress = createAddress('0xSENDER');

        const legitToken = {
          name: 'SYMBOL',
          address: Address.create(1),
          type: TokenInterface.ERC20Detailed,
        };
        const impersonatingToken = {
          name: legitToken.name,
          address: Address.create(2),
          type: TokenInterface.ERC20Detailed,
        };

        const createdContracts: CreatedContract[] = [
          createCreatedContract(impersonatingToken.address),
        ];

        mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
        mockUtils.identifyTokenInterface.mockResolvedValueOnce(impersonatingToken.type);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockResolvedValueOnce(impersonatingToken.name);
        mockData.legitTokenAddressesByName.set(legitToken.name, legitToken.address);
        txEvent.setFrom(senderAddress);

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([
          createImpersonatedTokenDeploymentFinding(
            legitToken.name,
            senderAddress.toLowerCase(),
            legitToken.address,
            impersonatingToken.address,
          ),
        ]);
      });

      it('returns a finding if symbol is missing but name is impersonating another token', async () => {
        const senderAddress = Address.create('SENDER');

        const legitToken = {
          name: 'SYMBOL',
          address: Address.create(1),
          type: TokenInterface.ERC20Detailed,
        };
        const impersonatingToken = {
          name: legitToken.name,
          address: Address.create(2),
          type: TokenInterface.ERC20Detailed,
        };

        mockUtils.findCreatedContracts.mockReturnValueOnce([
          createCreatedContract(impersonatingToken.address),
        ]);
        mockUtils.identifyTokenInterface.mockResolvedValue(impersonatingToken.type);
        mockUtils.getErc20TokenName.mockResolvedValue(impersonatingToken.name);
        mockUtils.getErc20TokenSymbol.mockResolvedValue(null);
        mockData.legitTokenAddressesByName.set(legitToken.name, legitToken.address);

        txEvent.setFrom(senderAddress);

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([
          createImpersonatedTokenDeploymentFinding(
            legitToken.name,
            senderAddress.toLowerCase(),
            legitToken.address,
            impersonatingToken.address,
          ),
        ]);
      });

      it('returns multiple findings if there are impersonating tokens', async () => {
        const senderAddress = Address.create('SENDER');

        const legitToken1 = {
          name: 'SYMBOL1',
          address: Address.create(1),
          type: TokenInterface.ERC20Detailed,
        };
        const legitToken2 = {
          name: 'SYMBOL2',
          address: Address.create(2),
          type: TokenInterface.ERC1155,
        };
        const legitToken3 = {
          name: 'SYMBOL3',
          address: Address.create(3),
          type: TokenInterface.ERC1155,
        };
        const impersonatingToken1 = {
          name: legitToken1.name,
          address: Address.create(4),
          type: TokenInterface.ERC20Detailed,
        };
        const impersonatingToken2 = {
          name: legitToken2.name,
          address: Address.create(5),
          type: TokenInterface.ERC721Metadata,
        };

        const map: { [address: string]: typeof legitToken1 } = {};

        [legitToken1, legitToken2, legitToken3, impersonatingToken1, impersonatingToken2].forEach(
          (token) => (map[token.address] = token),
        );

        mockUtils.identifyTokenInterface.mockImplementation((address: string) => map[address].type);
        mockUtils.getErc20TokenSymbol.mockImplementation((address: string) => map[address].name);
        mockUtils.getErc20TokenName.mockResolvedValue(null);

        mockUtils.findCreatedContracts.mockReturnValueOnce([
          createCreatedContract(legitToken1.address),
          createCreatedContract(legitToken2.address),
          createCreatedContract(legitToken3.address),
        ]);

        txEvent.setFrom(senderAddress);

        // handle legit tokens
        let findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);

        mockUtils.findCreatedContracts.mockReturnValueOnce([
          createTokenLog(impersonatingToken1.address),
          createTokenLog(impersonatingToken2.address),
        ]);

        findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([
          createImpersonatedTokenDeploymentFinding(
            impersonatingToken1.name,
            senderAddress.toLowerCase(),
            legitToken1.address,
            impersonatingToken1.address,
          ),
          createImpersonatedTokenDeploymentFinding(
            impersonatingToken2.name,
            senderAddress.toLowerCase(),
            legitToken2.address,
            impersonatingToken2.address,
          ),
        ]);
      });

      it('adds new tokens to the database properly', async () => {
        const legitToken1 = {
          symbol: 'SYMBOL',
          type: TokenInterface.ERC20Detailed,
          address: Address.create(1),
        };
        const legitToken2 = {
          name: 'Name',
          type: TokenInterface.ERC1155,
          address: Address.create(2),
        };
        const impersonatingToken1 = {
          symbol: legitToken1.symbol,
          type: TokenInterface.ERC721Metadata,
          address: Address.create(3),
        };

        mockUtils.findCreatedContracts.mockReturnValueOnce([
          createCreatedContract(legitToken1.address),
          createCreatedContract(legitToken2.address),
          createCreatedContract(impersonatingToken1.address),
        ]);
        mockUtils.identifyTokenInterface.mockImplementation((address: string) => {
          if (address === legitToken1.address) return legitToken1.type;
          else if (address === legitToken2.address) return legitToken2.type;
          else if (address === impersonatingToken1.address) return impersonatingToken1.type;
          else return null;
        });
        mockUtils.getErc20TokenName.mockImplementation((address: string) => {
          if (address === legitToken2.address) return legitToken2.name;
          else return null;
        });
        mockUtils.getErc20TokenSymbol.mockImplementation((address: string) => {
          if (address === legitToken1.address) return legitToken1.symbol;
          if (address === impersonatingToken1.address) return impersonatingToken1.symbol;
          else return null;
        });

        await handleTransaction(txEvent);

        expect(mockData.legitTokenAddressesByName.get(legitToken1.symbol)).toStrictEqual(
          legitToken1.address,
        );
        expect(mockData.legitTokenAddressesByName.get(legitToken2.name)).toStrictEqual(
          legitToken2.address,
        );
        expect(mockStorage.append.mock.calls.length).toStrictEqual(2);
        expect(mockStorage.append.mock.calls[0][0]).toStrictEqual({
          address: legitToken1.address,
          name: legitToken1.symbol,
          type: legitToken1.type,
          legit: true,
        });
        expect(mockStorage.append.mock.calls[1][0]).toStrictEqual({
          address: legitToken2.address,
          name: legitToken2.name,
          type: legitToken2.type,
          legit: true,
        });
      });
    });

    describe('trace data is not supported', () => {
      beforeEach(() => {
        txEvent = new TestTransactionEvent();
        Object.values(mockUtils).forEach((fn) => fn.mockClear());
        Object.values(mockStorage).forEach((fn) => fn.mockClear());
        mockData.tokensByAddress = new Map();
        mockData.legitTokenAddressesByName = new Map();
        mockData.isTraceDataSupported = false;
      });

      it('returns empty findings if transaction is empty', async () => {
        mockUtils.filterTokenLogs.mockReturnValueOnce([]);

        const findings = await handleTransaction(txEvent);

        expect(mockUtils.filterTokenLogs).toBeCalledTimes(1);
        expect(mockUtils.identifyTokenInterface).toBeCalledTimes(0);
        expect(findings).toStrictEqual([]);
      });

      it('returns empty findings if there is a new token in logs', async () => {
        mockUtils.filterTokenLogs.mockReturnValueOnce([createTokenLog(Address.create(1))]);
        mockUtils.identifyTokenInterface.mockResolvedValueOnce(TokenInterface.ERC20Detailed);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockResolvedValue('SYMBOL');

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);
      });

      it('returns empty findings if logs contain same token multiple times', async () => {
        mockUtils.filterTokenLogs.mockReturnValue([
          createTokenLog(Address.create(1)),
          createTokenLog(Address.create(2)),
          createTokenLog(Address.create(2)),
          createTokenLog(Address.create(1)),
          createTokenLog(Address.create(1)),
        ]);
        mockUtils.identifyTokenInterface.mockResolvedValue(TokenInterface.ERC20Detailed);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockImplementation((address) => {
          if (address === Address.create(1)) return 'SYMBOL1';
          else if (address === Address.create(2)) return 'SYMBOL2';
          else return null;
        });

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);
      });

      it('returns empty findings if contract has unknown interface', async () => {
        mockUtils.filterTokenLogs.mockReturnValueOnce([createTokenLog(Address.create(1))]);
        mockUtils.identifyTokenInterface.mockResolvedValue(null);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockResolvedValue('SYMBOL');

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);
      });

      it('returns empty findings if there is a token without symbol and name', async () => {
        mockUtils.filterTokenLogs.mockReturnValueOnce([createTokenLog(Address.create(1))]);
        mockUtils.identifyTokenInterface.mockResolvedValue(TokenInterface.ERC20Detailed);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockResolvedValue(null);

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);
      });

      it('returns empty findings if impersonating token is already known', async () => {
        const token = {
          address: Address.create(1),
          name: 'SYMBOL',
          type: TokenInterface.ERC20Detailed,
        };

        mockUtils.filterTokenLogs.mockReturnValueOnce([createTokenLog(token.address)]);
        mockUtils.identifyTokenInterface.mockResolvedValue(token.type);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockResolvedValue(token.name);
        mockData.tokensByAddress.set(token.address, { type: token.type, name: token.name });

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);
      });

      it('skips handling of cached tokens', async () => {
        const token = { name: 'SYMBOL', address: Address.create(1), type: TokenInterface.ERC1155 };

        mockUtils.filterTokenLogs.mockReturnValueOnce([createTokenLog(token.address)]);
        mockUtils.identifyTokenInterface.mockResolvedValue(token.type);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockResolvedValue(token.name);
        mockData.tokensByAddress.set(token.address, { type: token.type, name: token.name });

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);
        expect(mockUtils.filterTokenLogs).toBeCalledTimes(1);
        expect(mockUtils.identifyTokenInterface).toBeCalledTimes(0);
        expect(mockUtils.getErc20TokenName).toBeCalledTimes(0);
        expect(mockUtils.getErc20TokenSymbol).toBeCalledTimes(0);
      });

      it('returns a finding if there is an impersonating token in logs', async () => {
        const legitToken = {
          name: 'SYMBOL',
          address: Address.create(1),
          type: TokenInterface.ERC20Detailed,
        };
        const impersonatingToken = {
          name: legitToken.name,
          address: Address.create(2),
          type: TokenInterface.ERC20Detailed,
        };

        mockUtils.filterTokenLogs.mockReturnValueOnce([createTokenLog(impersonatingToken.address)]);
        mockUtils.identifyTokenInterface.mockResolvedValueOnce(impersonatingToken.type);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockResolvedValueOnce(impersonatingToken.name);
        mockData.legitTokenAddressesByName.set(legitToken.name, legitToken.address);

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([
          createImpersonatedTokenFinding(
            legitToken.name,
            legitToken.address,
            impersonatingToken.address,
          ),
        ]);
      });

      it('returns a finding if logs repeatedly contain an impersonating token', async () => {
        const legitToken = {
          name: 'SYMBOL1',
          address: Address.create(1),
          type: TokenInterface.ERC20Detailed,
        };
        const impersonatingToken = {
          name: legitToken.name,
          address: Address.create(2),
          type: TokenInterface.ERC20Detailed,
        };

        mockUtils.filterTokenLogs.mockReturnValueOnce([
          createTokenLog(impersonatingToken.address),
          createTokenLog(Address.create(3)),
          createTokenLog(impersonatingToken.address),
        ]);
        mockUtils.identifyTokenInterface.mockResolvedValue(impersonatingToken.type);
        mockUtils.getErc20TokenName.mockResolvedValue(null);
        mockUtils.getErc20TokenSymbol.mockImplementation((address) =>
          address === impersonatingToken.address ? impersonatingToken.name : 'SYMBOL2',
        );
        mockData.legitTokenAddressesByName.set(legitToken.name, legitToken.address);

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([
          createImpersonatedTokenFinding(
            legitToken.name,
            legitToken.address,
            impersonatingToken.address,
          ),
        ]);
      });

      it('returns a finding if symbol is missing but name is impersonating another token', async () => {
        const legitToken = {
          name: 'SYMBOL',
          address: Address.create(1),
          type: TokenInterface.ERC20Detailed,
        };
        const impersonatingToken = {
          name: legitToken.name,
          address: Address.create(2),
          type: TokenInterface.ERC20Detailed,
        };

        mockUtils.filterTokenLogs.mockReturnValueOnce([createTokenLog(impersonatingToken.address)]);
        mockUtils.identifyTokenInterface.mockResolvedValue(impersonatingToken.type);
        mockUtils.getErc20TokenName.mockResolvedValue(impersonatingToken.name);
        mockUtils.getErc20TokenSymbol.mockResolvedValue(null);
        mockData.legitTokenAddressesByName.set(legitToken.name, legitToken.address);

        const findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([
          createImpersonatedTokenFinding(
            legitToken.name,
            legitToken.address,
            impersonatingToken.address,
          ),
        ]);
      });

      it('returns multiple findings if there are multiple impersonating tokens', async () => {
        const senderAddress = Address.create('SENDER');

        const legitToken1 = {
          name: 'SYMBOL1',
          address: Address.create(1),
          type: TokenInterface.ERC20Detailed,
        };
        const legitToken2 = {
          name: 'SYMBOL2',
          address: Address.create(2),
          type: TokenInterface.ERC1155,
        };
        const legitToken3 = {
          name: 'SYMBOL3',
          address: Address.create(3),
          type: TokenInterface.ERC1155,
        };
        const impersonatingToken1 = {
          name: legitToken1.name,
          address: Address.create(4),
          type: TokenInterface.ERC20Detailed,
        };
        const impersonatingToken2 = {
          name: legitToken2.name,
          address: Address.create(5),
          type: TokenInterface.ERC721Metadata,
        };

        const map: { [address: string]: typeof legitToken1 } = {};

        [legitToken1, legitToken2, legitToken3, impersonatingToken1, impersonatingToken2].forEach(
          (token) => (map[token.address] = token),
        );

        mockUtils.identifyTokenInterface.mockImplementation((address: string) => map[address].type);
        mockUtils.getErc20TokenSymbol.mockImplementation((address: string) => map[address].name);
        mockUtils.getErc20TokenName.mockResolvedValue(null);

        mockUtils.filterTokenLogs.mockReturnValueOnce([
          createTokenLog(legitToken1.address),
          createTokenLog(legitToken2.address),
          createTokenLog(legitToken3.address),
        ]);

        txEvent.setFrom(senderAddress);

        // handle legit tokens
        let findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([]);

        mockUtils.filterTokenLogs.mockReturnValueOnce([
          createTokenLog(impersonatingToken1.address),
          createTokenLog(impersonatingToken2.address),
        ]);

        findings = await handleTransaction(txEvent);

        expect(findings).toStrictEqual([
          createImpersonatedTokenFinding(
            impersonatingToken1.name,
            legitToken1.address,
            impersonatingToken1.address,
          ),
          createImpersonatedTokenFinding(
            impersonatingToken2.name,
            legitToken2.address,
            impersonatingToken2.address,
          ),
        ]);
      });

      it('adds new tokens to the database properly', async () => {
        const legitToken1 = {
          symbol: 'SYMBOL',
          type: TokenInterface.ERC20Detailed,
          address: Address.create(1),
        };
        const legitToken2 = {
          name: 'Name',
          type: TokenInterface.ERC1155,
          address: Address.create(2),
        };
        const impersonatingToken1 = {
          symbol: legitToken1.symbol,
          type: TokenInterface.ERC721Metadata,
          address: Address.create(3),
        };

        mockUtils.filterTokenLogs.mockReturnValueOnce([
          createTokenLog(legitToken1.address),
          createTokenLog(legitToken2.address),
          createTokenLog(impersonatingToken1.address),
        ]);
        mockUtils.identifyTokenInterface.mockImplementation((address: string) => {
          if (address === legitToken1.address) return legitToken1.type;
          else if (address === legitToken2.address) return legitToken2.type;
          else if (address === impersonatingToken1.address) return impersonatingToken1.type;
          else return null;
        });
        mockUtils.getErc20TokenName.mockImplementation((address: string) => {
          if (address === legitToken2.address) return legitToken2.name;
          else return null;
        });
        mockUtils.getErc20TokenSymbol.mockImplementation((address: string) => {
          if (address === legitToken1.address) return legitToken1.symbol;
          if (address === impersonatingToken1.address) return impersonatingToken1.symbol;
          else return null;
        });

        await handleTransaction(txEvent);

        expect(mockData.legitTokenAddressesByName.get(legitToken1.symbol)).toStrictEqual(
          legitToken1.address,
        );
        expect(mockData.legitTokenAddressesByName.get(legitToken2.name)).toStrictEqual(
          legitToken2.address,
        );
        expect(mockData.tokensByAddress.get(legitToken1.address)).toStrictEqual({
          type: legitToken1.type,
          name: legitToken1.symbol,
        });
        expect(mockData.tokensByAddress.get(legitToken2.address)).toStrictEqual({
          type: legitToken2.type,
          name: legitToken2.name,
        });
        expect(mockData.tokensByAddress.get(impersonatingToken1.address)).toStrictEqual({
          type: impersonatingToken1.type,
          name: impersonatingToken1.symbol,
        });
        expect(mockStorage.append.mock.calls.length).toStrictEqual(3);
        expect(mockStorage.append.mock.calls[0][0]).toStrictEqual({
          address: legitToken1.address,
          name: legitToken1.symbol,
          type: legitToken1.type,
          legit: true,
        });
        expect(mockStorage.append.mock.calls[1][0]).toStrictEqual({
          address: legitToken2.address,
          name: legitToken2.name,
          type: legitToken2.type,
          legit: true,
        });
        expect(mockStorage.append.mock.calls[2][0]).toStrictEqual({
          address: impersonatingToken1.address,
          name: impersonatingToken1.symbol,
          type: impersonatingToken1.type,
          legit: false,
        });
      });
    });
  });
});
