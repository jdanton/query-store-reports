import { describe, it, expect } from 'vitest';
import * as sql from 'mssql';
import { executeRegressedQueries, type RegressedQueriesParams } from '../../src/queries/regressedQueries';
import { createMockPool } from '../helpers/mockSql';

const baseParams: RegressedQueriesParams = {
  resultsRowCount: 25,
  recentStartTime: new Date('2026-01-02T00:00:00Z'),
  recentEndTime: new Date('2026-01-02T01:00:00Z'),
  historyStartTime: new Date('2025-12-26T00:00:00Z'),
  historyEndTime: new Date('2026-01-02T01:00:00Z'),
  minExecCount: 5,
  replicaGroupId: 1,
};

describe('executeRegressedQueries', () => {
  it('binds all 7 parameters correctly', async () => {
    const { pool, state } = createMockPool();
    await executeRegressedQueries(pool, baseParams);

    expect(state.inputs).toHaveLength(7);
    expect(state.inputs).toContainEqual({ name: 'results_row_count', type: sql.Int, value: 25 });
    expect(state.inputs).toContainEqual({ name: 'recent_start_time', type: sql.DateTimeOffset, value: baseParams.recentStartTime });
    expect(state.inputs).toContainEqual({ name: 'recent_end_time', type: sql.DateTimeOffset, value: baseParams.recentEndTime });
    expect(state.inputs).toContainEqual({ name: 'history_start_time', type: sql.DateTimeOffset, value: baseParams.historyStartTime });
    expect(state.inputs).toContainEqual({ name: 'history_end_time', type: sql.DateTimeOffset, value: baseParams.historyEndTime });
    expect(state.inputs).toContainEqual({ name: 'min_exec_count', type: sql.BigInt, value: 5 });
    expect(state.inputs).toContainEqual({ name: 'replica_group_id', type: sql.BigInt, value: 1 });
  });

  it('uses CTE structure with hist and recent', async () => {
    const { pool, state } = createMockPool();
    await executeRegressedQueries(pool, baseParams);
    expect(state.querySql).toContain('WITH');
    expect(state.querySql).toContain('hist AS');
    expect(state.querySql).toContain('recent AS');
  });

  it('includes min_exec_count filter', async () => {
    const { pool, state } = createMockPool();
    await executeRegressedQueries(pool, baseParams);
    expect(state.querySql).toContain('@min_exec_count');
  });

  it('returns recordset from pool', async () => {
    const mockRows = [{ query_id: 42 }];
    const { pool } = createMockPool(mockRows);
    const result = await executeRegressedQueries(pool, baseParams);
    expect(result).toEqual(mockRows);
  });
});
