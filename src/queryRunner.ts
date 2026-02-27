import * as sql from 'mssql';

export type ConfigFactory = () => Promise<sql.config>;

export class QueryRunner {
  private pool: sql.ConnectionPool | null = null;
  private connectPromise: Promise<sql.ConnectionPool> | null = null;

  constructor(private configFactory: ConfigFactory) {}

  /** Replace the config factory (e.g. when a fresh token is available). */
  updateConfigFactory(factory: ConfigFactory): void {
    this.configFactory = factory;
  }

  /** Force the pool to close so the next getPool() reconnects with a fresh config. */
  async resetPool(): Promise<void> {
    this.connectPromise = null;
    if (this.pool) {
      await this.pool.close().catch(() => {});
      this.pool = null;
    }
  }

  async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) {
      return this.pool;
    }
    if (this.pool && !this.pool.connected) {
      this.pool.close().catch(() => {});
      this.pool = null;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.configFactory()
        .then((config) => new sql.ConnectionPool(config).connect())
        .then((p) => {
          this.pool = p;
          this.connectPromise = null;
          return p;
        })
        .catch((err) => {
          this.connectPromise = null;
          throw err;
        });
    }
    return this.connectPromise;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }
}
