import { HandleTransaction, Network } from 'forta-agent';
import { createAddress, TestTransactionEvent } from 'forta-agent-tools/lib/tests';
import { provideHandleTransaction, provideInitialize } from './agent';
import { Logger } from './logger';
import { CreatedContract, DataContainer, Token, TokenInterface } from './types';
import {
  createImpersonatedTokenDeploymentFinding,
  createImpersonatedTokenFinding,
} from './findings';
import { CsvRow } from './storage';

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
  Logger.enabled = false;

  describe('initialize()', () => {
    it('reads storage and updates map objects properly', async () => {
      const mockProvider = {
        getNetwork: jest.fn().mockResolvedValue({ chainId: Network.MAINNET }),
      };

      mockStorage.exists.mockResolvedValueOnce(false);
      let data: DataContainer = {} as any;
      let initialize = provideInitialize(data, mockProvider as any);
      await initialize();

      expect(data.provider).toStrictEqual(mockProvider);
      expect(data.tokensByAddress).toBeInstanceOf(Map);
      expect(data.tokensByAddress.size).toStrictEqual(0);
      expect(data.legitTokenAddressesByName).toBeInstanceOf(Map);
      expect(data.legitTokenAddressesByName.size).toStrictEqual(0);
      expect(data.isInitialized).toStrictEqual(true);

      // -----

      const rows: CsvRow[] = [
        { address: Address.create(1), name: 'TKN1', type: TokenInterface.ERC20Detailed, legit: true },
        {
          address: Address.create(2),
          name: 'TKN2',
          type: TokenInterface.ERC721Metadata,
          legit: true,
        },
        { address: Address.create(3), name: 'TKN3', type: TokenInterface.ERC20Detailed, legit: true },
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

      mockStorage.exists.mockResolvedValueOnce(true);
      mockStorage.read.mockResolvedValue(rows);

      data = {} as any;
      initialize = provideInitialize(data, mockProvider as any);
      await initialize();

      expect(data.provider).toStrictEqual(mockProvider);
      expect(data.tokensByAddress).toBeInstanceOf(Map);
      expect(data.tokensByAddress.size).toStrictEqual(5);
      expect(data.legitTokenAddressesByName).toBeInstanceOf(Map);
      expect(data.legitTokenAddressesByName.size).toStrictEqual(3);
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

    beforeEach(() => {
      txEvent = new TestTransactionEvent();
      Object.values(mockUtils).forEach((fn) => fn.mockClear());
      Object.values(mockStorage).forEach((fn) => fn.mockClear());
      mockData.tokensByAddress = new Map();
      mockData.legitTokenAddressesByName = new Map();
    });

    it('returns empty findings if transaction is empty', async () => {
      mockUtils.findCreatedContracts.mockReturnValueOnce([]);
      mockUtils.filterTokenLogs.mockReturnValueOnce([]);

      const findings = await handleTransaction(txEvent);

      expect(mockUtils.filterTokenLogs).toBeCalledTimes(1);
      expect(mockUtils.findCreatedContracts).toBeCalledTimes(1);
      expect(mockUtils.identifyTokenInterface).toBeCalledTimes(0);
      expect(findings).toStrictEqual([]);
    });

    it('returns empty findings if there is a created token in traces', async () => {
      const createdContracts: CreatedContract[] = [
        {
          address: Address.create(1),
          deployer: Address.create(2),
        },
      ];

      mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
      mockUtils.filterTokenLogs.mockReturnValueOnce([]);
      mockUtils.identifyTokenInterface.mockResolvedValueOnce(TokenInterface.ERC20Detailed);
      mockUtils.getErc20TokenName.mockResolvedValueOnce(null);
      mockUtils.getErc20TokenSymbol.mockResolvedValueOnce('SYMBOL');

      const findings = await handleTransaction(txEvent);

      expect(findings).toStrictEqual([]);
    });

    it('returns empty findings if there is a new token in logs', async () => {
      mockUtils.findCreatedContracts.mockReturnValueOnce([]);
      mockUtils.filterTokenLogs.mockReturnValueOnce([{ address: Address.create(1) }]);
      mockUtils.identifyTokenInterface.mockResolvedValueOnce(TokenInterface.ERC20Detailed);
      mockUtils.getErc20TokenName.mockResolvedValue(null);
      mockUtils.getErc20TokenSymbol.mockResolvedValue('SYMBOL');

      const findings = await handleTransaction(txEvent);

      expect(findings).toStrictEqual([]);
    });

    it('returns empty findings if logs contain same token multiple times', async () => {
      mockUtils.findCreatedContracts.mockReturnValue([]);
      mockUtils.filterTokenLogs.mockReturnValue([
        { address: Address.create(1) },
        { address: Address.create(2) },
        { address: Address.create(1) },
        { address: Address.create(1) },
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

    it('returns empty findings if there is a created token in traces and logs', async () => {
      const createdContracts: CreatedContract[] = [
        { address: Address.create(1), deployer: Address.create(2) },
      ];

      mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
      mockUtils.filterTokenLogs.mockReturnValueOnce([{ address: createdContracts[0].address }]);
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
      const createdContracts: CreatedContract[] = [
        { address: Address.create(2), deployer: Address.create(3) },
      ];

      mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
      mockUtils.filterTokenLogs.mockReturnValueOnce([{ address: Address.create(1) }]);
      mockUtils.identifyTokenInterface.mockResolvedValue(null);
      mockUtils.getErc20TokenName.mockResolvedValue(null);
      mockUtils.getErc20TokenSymbol.mockResolvedValue('SYMBOL');

      const findings = await handleTransaction(txEvent);

      expect(findings).toStrictEqual([]);
    });

    it('returns empty findings if there is a token without symbol and name', async () => {
      const createdContracts: CreatedContract[] = [
        { address: Address.create(1), deployer: Address.create(2) },
      ];

      mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
      mockUtils.filterTokenLogs.mockReturnValueOnce([]);
      mockUtils.identifyTokenInterface.mockResolvedValue(TokenInterface.ERC20Detailed);
      mockUtils.getErc20TokenName.mockResolvedValue(null);
      mockUtils.getErc20TokenSymbol.mockResolvedValue(null);

      let findings = await handleTransaction(txEvent);

      expect(findings).toStrictEqual([]);

      // ------------

      mockUtils.findCreatedContracts.mockReturnValueOnce([]);
      mockUtils.filterTokenLogs.mockReturnValueOnce([{ address: Address.create(1) }]);
      mockUtils.identifyTokenInterface.mockResolvedValue(TokenInterface.ERC20Detailed);
      mockUtils.getErc20TokenName.mockResolvedValue(null);
      mockUtils.getErc20TokenSymbol.mockResolvedValue(null);

      findings = await handleTransaction(txEvent);

      expect(findings).toStrictEqual([]);
    });

    it('returns empty findings if impersonating token is already known', async () => {
      const SYMBOL = 'SYMBOL';

      mockUtils.findCreatedContracts.mockReturnValueOnce([]);
      mockUtils.filterTokenLogs.mockReturnValueOnce([{ address: Address.create(1) }]);
      mockUtils.identifyTokenInterface.mockResolvedValue(TokenInterface.ERC20Detailed);
      mockUtils.getErc20TokenName.mockResolvedValue(null);
      mockUtils.getErc20TokenSymbol.mockResolvedValue(SYMBOL);
      mockData.tokensByAddress.set(Address.create(1), { type: TokenInterface.ERC20Detailed, name: SYMBOL });
      mockData.legitTokenAddressesByName.set(SYMBOL, Address.create(2));

      const findings = await handleTransaction(txEvent);

      expect(findings).toStrictEqual([]);
    });

    it('adds new tokens to the database', async () => {
      const token1 = { symbol: 'SYMBOL', type: TokenInterface.ERC20Detailed, address: Address.create(1) };
      const token2 = { name: 'Name', type: TokenInterface.ERC1155, address: Address.create(2) };
      const impersonatingToken1 = {
        symbol: token1.symbol,
        type: TokenInterface.ERC721Metadata,
        address: Address.create(3),
      };

      mockUtils.findCreatedContracts.mockReturnValueOnce([]);
      mockUtils.filterTokenLogs.mockReturnValueOnce([
        { address: token1.address },
        { address: token2.address },
        { address: impersonatingToken1.address },
      ]);
      mockUtils.identifyTokenInterface.mockImplementation((address: string) => {
        if (address === token1.address) return token1.type;
        else if (address === token2.address) return token2.type;
        else if (address === impersonatingToken1.address) return impersonatingToken1.type;
        else return null;
      });
      mockUtils.getErc20TokenName.mockImplementation((address: string) => {
        if (address === token2.address) return token2.name;
        else return null;
      });
      mockUtils.getErc20TokenSymbol.mockImplementation((address: string) => {
        if (address === token1.address) return token1.symbol;
        if (address === impersonatingToken1.address) return impersonatingToken1.symbol;
        else return null;
      });

      await handleTransaction(txEvent);

      expect(mockData.legitTokenAddressesByName.get(token1.symbol)).toStrictEqual(token1.address);
      expect(mockData.legitTokenAddressesByName.get(token2.name)).toStrictEqual(token2.address);
      expect(mockData.tokensByAddress.get(token1.address)).toStrictEqual({
        type: token1.type,
        name: token1.symbol,
      });
      expect(mockData.tokensByAddress.get(token2.address)).toStrictEqual({
        type: token2.type,
        name: token2.name,
      });
      expect(mockData.tokensByAddress.get(impersonatingToken1.address)).toStrictEqual({
        type: impersonatingToken1.type,
        name: impersonatingToken1.symbol,
      });
      expect(mockStorage.append.mock.calls.length).toStrictEqual(3);
      expect(mockStorage.append.mock.calls[0][0]).toStrictEqual({
        address: token1.address,
        name: token1.symbol,
        type: token1.type,
        legit: true,
      });
      expect(mockStorage.append.mock.calls[1][0]).toStrictEqual({
        address: token2.address,
        name: token2.name,
        type: token2.type,
        legit: true,
      });
      expect(mockStorage.append.mock.calls[2][0]).toStrictEqual({
        address: impersonatingToken1.address,
        name: impersonatingToken1.symbol,
        type: impersonatingToken1.type,
        legit: false,
      });
    });

    it('skips handling of cached tokens', async () => {
      const token = { name: 'SYMBOL', address: Address.create(1), type: TokenInterface.ERC1155 };

      mockUtils.findCreatedContracts.mockReturnValueOnce([]);
      mockUtils.filterTokenLogs.mockReturnValueOnce([{ address: token.address }]);
      mockUtils.identifyTokenInterface.mockResolvedValue(token.type);
      mockUtils.getErc20TokenName.mockResolvedValue(null);
      mockUtils.getErc20TokenSymbol.mockResolvedValue(token.name);
      mockData.tokensByAddress.set(token.address, { type: token.type, name: token.name });

      const findings = await handleTransaction(txEvent);

      expect(findings).toStrictEqual([]);
      expect(mockUtils.identifyTokenInterface).toBeCalledTimes(0);
      expect(mockUtils.getErc20TokenName).toBeCalledTimes(0);
      expect(mockUtils.getErc20TokenSymbol).toBeCalledTimes(0);
    });

    it('returns a finding if there is creation of an impersonating token', async () => {
      const senderAddress = createAddress('0xSENDER');

      const legitToken = { name: 'SYMBOL', address: Address.create(1), type: TokenInterface.ERC20Detailed };
      const impersonatingToken = {
        name: legitToken.name,
        address: Address.create(2),
        type: TokenInterface.ERC20Detailed,
      };

      const createdContracts: CreatedContract[] = [
        { address: impersonatingToken.address, deployer: Address.create(3) },
      ];

      mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
      mockUtils.filterTokenLogs.mockReturnValueOnce([]);
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

    it('returns a finding if there is an impersonating token in logs', async () => {
      const legitToken = { name: 'SYMBOL', address: Address.create(1), type: TokenInterface.ERC20Detailed };
      const impersonatingToken = {
        name: legitToken.name,
        address: Address.create(2),
        type: TokenInterface.ERC20Detailed,
      };

      mockUtils.findCreatedContracts.mockReturnValueOnce([]);
      mockUtils.filterTokenLogs.mockReturnValueOnce([{ address: impersonatingToken.address }]);
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

    it('returns a finding if logs contain an impersonating token multiple times', async () => {
      const legitToken = { name: 'SYMBOL', address: Address.create(1), type: TokenInterface.ERC20Detailed };
      const impersonatingToken = {
        name: legitToken.name,
        address: Address.create(2),
        type: TokenInterface.ERC20Detailed,
      };

      mockUtils.findCreatedContracts.mockReturnValueOnce([]);
      mockUtils.filterTokenLogs.mockReturnValueOnce([
        { address: impersonatingToken.address },
        { address: impersonatingToken.address },
      ]);
      mockUtils.identifyTokenInterface.mockResolvedValue(impersonatingToken.type);
      mockUtils.getErc20TokenName.mockResolvedValue(null);
      mockUtils.getErc20TokenSymbol.mockResolvedValue(impersonatingToken.name);
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
      const legitToken = { name: 'SYMBOL', address: Address.create(1), type: TokenInterface.ERC20Detailed };
      const impersonatingToken = {
        name: legitToken.name,
        address: Address.create(2),
        type: TokenInterface.ERC20Detailed,
      };

      mockUtils.findCreatedContracts.mockReturnValueOnce([]);
      mockUtils.filterTokenLogs.mockReturnValueOnce([{ address: impersonatingToken.address }]);
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

    it('returns a finding if there is creation of an impersonating token and logs contain its events', async () => {
      const senderAddress = createAddress('0xSENDER');

      const legitToken = { name: 'SYMBOL', address: Address.create(1), type: TokenInterface.ERC20Detailed };
      const impersonatingToken = {
        name: legitToken.name,
        address: Address.create(2),
        type: TokenInterface.ERC20Detailed,
      };

      const createdContracts: CreatedContract[] = [
        { address: impersonatingToken.address, deployer: Address.create(3) },
      ];

      mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
      mockUtils.filterTokenLogs.mockReturnValueOnce([{ address: impersonatingToken.address }]);
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

    it('returns multiple findings if there are impersonating tokens in traces and logs', async () => {
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
      const legitToken4 = {
        name: 'SYMBOL4',
        address: Address.create(4),
        type: TokenInterface.ERC20Detailed,
      };
      const impersonatingToken1 = {
        name: legitToken1.name,
        address: Address.create(5),
        type: TokenInterface.ERC20Detailed,
      };
      const impersonatingToken2 = {
        name: legitToken2.name,
        address: Address.create(6),
        type: TokenInterface.ERC721Metadata,
      };
      const impersonatingToken3 = {
        name: legitToken3.name,
        address: Address.create(7),
        type: TokenInterface.ERC1155,
      };

      const map: { [address: string]: typeof legitToken1 } = {};

      [
        legitToken1,
        legitToken2,
        legitToken3,
        legitToken4,
        impersonatingToken1,
        impersonatingToken2,
        impersonatingToken3,
      ].forEach((token) => (map[token.address] = token));

      mockUtils.identifyTokenInterface.mockImplementation((address: string) => map[address].type);
      mockUtils.getErc20TokenSymbol.mockImplementation((address: string) => map[address].name);
      mockUtils.getErc20TokenName.mockResolvedValue(null);

      let createdContracts: CreatedContract[] = [
        { address: legitToken1.address, deployer: Address.create('DEPLOYER1') },
        { address: legitToken2.address, deployer: Address.create('DEPLOYER2') },
      ];

      mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
      mockUtils.filterTokenLogs.mockReturnValueOnce([
        { address: legitToken3.address },
        { address: legitToken4.address },
      ]);

      txEvent.setFrom(senderAddress);

      let findings = await handleTransaction(txEvent);

      // added legit tokens
      expect(findings).toStrictEqual([]);

      createdContracts = [
        { address: impersonatingToken1.address, deployer: createAddress('0xDEPLOYER3') },
        { address: impersonatingToken2.address, deployer: createAddress('0xDEPLOYER4') },
      ];
      mockUtils.findCreatedContracts.mockReturnValueOnce(createdContracts);
      mockUtils.filterTokenLogs.mockReturnValueOnce([{ address: impersonatingToken3.address }]);

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
        createImpersonatedTokenFinding(
          impersonatingToken3.name,
          legitToken3.address,
          impersonatingToken3.address,
        ),
      ]);
    });
  });
});
