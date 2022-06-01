# Token Impersonation Agent

## Description

This agent scans the creation of new contacts and alerts if it detects the creation of a token with an existing symbol or name.
For example, the agent will detect when an attacker creates a copy of an existing APE token (ApeCoin), 
which will be used for subsequent scams.
The key to determining whether a token is an impersonator is the token symbol, 
but if it is not implemented, the name is used.

Depending on the [Trace API](https://openethereum.github.io/JSONRPC-trace-module) support, 
the agent chooses a token detection strategy. 
If the network supports the API, then the agent looks for created contacts through traces;
if it does not, it searches for logs related to token events and if it finds an event of an unknown contract, it checks it.

## Supported Token Interfaces

- ERC20
- ERC721
- ERC1155

## Supported Chains

- Mainnet (1)
- Polygon (137)
- BSC (56)
- Avalanche (41114)
- Arbitrum (42161)
- Optimism (10)
- Fantom (250)

## Token Data

Token data is located in the [data](./data) folder.
Each chain uses its own file. 
For example, for the `Mainnet`, the file will be called `chain-1.csv`, since 1 is the id of that network.

## Data Generator

The project also contains a script that allows to generate and update token data in automatic mode. 
To do this, run `npm run fetch` command, passing the id of the desired network.
For instance, this command will start scanning the blocks of the last 28 days on the Polygon network:

```shell script
$ npm run fetch 137
```
 
All tokens found will be written to the `chain-137.csv` file. Also, a state file `chain-137.fetcher.json` will be created, 
which will contain the scanned range of blocks, and which can be used by the script for optimizations in subsequent runs.

You can also specify a custom RPC server for each network separately. 
By default, the project stores the network configurations in the [networks.config.json](./networks.config.json) file.

You can find suitable open RPC servers on [https://chainlist.org](https://chainlist.org).

## Alerts

- IMPERSONATED-TOKEN-DEPLOYMENT
  - Fired when someone deployed an impersonating token with a similar symbol or name
  - Severity is always set to "medium"
  - Type is always set to "suspicious"
  - Used for networks that support Parity/OpenEthereum Trace API

- IMPERSONATED-TOKEN-FINDING
  - Fired when an impersonating token with a similar symbol or name found in a transaction logs
  - Severity is always set to "low"
  - Type is always set to "suspicious"
  - Used for networks that do not support Parity/OpenEthereum Trace API

## Test Data

#### Ethereum Mainnet (Chain 1)

Alert `IMPERSONATED-TOKEN-DEPLOYMENT` for "Heaven" token:

```bash
$ npm run tx 0x8fd54cef7805bc3921030e5d33c2565920340ec11566f17fc87aece108cea6cf
```
