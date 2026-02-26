import * as sql from 'mssql';

export class QueryRunner {
  private pool: sql.ConnectionPool | null = null;
  private connectPromise: Promise<sql.ConnectionPool> | null = null;

  constructor(private config: sql.config) {}

  async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) {
      return this.pool;
    }
    if (this.pool && !this.pool.connected) {
      this.pool.close().catch(() => {});
      this.pool = null;
    }
    if (!this.connectPromise) {
      this.connectPromise = new sql.ConnectionPool(this.config)
        .connect()
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
