/* eslint-disable no-console,no-async-promise-executor,@typescript-eslint/ban-types */
import { Network } from 'forta-agent';
import axios from 'axios';
import { parse } from 'node-html-parser';

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
  if (network !== Network.MAINNET) {
    throw new Error(`Deployer parser for ${Network[network]} is not implemented yet`);
  }

  try {
    const url = `https://etherscan.io/address/${tokenAddress}`;
    const { data } = await axios.get(url);
    const root = parse(data, { blockTextElements: { script: false, style: false } });
    const addressEl = root.querySelector(
      '#ContentPlaceHolder1_trContract > div > div.col-md-8 > a',
    );
    const address = addressEl?.attrs.href.replace('/address/', '').toLowerCase();

    if (!address) {
      throw new Error('Cannot parse token: ' + tokenAddress);
    }

    return address;
  } catch (e) {
    throw new Error('Cannot parse deployer address');
  }
}

export async function retry(params: {
  times: number;
  interval: number;
  fn: Function;
}): Promise<void> {
  const { fn, times, interval } = params;
  return new Promise(async (res, rej) => {
    for (let attempt = 0; attempt < times; attempt++) {
      try {
        await fn();
        return res();
      } catch (e) {
        console.error(`Attempt ${attempt + 1}/${times}:`, e);
        if (attempt + 1 < times) {
          await new Promise((res) => setTimeout(res, interval));
        }
      }
    }
    return rej();
  });
}
