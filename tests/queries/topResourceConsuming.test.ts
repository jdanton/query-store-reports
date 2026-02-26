import { describe, it, expect } from 'vitest';
import * as sql from 'mssql';
import { executeTopResourceConsuming, type TopResourceConsumingParams, type TopResourceMetric } from '../../src/queries/topResourceConsuming';
import { createMockPool } from '../helpers/mockSql';

const baseParams: TopResourceConsumingParams = {
  resultsRowCount: 25,
  intervalStartTime: new Date('2026-01-01T00:00:00Z'),
  intervalEndTime: new Date('2026-01-02T00:00:00Z'),
  replicaGroupId: 1,
  metric: 'duration',
  minPlans: 1,
};

describe('executeTopResourceConsuming', () => {
  it('binds all 5 parameters correctly', async () => {
    const { pool, state } = createMockPool();
    await executeTopResourceConsuming(pool, baseParams);

    expect(state.inputs).toHaveLength(5);
    expect(state.inputs).toContainEqual({ name: 'results_row_count', type: sql.Int, value: 25 });
    expect(state.inputs).toContainEqual({ name: 'interval_start_time', type: sql.DateTimeOffset, value: baseParams.intervalStartTime });
    expect(state.inputs).toContainEqual({ name: 'interval_end_time', type: sql.DateTimeOffset, value: baseParams.intervalEndTime });
    expect(state.inputs).toContainEqual({ name: 'replica_group_id', type: sql.BigInt, value: 1 });
    expect(state.inputs).toContainEqual({ name: 'min_plans', type: sql.Int, value: 1 });
  });

  it('throws on invalid metric', async () => {
    const { pool } = createMockPool();
    const params = { ...baseParams, metric: 'bogus' as TopResourceMetric };
    await expect(executeTopResourceConsuming(pool, params)).rejects.toThrow('Invalid metric: bogus');
  });

  it('uses duration metric expression', async () => {
    const { pool, state } = createMockPool();
    await executeTopResourceConsuming(pool, { ...baseParams, metric: 'duration' });
    expect(state.querySql).toContain('avg_duration');
    expect(state.querySql).toContain('0.001');
  });

  it('uses cpu metric expression', async () => {
    const { pool, state } = createMockPool();
    await executeTopResourceConsuming(pool, { ...baseParams, metric: 'cpu' });
    expect(state.querySql).toContain('avg_cpu_time');
  });

  it('uses logicalReads metric expression', async () => {
    const { pool, state } = createMockPool();
    await executeTopResourceConsuming(pool, { ...baseParams, metric: 'logicalReads' });
    expect(state.querySql).toContain('avg_logical_io_reads');
  });

  it('includes HAVING clause with min_plans', async () => {
    const { pool, state } = createMockPool();
    await executeTopResourceConsuming(pool, baseParams);
    expect(state.querySql).toContain('HAVING COUNT(distinct p.plan_id) >= @min_plans');
  });

  it('returns recordset from pool', async () => {
    const mockRows = [{ query_id: 1, metric_value: 100 }];
    const { pool } = createMockPool(mockRows);
    const result = await executeTopResourceConsuming(pool, baseParams);
    expect(result).toEqual(mockRows);
  });
});
