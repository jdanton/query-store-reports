import * as sql from 'mssql';

export interface QueryStoreStatusRow {
  actual_state: number;
  actual_state_desc: string;
  desired_state: number;
  desired_state_desc: string;
  readonly_reason: number;
}

/**
 * Check whether Query Store is enabled on the current database.
 * Returns the status row, or undefined if the view returns no rows
 * (which can happen if Query Store was never configured).
 */
export async function executeQueryStoreStatus(
  pool: sql.ConnectionPool,
): Promise<QueryStoreStatusRow | undefined> {
  const request = pool.request();

  const querySql = `
SELECT
    actual_state,
    actual_state_desc,
    desired_state,
    desired_state_desc,
    readonly_reason
FROM sys.database_query_store_options`;

  const result = await request.query<QueryStoreStatusRow>(querySql);
  return result.recordset.length > 0 ? result.recordset[0] : undefined;
}
