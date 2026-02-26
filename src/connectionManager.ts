import * as vscode from 'vscode';
import * as sql from 'mssql';

export interface MssqlConnectionProfile {
  server: string;
  database?: string;
  user?: string;
  password?: string;
  authenticationType: string;
  connectionName?: string;
  profileName?: string;
  applicationName?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  port?: number;
}

// Shape of a tree node argument from the mssql extension
export interface MssqlTreeNode {
  connectionInfo?: MssqlConnectionProfile;
  label?: string;
  nodeType?: string;
  nodePath?: string;
}

export async function resolveConnection(
  context: vscode.ExtensionContext,
  treeNode?: MssqlTreeNode,
): Promise<{ config: sql.config; label: string; database: string } | undefined> {
  let profile: MssqlConnectionProfile | undefined;
  let database: string | undefined;

  if (treeNode?.connectionInfo) {
    // Invoked from the right-click context menu on a database node
    profile = treeNode.connectionInfo;
    database = treeNode.label ?? treeNode.connectionInfo.database;
  } else {
    // Invoked from the command palette — pick a connection
    const picked = await pickConnection(context);
    if (!picked) {
      return undefined;
    }
    profile = picked.profile;
    database = picked.database;
  }

  if (!database) {
    database = await vscode.window.showInputBox({
      prompt: 'Enter the database name',
      placeHolder: 'MyDatabase',
    });
    if (!database) {
      return undefined;
    }
  }

  const config = await buildSqlConfig(context, profile, database);
  if (!config) {
    return undefined;
  }

  const label = profile.connectionName ?? profile.profileName ?? `${profile.server}/${database}`;
  return { config, label, database };
}

async function pickConnection(
  context: vscode.ExtensionContext,
): Promise<{ profile: MssqlConnectionProfile; database: string } | undefined> {
  // Read saved connections from the mssql extension configuration
  const mssqlConfig = vscode.workspace.getConfiguration('mssql');
  const connections = mssqlConfig.get<MssqlConnectionProfile[]>('connections') ?? [];

  if (connections.length === 0) {
    vscode.window.showErrorMessage(
      'No SQL Server connections found. Please add a connection in the SQL Server extension first.',
    );
    return undefined;
  }

  type ConnItem = vscode.QuickPickItem & { profile: MssqlConnectionProfile };
  const items: ConnItem[] = connections.map((c) => ({
    label: c.connectionName ?? c.profileName ?? c.server,
    description: c.database ? `${c.server} / ${c.database}` : c.server,
    profile: c,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a SQL Server connection',
    matchOnDescription: true,
  });
  if (!selected) {
    return undefined;
  }

  const profile = selected.profile;
  let database = profile.database;

  if (!database) {
    database = await vscode.window.showInputBox({
      prompt: `Enter the database name on ${profile.server}`,
      placeHolder: 'MyDatabase',
    });
    if (!database) {
      return undefined;
    }
  }

  return { profile, database };
}

async function buildSqlConfig(
  context: vscode.ExtensionContext,
  profile: MssqlConnectionProfile,
  database: string,
): Promise<sql.config | undefined> {
  const authType = (profile.authenticationType ?? 'SqlLogin').toLowerCase();
  const baseOptions: sql.config['options'] = {
    encrypt: profile.encrypt !== false,
    trustServerCertificate: profile.trustServerCertificate ?? true,
    database,
  };

  if (profile.port) {
    Object.assign(baseOptions, { port: profile.port });
  }

  if (authType === 'integrated' || authType === 'windows') {
    return {
      server: profile.server,
      options: baseOptions,
      domain: undefined,
    };
  }

  if (authType === 'azuremfa' || authType === 'azureactivedirectory-mfa' || authType === 'azureactivedirectorymfa') {
    return {
      server: profile.server,
      authentication: { type: 'azure-active-directory-default', options: {} },
      options: baseOptions,
    };
  }

  // SQL Login — need a password
  const user = profile.user ?? '';
  if (!user) {
    vscode.window.showErrorMessage('No username configured for this connection.');
    return undefined;
  }

  // Try stored password first
  const secretKey = `queryStore:${profile.server}:${user}`;
  let password = await context.secrets.get(secretKey);

  if (!password) {
    password = await vscode.window.showInputBox({
      prompt: `Password for ${user}@${profile.server}`,
      password: true,
      ignoreFocusOut: true,
    });
    if (!password) {
      return undefined;
    }

    const save = await vscode.window.showQuickPick(['Save password', 'Do not save'], {
      placeHolder: 'Save password for this session?',
    });
    if (save === 'Save password') {
      await context.secrets.store(secretKey, password);
    }
  }

  return {
    server: profile.server,
    user,
    password,
    options: baseOptions,
  };
}
