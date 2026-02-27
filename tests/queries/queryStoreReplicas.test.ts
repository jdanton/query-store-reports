import { describe, it, expect } from 'vitest';
import { executeQueryStoreReplicas } from '../../src/queries/queryStoreReplicas';
import { createMockPool } from '../helpers/mockSql';

const DEFAULT_PRIMARY = [{ replica_group_id: 1, role_type: 1, replica_name: 'Primary' }];

describe('executeQueryStoreReplicas', () => {
  it('queries sys.query_store_replicas', async () => {
    const { pool, state } = createMockPool();
    await executeQueryStoreReplicas(pool);
    expect(state.querySql).toContain('sys.query_store_replicas');
  });

  it('selects replica_group_id, role_type, and replica_name', async () => {
    const { pool, state } = createMockPool();
    await executeQueryStoreReplicas(pool);
    expect(state.querySql).toContain('replica_group_id');
    expect(state.querySql).toContain('role_type');
    expect(state.querySql).toContain('replica_name');
  });

  it('returns recordset when rows exist', async () => {
    const mockRows = [
      { replica_group_id: 1, role_type: 1, replica_name: 'Primary' },
      { replica_group_id: 2, role_type: 2, replica_name: 'HA Secondary' },
    ];
    const { pool } = createMockPool(mockRows);
    const result = await executeQueryStoreReplicas(pool);
    expect(result).toEqual(mockRows);
  });

  it('returns default primary when recordset is empty', async () => {
    const { pool } = createMockPool([]);
    const result = await executeQueryStoreReplicas(pool);
    expect(result).toEqual(DEFAULT_PRIMARY);
  });

  it('returns default primary when query throws', async () => {
    const { pool, mockRequest } = createMockPool();
    mockRequest.query.mockRejectedValueOnce(new Error("Invalid object name 'sys.query_store_replicas'"));
    const result = await executeQueryStoreReplicas(pool);
    expect(result).toEqual(DEFAULT_PRIMARY);
  });

  it('requires no input parameters', async () => {
    const { pool, state } = createMockPool();
    await executeQueryStoreReplicas(pool);
    expect(state.inputs).toHaveLength(0);
  });

  it('orders by replica_group_id', async () => {
    const { pool, state } = createMockPool();
    await executeQueryStoreReplicas(pool);
    expect(state.querySql).toContain('ORDER BY replica_group_id');
  });
});
