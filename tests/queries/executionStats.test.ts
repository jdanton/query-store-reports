import { describe, it, expect } from 'vitest';
import * as sql from 'mssql';
import { executeExecutionStats, type ExecutionStatsParams } from '../../src/queries/executionStats';
import { createMockPool } from '../helpers/mockSql';

const baseParams: ExecutionStatsParams = {
  queryId: 42,
  replicaGroupId: 1,
  intervalStartTime: new Date('2026-01-01T00:00:00Z'),
  intervalEndTime: new Date('2026-01-02T00:00:00Z'),
};

describe('executeExecutionStats', () => {
  it('binds all 4 parameters correctly', async () => {
    const { pool, state } = createMockPool();
    await executeExecutionStats(pool, baseParams);

    expect(state.inputs).toHaveLength(4);
    expect(state.inputs).toContainEqual({ name: 'query_id', type: sql.BigInt, value: 42 });
    expect(state.inputs).toContainEqual({ name: 'replica_group_id', type: sql.BigInt, value: 1 });
    expect(state.inputs).toContainEqual({ name: 'interval_start_time', type: sql.DateTimeOffset, value: baseParams.intervalStartTime });
    expect(state.inputs).toContainEqual({ name: 'interval_end_time', type: sql.DateTimeOffset, value: baseParams.intervalEndTime });
  });

  it('buckets by minute', async () => {
    const { pool, state } = createMockPool();
    await executeExecutionStats(pool, baseParams);
    expect(state.querySql).toContain('DATEDIFF(mi, 0,');
  });

  it('filters by query_id', async () => {
    const { pool, state } = createMockPool();
    await executeExecutionStats(pool, baseParams);
    expect(state.querySql).toContain('@query_id');
  });

  it('returns recordset from pool', async () => {
    const mockRows = [{ plan_id: 71, avg_duration: 12.5 }];
    const { pool } = createMockPool(mockRows);
    const result = await executeExecutionStats(pool, baseParams);
    expect(result).toEqual(mockRows);
  });
});
