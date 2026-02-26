import * as sql from 'mssql';

export interface HighVariationParams {
  resultsRowCount: number;
  intervalStartTime: Date;
  intervalEndTime: Date;
  replicaGroupId: number;
}

export interface HighVariationRow {
  query_id: number;
  object_id: number;
  object_name: string;
  query_sql_text: string;
  stdev_duration: number;
  avg_duration: number;
  variation_duration: number;
  count_executions: number;
  num_plans: number;
}

export async function executeHighVariation(
  pool: sql.ConnectionPool,
  params: HighVariationParams,
): Promise<HighVariationRow[]> {
  const request = pool.request();
  request.input('results_row_count', sql.Int, params.resultsRowCount);
  request.input('interval_start_time', sql.DateTimeOffset, params.intervalStartTime);
  request.input('interval_end_time', sql.DateTimeOffset, params.intervalEndTime);
  request.input('replica_group_id', sql.BigInt, params.replicaGroupId);

  const querySql = `
SELECT TOP (@results_row_count)
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    qt.query_sql_text query_sql_text,
    ROUND(CONVERT(float, SQRT( SUM(rs.stdev_duration*rs.stdev_duration*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) stdev_duration,
    ROUND(CONVERT(float, SUM(rs.avg_duration*rs.count_executions))/NULLIF(SUM(rs.count_executions), 0)*0.001,2) avg_duration,
    ISNULL(ROUND(CONVERT(float, (SQRT( SUM(rs.stdev_duration*rs.stdev_duration*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0))*SUM(rs.count_executions)) / NULLIF(SUM(rs.avg_duration*rs.count_executions), 0)),2), 0) variation_duration,
    SUM(rs.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_runtime_stats rs
    JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    NOT (rs.first_execution_time > @interval_end_time OR rs.last_execution_time < @interval_start_time)
    AND rs.replica_group_id = @replica_group_id
GROUP BY p.query_id, qt.query_sql_text, q.object_id
HAVING COUNT(distinct p.plan_id) >= 1 AND SUM(rs.count_executions) > 1
ORDER BY variation_duration DESC`;

  const result = await request.query<HighVariationRow>(querySql);
  return result.recordset;
}
