import * as sql from 'mssql';

export interface QueryPlanParams {
  queryId: number;
  planId: number;
}

export interface QueryPlanRow {
  is_forced_plan: boolean;
  query_plan: string;
}

export async function executeQueryPlan(
  pool: sql.ConnectionPool,
  params: QueryPlanParams,
): Promise<QueryPlanRow[]> {
  const request = pool.request();
  request.input('query_id', sql.BigInt, params.queryId);
  request.input('plan_id', sql.BigInt, params.planId);

  const querySql = `
SELECT
    p.is_forced_plan,
    p.query_plan
FROM
    sys.query_store_plan p
WHERE
    p.query_id = @query_id
    AND p.plan_id = @plan_id`;

  const result = await request.query<QueryPlanRow>(querySql);
  return result.recordset;
}
