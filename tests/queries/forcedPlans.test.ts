import { describe, it, expect } from 'vitest';
import * as sql from 'mssql';
import { executeForcedPlans, type ForcedPlansParams } from '../../src/queries/forcedPlans';
import { createMockPool } from '../helpers/mockSql';

const baseParams: ForcedPlansParams = {
  replicaGroupId: 1,
};

describe('executeForcedPlans', () => {
  it('binds replica_group_id parameter', async () => {
    const { pool, state } = createMockPool();
    await executeForcedPlans(pool, baseParams);

    expect(state.inputs).toHaveLength(1);
    expect(state.inputs).toContainEqual({ name: 'replica_group_id', type: sql.BigInt, value: 1 });
  });

  it('filters for forced plans', async () => {
    const { pool, state } = createMockPool();
    await executeForcedPlans(pool, baseParams);
    expect(state.querySql).toContain('is_forced_plan = 1');
  });

  it('orders by force_failure_count DESC', async () => {
    const { pool, state } = createMockPool();
    await executeForcedPlans(pool, baseParams);
    expect(state.querySql).toContain('ORDER BY force_failure_count DESC');
  });

  it('returns recordset from pool', async () => {
    const mockRows = [{ query_id: 10, plan_id: 20 }];
    const { pool } = createMockPool(mockRows);
    const result = await executeForcedPlans(pool, baseParams);
    expect(result).toEqual(mockRows);
  });
});
