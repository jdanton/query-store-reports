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

// The mssql extension passes TreeNodeInfo class instances with getter properties.
// We use a loose type and extract connection info dynamically.
export type MssqlTreeNode = Record<string, unknown>;

/**
 * Extract a connection profile from the mssql extension's tree node.
 * The TreeNodeInfo class uses getter properties (connectionInfo, label, nodeType, etc.)
 * so we probe for known property names on the object.
 */
function extractFromTreeNode(node: MssqlTreeNode, log?: vscode.OutputChannel): { profile: MssqlConnectionProfile; database?: string } | undefined {
  // The mssql extension's TreeNodeInfo exposes connectionInfo via a getter
  const connInfo = node.connectionInfo ?? node.connectionProfile ?? node.connection;
  if (!connInfo || typeof connInfo !== 'object') {
    // Log available property names for debugging
    const ownKeys = Object.getOwnPropertyNames(node);
    const protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(node) ?? {});
    log?.appendLine(`[tree-node] No connectionInfo found. Own keys: ${ownKeys.join(', ')}; Proto keys: ${protoKeys.join(', ')}`);
    log?.appendLine(`[tree-node] Raw: ${JSON.stringify(node, null, 2)}`);
    return undefined;
  }

  const info = connInfo as Record<string, unknown>;
  log?.appendLine(`[tree-node] connectionInfo keys: ${Object.keys(info).join(', ')}`);
  log?.appendLine(`[tree-node] authenticationType: ${info.authenticationType}`);

  const profile: MssqlConnectionProfile = {
    server: String(info.server ?? ''),
    authenticationType: String(info.authenticationType ?? ''),
    database: info.database != null ? String(info.database) : undefined,
    user: info.user != null ? String(info.user) : undefined,
    password: info.password != null ? String(info.password) : undefined,
    connectionName: (info.connectionName ?? info.profileName) != null ? String(info.connectionName ?? info.profileName) : undefined,
    profileName: info.profileName != null ? String(info.profileName) : undefined,
    encrypt: info.encrypt != null ? Boolean(info.encrypt) : undefined,
    trustServerCertificate: info.trustServerCertificate != null ? Boolean(info.trustServerCertificate) : undefined,
    port: info.port != null ? Number(info.port) : undefined,
  };

  // The database name may come from the tree node label (when right-clicking a database node)
  const database = (node.label as string) ?? profile.database;

  return { profile, database };
}

export type ConfigFactory = () => Promise<sql.config>;

export async function resolveConnection(
  context: vscode.ExtensionContext,
  treeNode?: MssqlTreeNode,
  log?: vscode.OutputChannel,
): Promise<{ configFactory: ConfigFactory; label: string; database: string; server: string } | undefined> {
  let profile: MssqlConnectionProfile | undefined;
  let database: string | undefined;

  if (treeNode) {
    const extracted = extractFromTreeNode(treeNode, log);
    if (extracted?.profile.server) {
      profile = extracted.profile;
      database = extracted.database;
    }
  }

  if (!profile) {
    // Invoked from the command palette or tree node extraction failed — pick a connection
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

  // Validate that we can build a config at least once (prompts for password, etc.)
  const config = await buildSqlConfig(context, profile, database);
  if (!config) {
    return undefined;
  }

  // For Azure MFA, create a factory that fetches a fresh token each time.
  // For other auth types, the config is static.
  const authType = (profile.authenticationType ?? 'SqlLogin').toLowerCase();
  const isAzureMfa = authType === 'azuremfa' || authType === 'azureactivedirectory-mfa' || authType === 'azureactivedirectorymfa';
  const savedProfile = profile;
  const savedDatabase = database;

  const configFactory: ConfigFactory = isAzureMfa
    ? () => buildSqlConfig(context, savedProfile, savedDatabase).then((c) => {
        if (!c) { throw new Error('Azure authentication was cancelled.'); }
        return c;
      })
    : async () => config;

  const label = profile.connectionName ?? profile.profileName ?? `${profile.server}/${database}`;
  const server = config.server ?? profile.server;
  return { configFactory, label, database, server };
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
  // The mssql VS Code extension stores server as "host,port" (SQL Server convention),
  // but the mssql npm package (tedious) expects host and port separately.
  let server = profile.server;
  let port = profile.port;
  const commaIdx = server.indexOf(',');
  if (commaIdx !== -1) {
    const parsed = parseInt(server.substring(commaIdx + 1), 10);
    if (!isNaN(parsed)) {
      port = port ?? parsed;
      server = server.substring(0, commaIdx);
    }
  }

  const authType = (profile.authenticationType ?? 'SqlLogin').toLowerCase();
  const baseOptions: sql.config['options'] = {
    encrypt: profile.encrypt !== false,
    trustServerCertificate: profile.trustServerCertificate ?? true,
    database,
    port,
  };

  if (authType === 'integrated' || authType === 'windows') {
    return {
      server,
      options: baseOptions,
      domain: undefined,
    };
  }

  if (authType === 'azuremfa' || authType === 'azureactivedirectory-mfa' || authType === 'azureactivedirectorymfa') {
    // Use VS Code's built-in Microsoft auth provider to get a token for Azure SQL
    const session = await vscode.authentication.getSession('microsoft', [
      'https://database.windows.net/.default',
    ], { createIfNone: true });

    if (!session) {
      vscode.window.showErrorMessage('Azure authentication was cancelled.');
      return undefined;
    }

    return {
      server,
      authentication: {
        type: 'azure-active-directory-access-token',
        options: { token: session.accessToken },
      },
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
    server,
    user,
    password,
    options: baseOptions,
  };
}
