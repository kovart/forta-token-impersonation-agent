# Token Impersonation Bot

## Description

This bot detects creation of an impersonating token.
For example, the bot will detect when an attacker creates a copy of an existing APE token (ApeCoin),
which will be used for subsequent scams.
The key to determining whether a token is an impersonator is the token symbol, name and its interface.
Tokens deployed from the same address are ignored.

## Supported Token Interfaces

- ERC20
- ERC721
- ERC1155

## Supported Chains

- Ethereum (1)
- BSC (56)
- Polygon (137)
- Arbitrum (42161)
- Optimism (10)
- Fantom (250)
- Avalanche (43114)

## Configuration

Some protocols can create tokens with the same name.
To reduce the noise caused by such tokens, you can specify a name and a symbol that will be ignored.
You can either combine them, increasing the accuracy of the check, or specify either symbol or name.

By default, the bot ignores the deployment of Uniswap tokens:

```json
{
  "exclude": [
    {
      "symbol": "UNI-V2"
    }
  ]
}
```

## Alerts

- IMPERSONATED-TOKEN-DEPLOYMENT
  - Fired when someone deployed an impersonating token with a similar symbol, name and interface
  - Severity is:
    - "high" when the token impersonates a popular token
    - "medium" when the token impersonates a regular token
  - Type is always set to "suspicious"

## Test Data

#### Ethereum Mainnet (Chain 1)

Alert `IMPERSONATED-TOKEN-DEPLOYMENT` for "GOLIATH (Goliath)" token:

```bash
$ npm run tx 0xd9eef1565c3e580a207855aa76baab84033c79f1accf449b1d3848d5e9c795a9
```

## Token Data

The bot uses tokens collected at runtime as well as pre-generated tokens.
Token data is located in the [data](./data) folder. Each chain uses its own file.
For example, for the `Mainnet`, the file will be called `chain-1.csv`, since 1 is the id of that network.

## Data Generation

Pre-generated token data can be collected in two ways.

### Automatic

All you need to do is run the following command, passing an id of the desired network:

```bash
$ npm run fetch:auto 137
```

For instance, this command starts scanning blocks of the last 28 days on the Polygon network.
The script searches for tokens by their traces in transaction events.
If a discovered token has a similar hash to a previously discovered one, the script finds the most popular one.
If the new token is more popular, it will be written to the end of the data file,
so that it will overwrite the previous one.
If the previous token is more popular, the new token will be ignored.

All tokens found will be written to the `chain-137.csv` file. Also, a state file `chain-137.fetcher.json` will be created,
which will contain the scanned range of blocks, and which can be used by the script for optimizations in subsequent runs.

## List

The most accurate way to generate data is to use prepared list of token addresses.
It can be obtained from services such as [dune.com](https://dune.com).

For example, this query allows you to get the most popular erc20 tokens for 3 months:

```sql
SELECT contract_address, events
FROM (
    SELECT
        COALESCE(transfer_table.contract_address, approval_table.contract_address) as contract_address,
        COALESCE(transfer_count, 0) + COALESCE(approval_count, 0) as events
    FROM (
        SELECT contract_address, COUNT(DISTINCT "spender") as approval_count
        FROM erc20."ERC20_evt_Approval"
        WHERE evt_block_time >= now() - interval '3' month
        GROUP BY contract_address
    ) as approval_table
    FULL OUTER JOIN (
        SELECT contract_address, COUNT(DISTINCT "to") as transfer_count
        FROM erc20."ERC20_evt_Transfer"
        WHERE evt_block_time >= now() - interval '3' month
        GROUP BY contract_address
    ) as transfer_table
    ON (transfer_table.contract_address = approval_table.contract_address)
) as events_table
WHERE events >= 50
ORDER BY events DESC
```

The list of token addresses must be placed in the [data](./data) folder, named chain-{ID}.list.erc{INTERFACE}.csv.
Where {ID} is a chain id of the tokens and {INTERFACE} is the tokens standard (20, 721, 1155).

Then you have to run the following command, which will do everything automatically:

```bash
$ npm run fetch:list {ID}
```

---

> Beware, if you change hash function, you should re-generate token data

---

You can also specify a custom RPC server for each network separately.
By default, the project stores the network configurations in the [networks.config.json](./networks.config.json) file.

You can find suitable open RPC servers on [https://chainlist.org](https://chainlist.org).
