import * as vscode from 'vscode';
import { resolveConnection, MssqlTreeNode } from './connectionManager';
import { QueryStorePanel, ReportType } from './panels/QueryStorePanel';
import { QueryRunner } from './queryRunner';

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

        const { config, label, database } = resolved;
        const runnerKey = `${config.server}:${database}`;

        let runner = runners.get(runnerKey);
        if (!runner) {
          runner = new QueryRunner(config);
          runners.set(runnerKey, runner);
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

export function deactivate(): void {}
