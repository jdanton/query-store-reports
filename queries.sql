exec sp_executesql N'WITH 
hist AS
(
SELECT
    p.query_id query_id,
    ROUND(CONVERT(float, SUM(rs.avg_duration*rs.count_executions))*0.001,2) total_duration,
    SUM(rs.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_runtime_stats rs
    JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
WHERE
    NOT (rs.first_execution_time > @history_end_time OR rs.last_execution_time < @history_start_time)
    AND rs.replica_group_id = @replica_group_id
GROUP BY p.query_id
),
recent AS
(
SELECT
    p.query_id query_id,
    ROUND(CONVERT(float, SUM(rs.avg_duration*rs.count_executions))*0.001,2) total_duration,
    SUM(rs.count_executions) count_executions,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_runtime_stats rs
    JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
WHERE
    NOT (rs.first_execution_time > @recent_end_time OR rs.last_execution_time < @recent_start_time)
    AND rs.replica_group_id = @replica_group_id
GROUP BY p.query_id
)
SELECT TOP (@results_row_count)
    results.query_id query_id,
    results.object_id object_id,
    ISNULL(OBJECT_NAME(results.object_id),'''') object_name,
    results.query_sql_text query_sql_text,
    results.additional_duration_workload additional_duration_workload,
    results.total_duration_recent total_duration_recent,
    results.total_duration_hist total_duration_hist,
    ISNULL(results.count_executions_recent, 0) count_executions_recent,
    ISNULL(results.count_executions_hist, 0) count_executions_hist,
    queries.num_plans num_plans
FROM
(
SELECT
    hist.query_id query_id,
    q.object_id object_id,
    qt.query_sql_text query_sql_text,
    ROUND(CONVERT(float, recent.total_duration/recent.count_executions-hist.total_duration/hist.count_executions)*(recent.count_executions), 2) additional_duration_workload,
    ROUND(recent.total_duration, 2) total_duration_recent,
    ROUND(hist.total_duration, 2) total_duration_hist,
    recent.count_executions count_executions_recent,
    hist.count_executions count_executions_hist
FROM hist
    JOIN recent ON hist.query_id = recent.query_id
    JOIN sys.query_store_query q ON q.query_id = hist.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE
    recent.count_executions >= @min_exec_count
) AS results
JOIN
(
SELECT
    p.query_id query_id,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_plan p
GROUP BY p.query_id
HAVING COUNT(distinct p.plan_id) >= 1
) AS queries ON queries.query_id = results.query_id
WHERE additional_duration_workload > 0
ORDER BY additional_duration_workload DESC
OPTION (MERGE JOIN)',N'@results_row_count int,@recent_start_time datetimeoffset(7),@recent_end_time datetimeoffset(7),@history_start_time datetimeoffset(7),@history_end_time datetimeoffset(7),@min_exec_count bigint,@replica_group_id bigint',@results_row_count=25,@recent_start_time='2026-02-26 07:56:04.6339445 -05:00',@recent_end_time='2026-02-26 08:56:04.6339445 -05:00',@history_start_time='2026-02-19 08:56:04.6339445 -05:00',@history_end_time='2026-02-26 08:56:04.6339445 -05:00',@min_exec_count=1,@replica_group_id=1

exec sp_executesql N'SELECT TOP (@results_row_count)
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'''') object_name,
    qt.query_sql_text query_sql_text,
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
HAVING COUNT(distinct p.plan_id) >= 1
ORDER BY total_duration DESC',N'@results_row_count int,@interval_start_time datetimeoffset(7),@interval_end_time datetimeoffset(7),@replica_group_id bigint',@results_row_count=25,@interval_start_time='2026-02-26 07:56:11.6022642 -05:00',@interval_end_time='2026-02-26 08:56:11.6022642 -05:00',@replica_group_id=1

exec sp_executesql N'WITH 
    bucketizer as 
    (
        SELECT
            rs.plan_id as plan_id,
            rs.execution_type as execution_type,
            SUM(rs.count_executions) count_executions,
            DATEADD(mi, ((DATEDIFF(mi, 0, rs.last_execution_time))),0 ) as bucket_start,
            DATEADD(mi, (1 + (DATEDIFF(mi, 0, rs.last_execution_time))), 0) as bucket_end,
            ROUND(CONVERT(float, SUM(rs.avg_duration*rs.count_executions))/NULLIF(SUM(rs.count_executions), 0)*0.001,2) as avg_duration,
            ROUND(CONVERT(float, MAX(rs.max_duration))*0.001,2) as max_duration,
            ROUND(CONVERT(float, MIN(rs.min_duration))*0.001,2) as min_duration,
            ROUND(CONVERT(float, SQRT( SUM(rs.stdev_duration*rs.stdev_duration*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0)))*0.001,2) as stdev_duration,
            ISNULL(ROUND(CONVERT(float, (SQRT( SUM(rs.stdev_duration*rs.stdev_duration*rs.count_executions)/NULLIF(SUM(rs.count_executions), 0))*SUM(rs.count_executions)) / NULLIF(SUM(rs.avg_duration*rs.count_executions), 0)),2), 0) as variation_duration,
            ROUND(CONVERT(float, SUM(rs.avg_duration*rs.count_executions))*0.001,2) as total_duration
        FROM
            sys.query_store_runtime_stats rs
            JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
        WHERE
            p.query_id = @query_id
        AND NOT (rs.first_execution_time > @interval_end_time OR rs.last_execution_time < @interval_start_time)
            AND rs.replica_group_id = @replica_group_id
        GROUP BY
            rs.plan_id,
            rs.execution_type,
            DATEDIFF(mi, 0, rs.last_execution_time)
    ),
    is_forced as
    (
        SELECT is_forced_plan, plan_id
          FROM sys.query_store_plan
    )
SELECT b.plan_id as plan_id,
    is_forced_plan,
    execution_type,
    count_executions,
    SWITCHOFFSET(bucket_start, DATEPART(tz, @interval_start_time)) AS bucket_start,
    SWITCHOFFSET(bucket_end, DATEPART(tz, @interval_start_time)) AS bucket_end,
    avg_duration,
    max_duration,
    min_duration,
    stdev_duration,
    variation_duration,
    total_duration
FROM bucketizer b
JOIN is_forced f ON f.plan_id = b.plan_id',N'@query_id bigint,@replica_group_id bigint,@interval_start_time datetimeoffset(7),@interval_end_time datetimeoffset(7)',@query_id=107,@replica_group_id=1,@interval_start_time='2026-02-26 07:56:12.2353819 -05:00',@interval_end_time='2026-02-26 08:56:12.2353819 -05:00'

exec sp_executesql N'SELECT
    p.is_forced_plan,
    p.query_plan
FROM
    sys.query_store_plan p
WHERE
    p.query_id = @query_id
    AND p.plan_id = @plan_id',N'@query_id bigint,@plan_id bigint',@query_id=107,@plan_id=1

exec sp_executesql N'WITH
A AS
(
SELECT
    p.query_id query_id,
    qt.query_sql_text query_sql_text,
    p.plan_id plan_id,
    p.force_failure_count force_failure_count,
    p.last_force_failure_reason_desc last_force_failure_reason_desc,
    p.last_execution_time last_execution_time,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'''') object_name,
    p.last_compile_start_time last_compile_start_time
FROM sys.query_store_plan p
    JOIN sys.query_store_query q ON q.query_id = p.query_id
    JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
where p.is_forced_plan = 1
),
B AS
(
SELECT
    p.query_id query_id,
    MAX(p.last_execution_time) last_execution_time,
    COUNT(distinct p.plan_id) num_plans
FROM sys.query_store_plan p
GROUP BY p.query_id
HAVING MAX(CAST(p.is_forced_plan AS tinyint)) = 1
)
SELECT 
    A.query_id,
    A.query_sql_text,
    A.plan_id,
    A.force_failure_count,
    A.last_compile_start_time,
    A.last_force_failure_reason_desc,
    B.num_plans,
    B.last_execution_time,
    A.last_execution_time,
    A.object_id,
    A.object_name
FROM A JOIN B ON A.query_id = B.query_id
WHERE B.num_plans >= 1
ORDER BY force_failure_count DESC',N'@replica_group_id bigint',@replica_group_id=1

exec sp_executesql N'SELECT TOP (@results_row_count)
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'''') object_name,
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
ORDER BY variation_duration DESC',N'@results_row_count int,@interval_start_time datetimeoffset(7),@interval_end_time datetimeoffset(7),@replica_group_id bigint',@results_row_count=25,@interval_start_time='2026-02-26 07:56:17.6661346 -05:00',@interval_end_time='2026-02-26 08:56:17.6661346 -05:00',@replica_group_id=1

exec sp_executesql N'SELECT TOP (@results_row_count)
    ws.wait_category wait_category,
    ws.wait_category_desc wait_category_desc,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms)/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))*1,2) avg_query_wait_time,
    ROUND(CONVERT(float, MIN(ws.min_query_wait_time_ms))*1,2) min_query_wait_time,
    ROUND(CONVERT(float, MAX(ws.max_query_wait_time_ms))*1,2) max_query_wait_time,
    ROUND(CONVERT(float, SQRT( SUM(ws.stdev_query_wait_time_ms*ws.stdev_query_wait_time_ms*(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms))/SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms)))*1,2) stdev_query_wait_time,
    ROUND(CONVERT(float, SUM(ws.total_query_wait_time_ms))*1,2) total_query_wait_time,
    CAST(ROUND(SUM(ws.total_query_wait_time_ms/ws.avg_query_wait_time_ms),0) AS BIGINT) count_executions
