import { describe, it, expect } from 'vitest';
import * as sql from 'mssql';
import { executeQueryPlan, type QueryPlanParams } from '../../src/queries/queryPlan';
import { createMockPool } from '../helpers/mockSql';

const baseParams: QueryPlanParams = {
  queryId: 42,
  planId: 71,
};

describe('executeQueryPlan', () => {
  it('binds both parameters correctly', async () => {
    const { pool, state } = createMockPool();
    await executeQueryPlan(pool, baseParams);

    expect(state.inputs).toHaveLength(2);
    expect(state.inputs).toContainEqual({ name: 'query_id', type: sql.BigInt, value: 42 });
    expect(state.inputs).toContainEqual({ name: 'plan_id', type: sql.BigInt, value: 71 });
  });

  it('queries sys.query_store_plan', async () => {
    const { pool, state } = createMockPool();
    await executeQueryPlan(pool, baseParams);
    expect(state.querySql).toContain('sys.query_store_plan');
  });

  it('selects is_forced_plan and query_plan', async () => {
    const { pool, state } = createMockPool();
    await executeQueryPlan(pool, baseParams);
    expect(state.querySql).toContain('p.is_forced_plan');
    expect(state.querySql).toContain('p.query_plan');
  });

  it('returns recordset from pool', async () => {
    const mockRows = [{ is_forced_plan: false, query_plan: '<xml/>' }];
    const { pool } = createMockPool(mockRows);
    const result = await executeQueryPlan(pool, baseParams);
    expect(result).toEqual(mockRows);
  });
});
