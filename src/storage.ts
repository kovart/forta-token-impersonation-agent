/* eslint-disable no-async-promise-executor */
import fs from 'fs';
import path from 'path';
import { format, writeToPath } from '@fast-csv/format';
import { parse } from '@fast-csv/parse';
import { Token } from './types';

type Stringify<T> = {
  [key in keyof T]: string;
};

export type StorageState = {
  fromBlock: number;
  toBlock: number;
};

export class BaseStorage<R, W = R> {
  public readonly filePath: string;
  public readonly ext = '.csv';

  constructor(
    public readonly distPath: string,
    public readonly fileName: string,
    protected readonly onRead: (row: Stringify<W>) => R,
    protected readonly onWrite: (row: R) => W,
  ) {
    this.filePath = path.resolve(distPath, fileName + this.ext);
  }

  public read(): Promise<R[]> {
    return new Promise((res, rej) => {
      const data: R[] = [];

      const readStream = fs.createReadStream(this.filePath, { encoding: 'utf-8' });
      const csvStream = parse({ headers: true })
        .on('data', (row) => {
          data.push(this.onRead(row));
        })
        .on('end', () => res(data))
        .on('error', rej);

      readStream.pipe(csvStream);
    });
  }

  public async append(row: R | R[]): Promise<void> {
    const rows = Array.isArray(row) ? row : [row];

    return new Promise(async (res, rej) => {
      await this.mkdir();

      const fileExists = await this.exists();

      const writeStream = fs.createWriteStream(this.filePath, {
        encoding: 'utf-8',
        flags: 'a',
      });
      const csvStream = format({ headers: !fileExists, includeEndRowDelimiter: true });
      csvStream.pipe(writeStream);

      rows.forEach((row) => csvStream.write(this.onWrite(row)));

      writeStream.on('finish', res);
      writeStream.on('error', rej);

      csvStream.end();
    });
  }

  public async stream(
    fn: (params: { append: (row: R) => void; end: () => void }) => void,
  ): Promise<void> {
    return new Promise(async (res, rej) => {
      await this.mkdir();

      const fileExists = await this.exists();

      const writeStream = fs.createWriteStream(this.filePath, {
        encoding: 'utf-8',
        flags: 'a',
      });

      const csvStream = format({ headers: !fileExists, includeEndRowDelimiter: true });
      csvStream.pipe(writeStream);

      writeStream.on('finish', res);
      writeStream.on('error', rej);

      fn({ append: (row) => csvStream.write(this.onWrite(row)), end: () => csvStream.end() });
    });
  }

  public async write(rows: R[]): Promise<void> {
    return new Promise(async (res, rej) => {
      await this.mkdir();

      if (await this.exists()) {
        await this.delete();
      }

      const writeStream = writeToPath(this.filePath, rows, {
        headers: true,
        includeEndRowDelimiter: true,
        transform: this.onWrite,
      });

      writeStream.on('finish', res);
      writeStream.on('error', rej);
    });
  }

  protected async mkdir() {
    try {
      await fs.promises.mkdir(this.distPath, { recursive: true });
    } catch {}
  }

  public async delete() {
    try {
      await fs.promises.rm(this.filePath);
    } catch {}
  }

  public async exists(filePath: string = this.filePath) {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export class TokenStorage extends BaseStorage<Token, Token> {
  public readonly stateFileFullPath: string;

  constructor(distPath: string, fileName: string) {
    super(
      distPath,
      fileName,
      (row: any) => ({
        type: Number(row.type),
        name: row.name || null,
        symbol: row.symbol || null,
        address: row.address,
        deployer: row.deployer,
      }),
      // here we declare csv column order
      (row) => ({
        type: row.type,
        name: row.name,
        symbol: row.symbol,
        address: row.address,
        deployer: row.deployer,
      }),
    );
    this.stateFileFullPath = path.resolve(distPath, fileName, '.auto-fetcher.json');
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
