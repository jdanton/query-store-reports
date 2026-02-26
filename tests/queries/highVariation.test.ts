import { describe, it, expect } from 'vitest';
import * as sql from 'mssql';
import { executeHighVariation, type HighVariationParams } from '../../src/queries/highVariation';
import { createMockPool } from '../helpers/mockSql';

const baseParams: HighVariationParams = {
  resultsRowCount: 25,
  intervalStartTime: new Date('2026-01-01T00:00:00Z'),
  intervalEndTime: new Date('2026-01-02T00:00:00Z'),
  replicaGroupId: 1,
};

describe('executeHighVariation', () => {
  it('binds all 4 parameters correctly', async () => {
    const { pool, state } = createMockPool();
    await executeHighVariation(pool, baseParams);

    expect(state.inputs).toHaveLength(4);
    expect(state.inputs).toContainEqual({ name: 'results_row_count', type: sql.Int, value: 25 });
    expect(state.inputs).toContainEqual({ name: 'interval_start_time', type: sql.DateTimeOffset, value: baseParams.intervalStartTime });
    expect(state.inputs).toContainEqual({ name: 'interval_end_time', type: sql.DateTimeOffset, value: baseParams.intervalEndTime });
    expect(state.inputs).toContainEqual({ name: 'replica_group_id', type: sql.BigInt, value: 1 });
  });

  it('orders by variation_duration DESC', async () => {
    const { pool, state } = createMockPool();
    await executeHighVariation(pool, baseParams);
    expect(state.querySql).toContain('ORDER BY variation_duration DESC');
  });

  it('requires multiple executions', async () => {
    const { pool, state } = createMockPool();
    await executeHighVariation(pool, baseParams);
    expect(state.querySql).toContain('SUM(rs.count_executions) > 1');
  });

  it('returns recordset from pool', async () => {
    const mockRows = [{ query_id: 7, variation_duration: 3.5 }];
    const { pool } = createMockPool(mockRows);
    const result = await executeHighVariation(pool, baseParams);
    expect(result).toEqual(mockRows);
  });
});
