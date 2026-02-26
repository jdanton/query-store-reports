import * as vscode from 'vscode';
import * as sql from 'mssql';
import { randomBytes } from 'crypto';
import { QueryRunner } from '../queryRunner';
import { executeTopResourceConsuming, TopResourceConsumingParams } from '../queries/topResourceConsuming';
import { executeRegressedQueries, RegressedQueriesParams } from '../queries/regressedQueries';
import { executeHighVariation, HighVariationParams } from '../queries/highVariation';
import { executeWaitStats, WaitStatsParams } from '../queries/waitStats';
import { executeForcedPlans, ForcedPlansParams } from '../queries/forcedPlans';
import { executeOverallConsumption, OverallConsumptionParams } from '../queries/overallConsumption';
import { executeExecutionStats, ExecutionStatsParams } from '../queries/executionStats';
import { executeQueryPlan, QueryPlanParams } from '../queries/queryPlan';

export enum ReportType {
  TopResources      = 'topResources',
  Regressed         = 'regressed',
  HighVariation     = 'highVariation',
  WaitStats         = 'waitStats',
  ForcedPlans       = 'forcedPlans',
  OverallConsumption = 'overallConsumption',
}

const REPORT_TITLES: Record<ReportType, string> = {
  [ReportType.TopResources]:       'Top Resource Consuming Queries',
  [ReportType.Regressed]:          'Regressed Queries',
  [ReportType.HighVariation]:      'Queries with High Variation',
  [ReportType.WaitStats]:          'Overall Wait Statistics',
  [ReportType.ForcedPlans]:        'Forced Plans',
  [ReportType.OverallConsumption]: 'Overall Resource Consumption',
};

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000);
}

