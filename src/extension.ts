import * as vscode from 'vscode';
import { resolveConnection, MssqlTreeNode } from './connectionManager';
import { QueryStorePanel, ReportType } from './panels/QueryStorePanel';
import { QueryRunner } from './queryRunner';
import { executeQueryStoreStatus } from './queries/queryStoreStatus';

// Keep runners alive so connections are reused across multiple panels for the same DB
const runners = new Map<string, QueryRunner>();

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Query Store Reports');
  context.subscriptions.push(log);

  const registerCommand = (reportType: ReportType) => {
    return vscode.commands.registerCommand(`queryStore.${reportType}`, async (treeNode?: MssqlTreeNode) => {
      try {
        const resolved = await resolveConnection(context, treeNode, log);
        if (!resolved) {
          return;
        }

        const { configFactory, label, database, server } = resolved;
        const runnerKey = `${server}:${database}`;

        let runner = runners.get(runnerKey);
        if (!runner) {
          runner = new QueryRunner(configFactory);
          runners.set(runnerKey, runner);
        } else {
          // Update the factory so reconnects use a fresh token
          runner.updateConfigFactory(configFactory);
        }

        const qsEnabled = await checkQueryStoreEnabled(runner, database);
        if (!qsEnabled) {
          return;
        }

        QueryStorePanel.createOrShow(context.extensionUri, reportType, runner, label, database);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Query Store: ${message}`);
      }
    });
  };

  context.subscriptions.push(
    registerCommand(ReportType.TopResources),
    registerCommand(ReportType.Regressed),
    registerCommand(ReportType.HighVariation),
    registerCommand(ReportType.WaitStats),
    registerCommand(ReportType.ForcedPlans),
    registerCommand(ReportType.OverallConsumption),
  );

  context.subscriptions.push({
    dispose: () => {
      for (const runner of runners.values()) {
        runner.close().catch(() => {});
      }
      runners.clear();
    },
  });
}

async function checkQueryStoreEnabled(runner: QueryRunner, database: string): Promise<boolean> {
  const pool = await runner.getPool();
  const status = await executeQueryStoreStatus(pool);

  // actual_state >= 1 covers READ_ONLY and READ_WRITE — both are queryable
  if (status && status.actual_state >= 1) {
    return true;
  }

  const stateDesc = status?.actual_state_desc ?? 'OFF';
  const enableAction = 'Enable Query Store';
  const choice = await vscode.window.showErrorMessage(
    `Query Store is ${stateDesc} on [${database}]. Query Store must be enabled to view reports.`,
    enableAction,
  );

  if (choice === enableAction) {
    try {
      const req = pool.request();
      await req.query(`ALTER DATABASE [${database.replace(/\]/g, ']]')}] SET QUERY_STORE = ON`);
      vscode.window.showInformationMessage(`Query Store has been enabled on [${database}].`);
      return true;
    } catch (enableErr) {
      const msg = enableErr instanceof Error ? enableErr.message : String(enableErr);
      vscode.window.showErrorMessage(`Failed to enable Query Store on [${database}]: ${msg}`);
      return false;
    }
  }

  return false;
}

export function deactivate(): void {}
