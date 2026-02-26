import * as sql from 'mssql';

export type TopResourceMetric =
  | 'duration'
  | 'cpu'
  | 'logicalReads'
  | 'logicalWrites'
  | 'physicalReads'
  | 'memory'
  | 'rowcount';

export const METRIC_LABELS: Record<TopResourceMetric, string> = {
  duration:      'Duration (ms)',
  cpu:           'CPU Time (ms)',
  logicalReads:  'Logical IO Reads (KB)',
  logicalWrites: 'Logical IO Writes (KB)',
  physicalReads: 'Physical IO Reads (KB)',
  memory:        'Memory (KB)',
  rowcount:      'Row Count',
};

export interface TopResourceConsumingParams {
  resultsRowCount: number;
  intervalStartTime: Date;
  intervalEndTime: Date;
  replicaGroupId: number;
  metric: TopResourceMetric;
  minPlans: number;
}

export interface TopResourceConsumingRow {
  query_id: number;
  object_id: number;
  object_name: string;
  query_sql_text: string;
  metric_value: number;
  total_duration: number;
  count_executions: number;
  num_plans: number;
}

const METRIC_EXPR: Record<TopResourceMetric, string> = {
  duration:      'ROUND(CONVERT(float, SUM(rs.avg_duration*rs.count_executions))*0.001,2)',
  cpu:           'ROUND(CONVERT(float, SUM(rs.avg_cpu_time*rs.count_executions))*0.001,2)',
  logicalReads:  'ROUND(CONVERT(float, SUM(rs.avg_logical_io_reads*rs.count_executions))*8,2)',
  logicalWrites: 'ROUND(CONVERT(float, SUM(rs.avg_logical_io_writes*rs.count_executions))*8,2)',
  physicalReads: 'ROUND(CONVERT(float, SUM(rs.avg_physical_io_reads*rs.count_executions))*8,2)',
  memory:        'ROUND(CONVERT(float, SUM(rs.avg_query_max_used_memory*rs.count_executions))*8,2)',
  rowcount:      'ROUND(CONVERT(float, SUM(rs.avg_rowcount*rs.count_executions))*1,0)',
};

export async function executeTopResourceConsuming(
  pool: sql.ConnectionPool,
  params: TopResourceConsumingParams,
): Promise<TopResourceConsumingRow[]> {
  const request = pool.request();
  request.input('results_row_count', sql.Int, params.resultsRowCount);
  request.input('interval_start_time', sql.DateTimeOffset, params.intervalStartTime);
  request.input('interval_end_time', sql.DateTimeOffset, params.intervalEndTime);
  request.input('replica_group_id', sql.BigInt, params.replicaGroupId);
  request.input('min_plans', sql.Int, params.minPlans);

  const metricExpr = METRIC_EXPR[params.metric];
  const querySql = `
SELECT TOP (@results_row_count)
    p.query_id,
    q.object_id,
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
    qt.query_sql_text,
    ${metricExpr} metric_value,
    ROUND(CONVERT(float, SUM(rs.avg_duration*rs.count_executions))*0.001,2) total_duration,
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
HAVING COUNT(distinct p.plan_id) >= @min_plans
ORDER BY metric_value DESC`;

  const result = await request.query<TopResourceConsumingRow>(querySql);
  return result.recordset;
}
