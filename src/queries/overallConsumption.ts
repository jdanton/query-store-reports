import * as sql from 'mssql';

export interface OverallConsumptionParams {
  intervalStartTime: Date;
  intervalEndTime: Date;
  replicaGroupId: number;
}

export interface OverallConsumptionRow {
  total_count_executions: number;
  total_duration: number;
  total_cpu_time: number;
  total_logical_io_reads: number;
  total_logical_io_writes: number;
  total_physical_io_reads: number;
  total_clr_time: number;
  total_dop: number;
  total_query_max_used_memory: number;
  total_rowcount: number;
  total_log_bytes_used: number;
  total_tempdb_space_used: number;
  total_query_wait_time: number;
  bucket_start: Date;
  bucket_end: Date;
}

export async function executeOverallConsumption(
  pool: sql.ConnectionPool,
  params: OverallConsumptionParams,
): Promise<OverallConsumptionRow[]> {
  const request = pool.request();
  request.input('interval_start_time', sql.DateTimeOffset, params.intervalStartTime);
  request.input('interval_end_time', sql.DateTimeOffset, params.intervalEndTime);
  request.input('replica_group_id', sql.BigInt, params.replicaGroupId);

  const querySql = `
WITH DateGenerator AS
(
SELECT CAST(@interval_start_time AS DATETIME) DatePlaceHolder
UNION ALL
SELECT  DATEADD(d, 1, DatePlaceHolder)
FROM    DateGenerator
WHERE   DATEADD(d, 1, DatePlaceHolder) < @interval_end_time
), WaitStats AS
(
SELECT
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2) total_query_wait_time
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > @interval_end_time OR itvl.end_time < @interval_start_time)
    AND ws.replica_group_id = @replica_group_id
GROUP BY DATEDIFF(d, 0, itvl.end_time)
),
UnionAll AS
(
SELECT
    CONVERT(float, SUM(rs.count_executions)) as total_count_executions,
    ROUND(CONVERT(float, SUM(rs.avg_duration*rs.count_executions))*0.001,2) as total_duration,
    ROUND(CONVERT(float, SUM(rs.avg_cpu_time*rs.count_executions))*0.001,2) as total_cpu_time,
    ROUND(CONVERT(float, SUM(rs.avg_logical_io_reads*rs.count_executions))*8,2) as total_logical_io_reads,
    ROUND(CONVERT(float, SUM(rs.avg_logical_io_writes*rs.count_executions))*8,2) as total_logical_io_writes,
    ROUND(CONVERT(float, SUM(rs.avg_physical_io_reads*rs.count_executions))*8,2) as total_physical_io_reads,
    ROUND(CONVERT(float, SUM(rs.avg_clr_time*rs.count_executions))*0.001,2) as total_clr_time,
    ROUND(CONVERT(float, SUM(rs.avg_dop*rs.count_executions))*1,0) as total_dop,
    ROUND(CONVERT(float, SUM(rs.avg_query_max_used_memory*rs.count_executions))*8,2) as total_query_max_used_memory,
    ROUND(CONVERT(float, SUM(rs.avg_rowcount*rs.count_executions))*1,0) as total_rowcount,
    ROUND(CONVERT(float, SUM(rs.avg_log_bytes_used*rs.count_executions))*0.0009765625,2) as total_log_bytes_used,
    ROUND(CONVERT(float, SUM(rs.avg_tempdb_space_used*rs.count_executions))*8,2) as total_tempdb_space_used,
    TODATETIMEOFFSET(DATEADD(d, ((DATEDIFF(d, 0, SWITCHOFFSET(rs.last_execution_time, DATEPART(tz, @interval_start_time))))), 0), DATEPART(tz, @interval_start_time)) as bucket_start,
    TODATETIMEOFFSET(DATEADD(d, (1 + (DATEDIFF(d, 0, SWITCHOFFSET(rs.last_execution_time, DATEPART(tz, @interval_start_time))))), 0), DATEPART(tz, @interval_start_time)) as bucket_end
FROM sys.query_store_runtime_stats rs
WHERE
    NOT (rs.first_execution_time > @interval_end_time OR rs.last_execution_time < @interval_start_time)
    AND rs.replica_group_id = @replica_group_id
GROUP BY DATEDIFF(d, 0, SWITCHOFFSET(rs.last_execution_time, DATEPART(tz, @interval_start_time)))
)
SELECT
    total_count_executions,
    total_duration,
    total_cpu_time,
    total_logical_io_reads,
    total_logical_io_writes,
    total_physical_io_reads,
    total_clr_time,
    total_dop,
    total_query_max_used_memory,
    total_rowcount,
    total_log_bytes_used,
    total_tempdb_space_used,
    total_query_wait_time,
    bucket_start,
    bucket_end
FROM
(
SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket_start ORDER BY bucket_start, total_duration DESC) AS RowNumber
FROM UnionAll , WaitStats
) as UnionAllResults
WHERE UnionAllResults.RowNumber = 1
OPTION (MAXRECURSION 0)`;

  const result = await request.query<OverallConsumptionRow>(querySql);
  return result.recordset;
}
