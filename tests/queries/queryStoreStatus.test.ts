import { describe, it, expect } from 'vitest';
import { executeQueryStoreStatus } from '../../src/queries/queryStoreStatus';
import { createMockPool } from '../helpers/mockSql';

describe('executeQueryStoreStatus', () => {
  it('queries sys.database_query_store_options', async () => {
    const { pool, state } = createMockPool();
    await executeQueryStoreStatus(pool);
    expect(state.querySql).toContain('sys.database_query_store_options');
  });

  it('selects actual_state and actual_state_desc', async () => {
    const { pool, state } = createMockPool();
    await executeQueryStoreStatus(pool);
    expect(state.querySql).toContain('actual_state');
    expect(state.querySql).toContain('actual_state_desc');
  });

  it('returns the first row when rows exist', async () => {
    const mockRow = {
      actual_state: 2,
      actual_state_desc: 'READ_WRITE',
      desired_state: 2,
      desired_state_desc: 'READ_WRITE',
      readonly_reason: 0,
    };
    const { pool } = createMockPool([mockRow]);
    const result = await executeQueryStoreStatus(pool);
    expect(result).toEqual(mockRow);
  });

  it('returns undefined when no rows exist', async () => {
    const { pool } = createMockPool([]);
    const result = await executeQueryStoreStatus(pool);
    expect(result).toBeUndefined();
  });

  it('requires no input parameters', async () => {
    const { pool, state } = createMockPool();
    await executeQueryStoreStatus(pool);
    expect(state.inputs).toHaveLength(0);
  });
});
