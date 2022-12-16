/* eslint-disable no-console,no-async-promise-executor,@typescript-eslint/ban-types */
import { Network } from 'forta-agent';
import axios from 'axios';
import { parse } from 'node-html-parser';
import { retry } from '../utils';

export const getNetworkArgument = (): Network => {
  const args = process.argv.slice(2);
  if (args[0]) {
    const id = Number(args[0]);
    if (!Network[id]) {
      throw new Error('Unknown chain id: ' + id);
    }
    return id;
  }

  return Network.MAINNET;
};

export async function getTokenDeployer(tokenAddress: string, network: Network): Promise<string> {
  const etherscanLikeExplorers: { [chain: number]: string } = {
    [Network.MAINNET]: 'https://etherscan.io/address/',
    [Network.POLYGON]: 'https://polygonscan.com/address/',
    [Network.BSC]: 'https://bscscan.com/address/',
    [Network.OPTIMISM]: 'https://optimistic.etherscan.io/address/',
    [Network.FANTOM]: 'https://ftmscan.com/address/',
    [Network.ARBITRUM]: 'https://arbiscan.io/address/',
    [Network.AVALANCHE]: 'https://snowtrace.io/address/',
  };

  if (!etherscanLikeExplorers[network]) {
    throw new Error(`Deployer parser for ${Network[network]} is not implemented yet`);
  }

  try {
    const url = `${etherscanLikeExplorers[network]}${tokenAddress}`;
    const { data } = await retry(() => axios.get(url), { wait: 1000 * 30 });
    const root = parse(data, { blockTextElements: { script: false, style: false } });
    const addressEl = root.querySelector(
      '#ContentPlaceHolder1_trContract > div > div.col-md-8 > a',
    );
    const address = addressEl?.attrs.href.replace('/address/', '').toLowerCase();

    if (!address) {
      console.error('Cannot parse token: ' + tokenAddress);

      const isEOA =
        root
          .querySelector('#content > div.container.py-3 > div > div.mb-3.mb-lg-0 > h1')
          ?.innerText?.includes('Address') || false;

      if (isEOA) {
        console.warn(`Address ${address} is EOA`);
        return 'not-a-contract';
      }

      throw new Error('Cannot parse deployer address: non valid html response');
    }

    return address;
  } catch (e: any) {
    throw new Error('Cannot parse deployer address: ' + e.message || e.details || e.code || 'unknown error');
  }
}
