import * as sql from 'mssql';

export interface ForcedPlansParams {
  replicaGroupId: number;
}

export interface ForcedPlansRow {
  query_id: number;
  query_sql_text: string;
  plan_id: number;
  force_failure_count: number;
  last_compile_start_time: Date;
  last_force_failure_reason_desc: string;
  num_plans: number;
  last_execution_time: Date;
  object_id: number;
  object_name: string;
}

export async function executeForcedPlans(
  pool: sql.ConnectionPool,
  params: ForcedPlansParams,
): Promise<ForcedPlansRow[]> {
  const request = pool.request();
  request.input('replica_group_id', sql.BigInt, params.replicaGroupId);

  const querySql = `
WITH
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
    ISNULL(OBJECT_NAME(q.object_id),'') object_name,
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
    JOIN sys.query_store_runtime_stats rs ON rs.plan_id = p.plan_id
WHERE rs.replica_group_id = @replica_group_id
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
    A.object_id,
    A.object_name
FROM A JOIN B ON A.query_id = B.query_id
WHERE B.num_plans >= 1
ORDER BY force_failure_count DESC`;

  const result = await request.query<ForcedPlansRow>(querySql);
  return result.recordset;
}
