import { describe, it, expect } from 'vitest';
import * as sql from 'mssql';
import { executeWaitStats, type WaitStatsParams } from '../../src/queries/waitStats';
import { createMockPool } from '../helpers/mockSql';

const baseParams: WaitStatsParams = {
  resultsRowCount: 10,
  intervalStartTime: new Date('2026-01-01T00:00:00Z'),
  intervalEndTime: new Date('2026-01-02T00:00:00Z'),
  replicaGroupId: 1,
};

describe('executeWaitStats', () => {
  it('binds all 4 parameters correctly', async () => {
    const { pool, state } = createMockPool();
    await executeWaitStats(pool, baseParams);

    expect(state.inputs).toHaveLength(4);
    expect(state.inputs).toContainEqual({ name: 'interval_start_time', type: sql.DateTimeOffset, value: baseParams.intervalStartTime });
    expect(state.inputs).toContainEqual({ name: 'interval_end_time', type: sql.DateTimeOffset, value: baseParams.intervalEndTime });
    expect(state.inputs).toContainEqual({ name: 'results_row_count', type: sql.Int, value: 10 });
    expect(state.inputs).toContainEqual({ name: 'replica_group_id', type: sql.BigInt, value: 1 });
  });

  it('queries sys.query_store_wait_stats', async () => {
    const { pool, state } = createMockPool();
    await executeWaitStats(pool, baseParams);
    expect(state.querySql).toContain('sys.query_store_wait_stats');
  });

  it('returns recordset from pool', async () => {
    const mockRows = [{ wait_category_desc: 'CPU', total_query_wait_time: 500 }];
    const { pool } = createMockPool(mockRows);
    const result = await executeWaitStats(pool, baseParams);
    expect(result).toEqual(mockRows);
  });
});
