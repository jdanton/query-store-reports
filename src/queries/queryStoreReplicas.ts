import * as sql from 'mssql';

export interface QueryStoreReplicaRow {
  replica_group_id: number;
  role_type: number;
  replica_name: string;
}

const DEFAULT_REPLICAS: QueryStoreReplicaRow[] = [
  { replica_group_id: 1, role_type: 1, replica_name: 'Primary' },
];

/**
 * Fetch available Query Store replicas from sys.query_store_replicas.
 * This DMV exists on SQL Server 2022+ with Always On / Azure SQL Hyperscale.
 * On older versions the query will fail — we catch the error and return
 * a single-element default representing the primary replica.
 */
export async function executeQueryStoreReplicas(
  pool: sql.ConnectionPool,
): Promise<QueryStoreReplicaRow[]> {
  try {
    const request = pool.request();

    const querySql = `
SELECT
    replica_group_id,
    role_type,
    replica_name
FROM sys.query_store_replicas
ORDER BY replica_group_id`;

    const result = await request.query<QueryStoreReplicaRow>(querySql);
    return result.recordset.length > 0 ? result.recordset : DEFAULT_REPLICAS;
  } catch (err) {
    // Expected on SQL Server < 2022 where sys.query_store_replicas doesn't exist.
    // Log for debugging in case the failure is unexpected.
    console.warn('[QueryStoreReplicas] Falling back to default replicas:', err instanceof Error ? err.message : err);
    return DEFAULT_REPLICAS;
  }
}
