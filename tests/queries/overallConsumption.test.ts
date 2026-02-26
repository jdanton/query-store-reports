import { describe, it, expect } from 'vitest';
import * as sql from 'mssql';
import { executeOverallConsumption, type OverallConsumptionParams } from '../../src/queries/overallConsumption';
import { createMockPool } from '../helpers/mockSql';

const baseParams: OverallConsumptionParams = {
  intervalStartTime: new Date('2026-01-01T00:00:00Z'),
  intervalEndTime: new Date('2026-01-31T00:00:00Z'),
  replicaGroupId: 1,
};

describe('executeOverallConsumption', () => {
  it('binds all 3 parameters correctly', async () => {
    const { pool, state } = createMockPool();
    await executeOverallConsumption(pool, baseParams);

    expect(state.inputs).toHaveLength(3);
    expect(state.inputs).toContainEqual({ name: 'interval_start_time', type: sql.DateTimeOffset, value: baseParams.intervalStartTime });
    expect(state.inputs).toContainEqual({ name: 'interval_end_time', type: sql.DateTimeOffset, value: baseParams.intervalEndTime });
    expect(state.inputs).toContainEqual({ name: 'replica_group_id', type: sql.BigInt, value: 1 });
  });

  it('uses DateGenerator recursive CTE', async () => {
    const { pool, state } = createMockPool();
    await executeOverallConsumption(pool, baseParams);
    expect(state.querySql).toContain('DateGenerator');
  });

  it('sets MAXRECURSION 0', async () => {
    const { pool, state } = createMockPool();
    await executeOverallConsumption(pool, baseParams);
    expect(state.querySql).toContain('OPTION (MAXRECURSION 0)');
  });

  it('returns recordset from pool', async () => {
    const mockRows = [{ bucket_start: new Date(), total_duration: 1000 }];
    const { pool } = createMockPool(mockRows);
    const result = await executeOverallConsumption(pool, baseParams);
    expect(result).toEqual(mockRows);
  });
});
