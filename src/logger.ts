const ENABLED = process.env.DEBUG === '1';

export class Logger {
  static enabled: boolean = ENABLED;

  static log(...args: any[]) {
    if (!Logger.enabled) return;
    console.log(...args);
  }

  static error(...args: any[]) {
    if (!Logger.enabled) return;
    console.error(...args);
  }
}
