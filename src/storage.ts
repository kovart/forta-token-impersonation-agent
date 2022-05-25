import fs from 'fs';
import path from 'path';
import { format } from '@fast-csv/format';
import { parse } from '@fast-csv/parse';
import { Token } from './types';

export type CsvRow = Token & {
  address: string;
  legit: boolean;
};

export type StorageState = {
  fromBlock: number;
  toBlock: number;
};

export class TokenStorage {
  public readonly dist: string;
  public readonly dataFileFullPath: string;
  public readonly stateFileFullPath: string;

  constructor(dist: string, public readonly name: string) {
    this.dist = path.resolve(__dirname, dist);
    this.dataFileFullPath = path.resolve(__dirname, dist, name + '.csv');
    this.stateFileFullPath = path.resolve(__dirname, dist, name + '.fetcher.json');
  }

  private async mkdir() {
    try {
      await fs.promises.mkdir(this.dist, { recursive: true });
    } catch {}
  }

  public async exists(filePath: string = this.dataFileFullPath) {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  public async read(): Promise<CsvRow[]> {
    return new Promise((res, rej) => {
      const tokens: CsvRow[] = [];

      const readStream = fs.createReadStream(this.dataFileFullPath, { encoding: 'utf-8' });
      const csvStream = parse({ headers: true })
        .on('data', (row) => {
          tokens.push({
            address: row.address,
            name: row.name,
            type: Number(row.type),
            legit: Number(row.legit) === 1,
          });
        })
        .on('end', () => res(tokens))
        .on('error', rej);

      readStream.pipe(csvStream);
    });
  }

  public async append(row: CsvRow) {
    return new Promise(async (res, rej) => {
      await this.mkdir();

      const fileExists = await this.exists();

      const writeStream = fs.createWriteStream(this.dataFileFullPath, {
        encoding: 'utf-8',
        flags: 'a',
      });
      const csvStream = format({ headers: !fileExists, includeEndRowDelimiter: true });
      csvStream.pipe(writeStream);

      csvStream.write({
        type: row.type,
        address: row.address,
        name: row.name,
        legit: row.legit ? 1 : 0,
      });

      writeStream.on('finish', res);
      writeStream.on('error', rej);

      csvStream.end();
    });
  }

  public async readState(): Promise<StorageState | null> {
    if (await this.exists(this.stateFileFullPath)) {
      const stateStr = await fs.promises.readFile(this.stateFileFullPath, { encoding: 'utf-8' });
      return JSON.parse(stateStr);
    }

    return null;
  }

  public async writeState(state: StorageState) {
    await this.mkdir();
    await fs.promises.writeFile(this.stateFileFullPath, JSON.stringify(state), {
      encoding: 'utf-8',
    });
  }
}