export class QueryStorePanel {
  private static readonly currentPanels = new Map<string, QueryStorePanel>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionUri: vscode.Uri,
    reportType: ReportType,
    runner: QueryRunner,
    connectionLabel: string,
    database: string,
  ): void {
    const key = `${connectionLabel}::${database}::${reportType}`;
    const existing = QueryStorePanel.currentPanels.get(key);
    if (existing) {
      existing._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'queryStoreReport',
      `${REPORT_TITLES[reportType]} — ${database}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        retainContextWhenHidden: true,
      },
    );

    new QueryStorePanel(panel, extensionUri, reportType, runner, connectionLabel, database, key);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly reportType: ReportType,
    private readonly runner: QueryRunner,
    private readonly connectionLabel: string,
    private readonly database: string,
    private readonly key: string,
  ) {
    this._panel = panel;
    QueryStorePanel.currentPanels.set(key, this);

    this._panel.webview.html = this._getHtml(extensionUri);

    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      undefined,
      this._disposables,
    );

    this._panel.onDidDispose(() => this._dispose(), undefined, this._disposables);
  }

  private _dispose(): void {
    QueryStorePanel.currentPanels.delete(this.key);
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }

  private async _handleMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'refresh': {
        const params = msg.params as Record<string, unknown>;
        await this._loadMainData(params);
        break;
      }
      case 'drilldown': {
        const queryId = msg.queryId as number;
        const planId  = msg.planId  as number;
        await this._loadDrilldown(queryId, planId, msg.params as Record<string, unknown>);
        break;
      }
      case 'getPlan': {
        const queryId = msg.queryId as number;
        const planId  = msg.planId  as number;
        await this._loadPlan(queryId, planId);
        break;
      }
      case 'forcePlan': {
        const queryId = msg.queryId as number;
        const planId  = msg.planId  as number;
        await this._forcePlan(queryId, planId);
        break;
      }
      case 'removeForcedPlan': {
        const queryId = msg.queryId as number;
        const planId  = msg.planId  as number;
        await this._removeForcedPlan(queryId, planId);
        break;
      }
    }
  }

  private _post(msg: Record<string, unknown>): void {
    this._panel.webview.postMessage(msg).then(undefined, () => {});
  }

  private async _loadMainData(params: Record<string, unknown>): Promise<void> {
    this._post({ type: 'loading' });
    try {
      const pool = await this.runner.getPool();
      let rows: unknown[];

      const p = params;
      const dt = (key: string, fallback: Date): Date => {
        const v = p[key];
        return v ? new Date(v as string) : fallback;
      };

      switch (this.reportType) {
        case ReportType.TopResources: {
          rows = await executeTopResourceConsuming(pool, {
            resultsRowCount:   Number(p.resultsRowCount ?? 25),
            intervalStartTime: dt('intervalStartTime', hoursAgo(1)),
            intervalEndTime:   dt('intervalEndTime',   new Date()),
            replicaGroupId:    Number(p.replicaGroupId ?? 1),
            metric:            ((p.metric as string) ?? 'duration') as TopResourceConsumingParams['metric'],
            minPlans:          Number(p.minPlans ?? 1),
          });
          break;
        }
        case ReportType.Regressed: {
          rows = await executeRegressedQueries(pool, {
            resultsRowCount:  Number(p.resultsRowCount ?? 25),
            recentStartTime:  dt('recentStartTime',  hoursAgo(1)),
            recentEndTime:    dt('recentEndTime',    new Date()),
            historyStartTime: dt('historyStartTime', daysAgo(7)),
            historyEndTime:   dt('historyEndTime',   new Date()),
            minExecCount:     Number(p.minExecCount ?? 1),
            replicaGroupId:   Number(p.replicaGroupId ?? 1),
          });
          break;
        }
        case ReportType.HighVariation: {
          rows = await executeHighVariation(pool, {
            resultsRowCount:   Number(p.resultsRowCount ?? 25),
            intervalStartTime: dt('intervalStartTime', hoursAgo(1)),
            intervalEndTime:   dt('intervalEndTime',   new Date()),
            replicaGroupId:    Number(p.replicaGroupId ?? 1),
          });
          break;
        }
        case ReportType.WaitStats: {
          rows = await executeWaitStats(pool, {
            resultsRowCount:   Number(p.resultsRowCount ?? 10),
            intervalStartTime: dt('intervalStartTime', hoursAgo(1)),
            intervalEndTime:   dt('intervalEndTime',   new Date()),
            replicaGroupId:    Number(p.replicaGroupId ?? 1),
          });
          break;
        }
        case ReportType.ForcedPlans: {
          rows = await executeForcedPlans(pool, {
            replicaGroupId: Number(p.replicaGroupId ?? 1),
          });
          break;
        }
        case ReportType.OverallConsumption: {
          rows = await executeOverallConsumption(pool, {
            intervalStartTime: dt('intervalStartTime', daysAgo(30)),
            intervalEndTime:   dt('intervalEndTime',   new Date()),
            replicaGroupId:    Number(p.replicaGroupId ?? 1),
          });
          break;
        }
        default:
          rows = [];
      }

      this._post({ type: 'data', rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._post({ type: 'error', message });
    }
  }

  private async _loadDrilldown(
    queryId: number,
    planId: number,
    mainParams: Record<string, unknown>,
  ): Promise<void> {
    try {
      const pool = await this.runner.getPool();

      // Execution stats
      const statsParams: ExecutionStatsParams = {
        queryId,
        replicaGroupId:    Number(mainParams?.replicaGroupId ?? 1),
        intervalStartTime: (() => { const v = mainParams?.intervalStartTime ?? mainParams?.recentStartTime; return v ? new Date(v as string) : hoursAgo(1); })(),
        intervalEndTime:   (() => { const v = mainParams?.intervalEndTime   ?? mainParams?.recentEndTime;   return v ? new Date(v as string) : new Date(); })(),
      };
      const statsRows = await executeExecutionStats(pool, statsParams);
      this._post({ type: 'drilldownData', rows: statsRows });

      // Determine the best plan_id: use the one from the report row if valid,
      // otherwise pick the most recent plan from the execution stats results.
      let effectivePlanId = planId;
      if ((!effectivePlanId || effectivePlanId <= 0) && statsRows.length > 0) {
        const latestRow = statsRows.reduce((a: Record<string, unknown>, b: Record<string, unknown>) => {
          const ta = new Date(a.bucket_start as string).getTime();
          const tb = new Date(b.bucket_start as string).getTime();
          return tb > ta ? b : a;
        });
        effectivePlanId = latestRow.plan_id as number;
      }

      // Query plan
      if (effectivePlanId) {
        await this._loadPlan(queryId, effectivePlanId);
      } else {
        this._post({ type: 'planData', xml: '', isForcedPlan: false, planId: 0 });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._post({ type: 'error', message });
    }
  }

  private async _loadPlan(queryId: number, planId: number): Promise<void> {
    try {
      const pool = await this.runner.getPool();
      const planParams: QueryPlanParams = { queryId, planId };
      const planRows = await executeQueryPlan(pool, planParams);
      if (planRows.length > 0 && planRows[0].query_plan) {
        this._post({ type: 'planData', xml: planRows[0].query_plan, isForcedPlan: planRows[0].is_forced_plan, planId });
      } else {
        this._post({ type: 'planData', xml: '', isForcedPlan: false, planId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._post({ type: 'error', message });
    }
  }

  private async _forcePlan(queryId: number, planId: number): Promise<void> {
    try {
      const pool = await this.runner.getPool();
      const request = pool.request();
      request.input('query_id', sql.BigInt, queryId);
      request.input('plan_id', sql.BigInt, planId);
      await request.query(
        `EXEC sp_query_store_force_plan @query_id = @query_id, @plan_id = @plan_id`,
      );
      this._post({ type: 'forcePlanResult', success: true, queryId, planId });
      vscode.window.showInformationMessage(`Plan ${planId} forced for query ${queryId}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._post({ type: 'forcePlanResult', success: false, message });
    }
  }

  private async _removeForcedPlan(queryId: number, planId: number): Promise<void> {
    try {
      const pool = await this.runner.getPool();
      const request = pool.request();
      request.input('query_id', sql.BigInt, queryId);
      request.input('plan_id', sql.BigInt, planId);
      await request.query(
        `EXEC sp_query_store_unforce_plan @query_id = @query_id, @plan_id = @plan_id`,
      );
      this._post({ type: 'removeForcedPlanResult', success: true, queryId });
      vscode.window.showInformationMessage(`Forced plan removed for query ${queryId}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._post({ type: 'removeForcedPlanResult', success: false, message });
    }
  }

  private _getHtml(extensionUri: vscode.Uri): string {
    const webview = this._panel.webview;
    const chartUri  = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chart.umd.min.js'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'));
    const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'style.css'));
    const csp = webview.cspSource;

    const nonce = randomBytes(16).toString('hex');

    const defaultNow    = new Date().toISOString();
    const defaultMinus1h = hoursAgo(1).toISOString();
    const defaultMinus7d = daysAgo(7).toISOString();
    const defaultMinus30d = daysAgo(30).toISOString();

    const reportTitle = REPORT_TITLES[this.reportType];

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src ${csp} 'nonce-${nonce}'; style-src ${csp} 'unsafe-inline'; img-src ${csp} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>${reportTitle}</title>
</head>
<body>
  <div id="app"
    data-report-type="${this.reportType}"
    data-connection="${escapeHtml(this.connectionLabel)}"
    data-database="${escapeHtml(this.database)}"
    data-title="${escapeHtml(reportTitle)}"
    data-default-now="${defaultNow}"
    data-default-minus1h="${defaultMinus1h}"
    data-default-minus7d="${defaultMinus7d}"
    data-default-minus30d="${defaultMinus30d}"
  >
    <header class="qs-header">
      <div class="qs-header-title">
        <span class="qs-report-name">${escapeHtml(reportTitle)}</span>
        <span class="qs-connection-label">${escapeHtml(this.connectionLabel)} / ${escapeHtml(this.database)}</span>
      </div>
    </header>
    <div id="toolbar" class="qs-toolbar"></div>
    <div id="status-bar" class="qs-status hidden"></div>
    <div id="main-content" class="qs-main">
      <div id="chart-section" class="qs-chart-section">
        <canvas id="main-chart"></canvas>
      </div>
      <div id="grid-section" class="qs-grid-section">
        <div id="grid-container" class="qs-grid-container"></div>
      </div>
    </div>
    <div id="drilldown-section" class="qs-drilldown hidden">
      <div class="qs-drilldown-header">
        <span id="drilldown-title" class="qs-drilldown-title"></span>
        <button id="drilldown-close" class="qs-btn-icon" title="Close">✕</button>
      </div>
      <div id="drilldown-stats-section" class="qs-drilldown-chart-section">
        <canvas id="drilldown-chart"></canvas>
      </div>
      <div id="plan-section" class="qs-plan-section">
        <div class="qs-plan-toolbar">
          <span class="qs-plan-label">Query Execution Plan</span>
          <button id="force-plan-btn" class="qs-btn qs-btn-sm" style="display:none">Force This Plan</button>
          <button id="unforce-plan-btn" class="qs-btn qs-btn-sm qs-btn-danger" style="display:none">Remove Forced Plan</button>
          <button id="plan-zoom-fit" class="qs-btn qs-btn-sm">Fit</button>
          <button id="plan-zoom-in"  class="qs-btn qs-btn-sm">+</button>
          <button id="plan-zoom-out" class="qs-btn qs-btn-sm">−</button>
        </div>
        <div id="plan-container" class="qs-plan-container">
          <div id="plan-canvas"></div>
        </div>
        <div id="plan-tooltip" class="qs-plan-tooltip hidden"></div>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${chartUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
