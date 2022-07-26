import { HandleTransaction, Initialize, Network } from 'forta-agent';
import { createAddress, TestTransactionEvent } from 'forta-agent-tools/lib/tests';
import lodash from 'lodash';
import agent from '../agent';
import * as agentUtils from '../utils';
import { createImpersonatedTokenFinding } from '../findings';
import { CreatedContract, DataContainer, Token, TokenInterface } from '../types';

const { provideInitialize, provideHandleTransaction } = agent;

const mockEthersProvider = {
  getNetwork: jest.fn(),
};

const mockStorage = {
  append: jest.fn(),
  read: jest.fn(),
  exists: jest.fn(),
};

jest.mock('forta-agent', () => ({
  ...jest.requireActual('forta-agent'),
  getEthersProvider: () => mockEthersProvider,
}));

jest.mock('../storage', () => ({
  ...jest.requireActual('../storage'),
  TokenStorage: jest.fn().mockImplementation(() => mockStorage),
}));

describe('token impersonation agent', () => {
  const autoAddress = (
    (i) => () =>
      createAddress('0x' + i++)
  )(1);

  const autoSymbol = (
    (i) => () =>
      'TKN' + i++
  )(1);

  const autoName = (
    (i) => () =>
      'Token' + i++
  )(1);

  const createToken = (params: {
    type: TokenInterface;
    symbol?: string | null;
    name?: string | null;
    address?: string;
    deployer?: string;
  }): Token => {
    const { symbol = autoSymbol(), name = autoName() } = params;
    return {
      type: params.type,
      name: name,
      symbol: symbol,
      address: params.address || autoAddress(),
      deployer: params.deployer || autoAddress(),
    };
  };

  describe('initialize()', () => {
    let mockTraceableNetworkMap: { [network: number]: boolean };
    let mockData: DataContainer;
    let mockBotConfig: { exclude?: any[] } = {};
    let initialize: Initialize;

    beforeEach(() => {
      mockData = {} as any;
      mockBotConfig = {} as any;
      mockTraceableNetworkMap = {};
      initialize = provideInitialize(mockData, agentUtils, mockBotConfig, mockTraceableNetworkMap);
    });

    it("throws an error if network doesn't support Trace API", async () => {
      mockTraceableNetworkMap[4321] = true;
      mockEthersProvider.getNetwork.mockResolvedValue({
        name: 'Test network',
        chainId: 1234,
      });

      await expect(initialize()).rejects.toThrowError();
    });

    it('initializes properly', async () => {
      const network = Network.FANTOM;
      const tokens = [
        createToken({ type: TokenInterface.ERC20Detailed }),
        createToken({ type: TokenInterface.ERC20Detailed, name: 'TKN', symbol: 'SYMBOL' }),
        createToken({ type: TokenInterface.ERC721Metadata }),
        createToken({ type: TokenInterface.ERC1155 }),
        // should override the previous one that has the same type, name and symbol
        createToken({ type: TokenInterface.ERC20Detailed, name: 'TKN', symbol: 'SYMBOL' }),
      ];

      mockTraceableNetworkMap[network] = true;
      mockEthersProvider.getNetwork.mockResolvedValue({
        name: Network[network],
        chainId: network,
      });
      mockStorage.exists.mockResolvedValue(true);
      mockStorage.read.mockResolvedValue(tokens);
      mockBotConfig.exclude = [{ symbol: 'TKN' }];

      await initialize();

      expect(mockData.isInitialized).toStrictEqual(true);
      expect(mockData.provider).toStrictEqual(mockEthersProvider);
      expect(mockData.storage).toStrictEqual(mockStorage);
      expect(mockData.exclusions).toStrictEqual(mockBotConfig.exclude);
      // without 2nd token
      expect(mockData.tokensByHash.size).toStrictEqual(tokens.length - 1);
      for (const token of tokens.filter((v, i) => i != 1)) {
        const hash = agentUtils.getTokenHash(token);
        expect(mockData.tokensByHash.get(hash)).toStrictEqual(token);
      }
    });
  });

  describe('handleTransaction()', () => {
    let mockData: DataContainer;
    let mockTxEvent: TestTransactionEvent;
    let handleTransaction: HandleTransaction;
    let mockAgentUtils: jest.MockedObject<typeof agentUtils>;

    beforeEach(() => {
      mockData = {} as any;
      mockData.tokensByHash = new Map();
      mockData.storage = mockStorage as any;
      mockData.exclusions = [];
      mockData.isInitialized = true;
      mockAgentUtils = {} as any;
      Object.entries(agentUtils).forEach(([key, fn]) => {
        // @ts-ignore
        mockAgentUtils[key] = jest.fn().mockImplementation(fn);
      });
      mockTxEvent = new TestTransactionEvent();
      handleTransaction = provideHandleTransaction(mockData, mockAgentUtils);
    });

    const mockTest = (params: {
      oldTokens?: Token[];
      newTokens?: Token[];
      contracts?: CreatedContract[]; // used to test how the function handles non-token contracts
    }) => {
      const { oldTokens = [], newTokens = [], contracts = [] } = params;
      const createdContracts: CreatedContract[] = [
        ...contracts,
        ...newTokens.map((t) => ({
          address: t.address,
          deployer: t.deployer,
        })),
      ];

      oldTokens.forEach((t) => mockData.tokensByHash.set(agentUtils.getTokenHash(t), t));
      mockAgentUtils.findCreatedContracts = jest.fn().mockReturnValue(createdContracts);
      mockAgentUtils.identifyTokenInterface = jest.fn().mockImplementation(async (address) => {
        return newTokens.find((t) => t.address === address)?.type || null;
      });
      mockAgentUtils.getErc20TokenName = jest.fn().mockImplementation(async (address) => {
        return newTokens.find((t) => t.address === address)?.name || null;
      });
      mockAgentUtils.getErc20TokenSymbol = jest.fn().mockImplementation(async (address) => {
        return newTokens.find((t) => t.address === address)?.symbol || null;
      });
    };

    it('returns empty findings if no contracts were created', async () => {
      const findings = await handleTransaction(mockTxEvent);
      expect(findings).toStrictEqual([]);
    });

    it('returns empty findings if no token contracts were created', async () => {
      const createdContracts: CreatedContract[] = [
        { address: autoAddress(), deployer: autoAddress() },
        { address: autoAddress(), deployer: autoAddress() },
      ];

      mockTest({
        contracts: createdContracts,
      });

      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([]);
      expect(mockAgentUtils.findCreatedContracts).toHaveBeenCalledWith(mockTxEvent);
      expect(mockAgentUtils.identifyTokenInterface.mock.calls[0][0]).toBe(
        createdContracts[0].address,
      );
      expect(mockAgentUtils.identifyTokenInterface.mock.calls[1][0]).toBe(
        createdContracts[1].address,
      );
    });

    it("returns empty findings if token doesn't have symbol and name", async () => {
      const oldTokens = [
        createToken({ type: TokenInterface.ERC20Detailed }),
        createToken({ type: TokenInterface.ERC721Metadata }),
        createToken({ type: TokenInterface.ERC1155 }),
      ];

      mockTest({
        oldTokens: oldTokens,
        // make created tokens have the same hash but different deployer and deployed address
        newTokens: oldTokens.map((t) => ({
          ...t,
          deployer: autoAddress(),
          address: autoAddress(),
        })),
      });

      mockAgentUtils.getErc20TokenName = jest.fn().mockResolvedValue(null);
      mockAgentUtils.getErc20TokenSymbol = jest.fn().mockResolvedValue(null);

      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([]);
      expect(mockAgentUtils.getErc20TokenSymbol).toBeCalled();
      expect(mockAgentUtils.getErc20TokenName).toBeCalled();
    });

    it('returns empty findings if impersonating tokens were excluded in the bot config', async () => {
      const oldTokens = [
        createToken({ type: TokenInterface.ERC20Detailed }),
        createToken({ type: TokenInterface.ERC721Metadata }),
        createToken({ type: TokenInterface.ERC1155 }),
      ];
      // make created tokens have the same hash
      const newTokens = oldTokens.map((t) => ({
        ...t,
        deployer: autoAddress(),
        address: autoAddress(),
      }));

      // check if new tokens impersonate old tokens
      expect(newTokens.map((t) => agentUtils.getTokenHash(t))).toStrictEqual(
        oldTokens.map((t) => agentUtils.getTokenHash(t)),
      );

      // make some exclusions check only by symbol
      mockData.exclusions = oldTokens.map((t, i) => ({
        name: i % 2 ? undefined : t.name!,
        symbol: t.symbol!,
      }));

      mockTest({
        oldTokens: oldTokens,
        newTokens: newTokens,
      });

      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([]);
      expect(mockAgentUtils.getErc20TokenName).toBeCalledTimes(3);
      expect(mockAgentUtils.getErc20TokenSymbol).toBeCalledTimes(3);
    });

    it('returns empty findings if impersonating tokens were deployed from the same address', async () => {
      const oldTokens = [
        createToken({ type: TokenInterface.ERC20Detailed }),
        createToken({ type: TokenInterface.ERC721Metadata }),
        createToken({ type: TokenInterface.ERC1155 }),
      ];
      // make created tokens have the same hash but different address
      const newTokens = oldTokens.map((t) => ({ ...t, address: autoAddress() }));

      // check if new tokens impersonate old tokens
      expect(newTokens.map((t) => agentUtils.getTokenHash(t))).toStrictEqual(
        oldTokens.map((t) => agentUtils.getTokenHash(t)),
      );

      mockTest({
        oldTokens: oldTokens,
        newTokens: newTokens,
      });

      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([]);
      expect(mockAgentUtils.getErc20TokenName).toBeCalledTimes(3);
      expect(mockAgentUtils.getErc20TokenSymbol).toBeCalledTimes(3);
    });

    it('returns findings if created tokens impersonate old tokens', async () => {
      const contracts: CreatedContract[] = [
        { address: autoAddress(), deployer: autoAddress() },
        { address: autoAddress(), deployer: autoAddress() },
        { address: autoAddress(), deployer: autoAddress() },
      ];
      const oldTokens = [
        createToken({ type: TokenInterface.ERC20Detailed }),
        createToken({ type: TokenInterface.ERC20Detailed, symbol: null }),
        createToken({ type: TokenInterface.ERC721Metadata, name: null }),
        createToken({ type: TokenInterface.ERC721Metadata }),
        createToken({ type: TokenInterface.ERC1155, symbol: null }),
        createToken({ type: TokenInterface.ERC1155 }),
      ];
      const notImpersonatingTokens = [
        createToken({ type: TokenInterface.ERC20Detailed }),
        createToken({ type: TokenInterface.ERC721Metadata }),
        createToken({ type: TokenInterface.ERC1155 }),
      ];
      const impersonatingTokens = oldTokens
        .filter((_, i) => i % 2 === 0)
        .map((t) => ({ ...t, deployer: autoAddress(), address: autoAddress() }));
      const impersonatedTokens = impersonatingTokens.map((newToken) =>
        oldTokens.find((t) => agentUtils.getTokenHash(t) === agentUtils.getTokenHash(newToken)),
      );

      // check if hash function works correctly
      expect(impersonatedTokens.filter((v) => !!v).length).toStrictEqual(
        impersonatingTokens.length,
      );

      mockTest({
        oldTokens: oldTokens,
        newTokens: lodash.shuffle([...notImpersonatingTokens, ...impersonatingTokens]),
        contracts: contracts,
      });

      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toHaveLength(impersonatingTokens.length);
      expect(findings).toStrictEqual(
        expect.arrayContaining(
          impersonatingTokens.map((newToken, i) => {
            const oldToken = impersonatedTokens[i]!;
            return createImpersonatedTokenFinding(newToken, oldToken);
          }),
        ),
      );
      // check if all new tokens are added to the database
      expect(mockData.storage.append).toHaveBeenCalledTimes(impersonatingTokens.length);
      expect(mockData.tokensByHash.size).toBe(oldTokens.length + notImpersonatingTokens.length);
      for (let i = 0; i < notImpersonatingTokens.length; i++) {
        const token = notImpersonatingTokens[i];
        expect(mockData.storage.append).toHaveBeenCalledWith(token);
        expect(mockData.tokensByHash.get(agentUtils.getTokenHash(token))).toStrictEqual(token);
      }
    });
  });
});