FROM sys.query_store_wait_stats ws
    JOIN sys.query_store_runtime_stats_interval itvl ON itvl.runtime_stats_interval_id = ws.runtime_stats_interval_id
WHERE
    NOT (itvl.start_time > @interval_end_time OR itvl.end_time < @interval_start_time)
    AND ws.replica_group_id = @replica_group_id
GROUP BY ws.wait_category, wait_category_desc
ORDER BY total_query_wait_time DESC',N'@interval_start_time datetimeoffset(7),@interval_end_time datetimeoffset(7),@results_row_count int,@replica_group_id bigint',@interval_start_time='2026-02-26 07:56:19.3603491 -05:00',@interval_end_time='2026-02-26 08:56:19.3603491 -05:00',@results_row_count=10,@replica_group_id=1

exec sp_executesql N'SELECT TOP (@results_row_count)
    p.query_id query_id,
    q.object_id object_id,
    ISNULL(OBJECT_NAME(q.object_id),'''') object_name,
    qt.query_sql_text query_sql_text,
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
HAVING COUNT(distinct p.plan_id) >= 1
ORDER BY total_duration DESC',N'@results_row_count int,@interval_start_time datetimeoffset(7),@interval_end_time datetimeoffset(7),@replica_group_id bigint',@results_row_count=25,@interval_start_time='2026-02-26 07:11:21.4788542 -05:00',@interval_end_time='2026-02-26 08:11:21.4788542 -05:00',@replica_group_id=1

exec sp_executesql N'WITH DateGenerator AS
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
OPTION (MAXRECURSION 0)',N'@interval_start_time datetimeoffset(7),@interval_end_time datetimeoffset(7),@replica_group_id bigint',@interval_start_time='2026-01-26 08:11:26.0260308 -05:00',@interval_end_time='2026-02-26 08:11:26.0260308 -05:00',@replica_group_id=1