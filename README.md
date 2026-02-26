# SQL Server Query Store Reports

A cross-platform VS Code extension that brings SQL Server Management Studio's **Query Store** report suite directly into VS Code. Works on macOS, Linux, and Windows.

> **Requires** the [SQL Server (mssql)](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql) extension — it is listed as a dependency and will be installed automatically.

---

## Reports

| Report | Description |
|--------|-------------|
| **Top Resource Consuming Queries** | Ranks queries by a selected metric (duration, CPU, IO, memory, row count). Horizontal bar chart + sortable grid. |
| **Regressed Queries** | Finds queries whose average duration has grown compared to a historical baseline. Grouped bar chart comparing recent vs. historical cost. |
| **Queries with High Variation** | Surfaces queries with unpredictable execution times (high coefficient of variation). Identifies plan instability. |
| **Overall Wait Statistics** | Shows aggregate wait time by category (CPU, I/O, Lock, Memory, etc.) for the selected time window. |
| **Forced Plans** | Lists all queries with a forced execution plan, including failure counts and reasons. Provides a one-click **Remove Forced Plan** action. |
| **Overall Resource Consumption** | Day-by-day trend of total executions, duration, CPU, I/O, memory, and wait time. Multi-series line chart with per-metric toggles. |

Every query-level report supports **drill-down**: click any row to open a split panel showing:
- Per-plan **execution statistics** over time (line chart bucketed by minute)
- The **query execution plan** rendered as an interactive SVG diagram
- When a query has **multiple plans**, click any plan label in the chart legend to switch between them

---

## Requirements

- VS Code **1.85** or later
- [SQL Server (mssql)](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql) extension
- SQL Server **2016** or later (Query Store was introduced in SQL Server 2016)
- Query Store must be **enabled** on the target database:
  ```sql
  ALTER DATABASE [YourDatabase] SET QUERY_STORE = ON;
  ```

---

## Installation

### From VSIX (recommended)

1. Build the `.vsix` package:
   ```bash
   git clone https://github.com/jdanton/query-store-reports.git
   cd query-store-reports
   npm install
   npm run build
   npx vsce package
   ```
   This produces a file like `query-store-reports-0.4.0.vsix`.

2. In VS Code: **Extensions** → `···` menu → **Install from VSIX…**
3. Select the `.vsix` file.

### From source (development)
```bash
git clone https://github.com/jdanton/query-store-reports.git
cd query-store-reports
npm install
npm run compile
```
Then press **F5** in VS Code to launch an Extension Development Host.

---

## Usage

### Opening a report

**Method 1 — Right-click on a database node:**
1. Open the SQL Server explorer (SQL icon in the activity bar).
2. Connect to your server and expand the **Databases** folder.
3. Right-click any database → **Query Store** → choose a report.

**Method 2 — Command Palette:**
1. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
2. Type `Query Store` and select a report.
3. If no connection is active, a picker will appear listing your saved connections.

### Connection & authentication

The extension reads connection profiles saved in the mssql extension (`mssql.connections` in your VS Code settings).

| Auth type | Behavior |
|-----------|----------|
| SQL Login | Password is retrieved from VS Code's secret storage. If not saved, you'll be prompted once and offered the option to store it. |
| Windows / Integrated | Uses the ambient Windows identity. |
| Azure AD / Entra ID (MFA) | Authenticates via VS Code's built-in Microsoft auth provider — uses the same account you are signed into in VS Code. Works with Azure SQL Database and Managed Instance. |

---

## Report Parameters

Each report's toolbar exposes the parameters that drive its query.

### Time range presets

| Preset | Window |
|--------|--------|
| Last 1 hour | `now − 1h` → `now` |
| Last 4 hours | `now − 4h` → `now` |
| Last 24 hours | `now − 24h` → `now` |
| Last 7 days | `now − 7d` → `now` |
| Last 30 days | `now − 30d` → `now` |
| Custom… | Exposes start/end datetime pickers |

### Regressed Queries — extra parameters

| Parameter | Description |
|-----------|-------------|
| Recent Period | The "current" window to evaluate (default: last 1 hour) |
| History Period | The baseline window to compare against (default: last 7 days) |
| Min Executions | Only include queries with at least this many executions in the recent window (filters noise) |

### Top Resource Consuming — parameters

| Parameter | Description |
|-----------|-------------|
| Metric | Ranking metric — Duration, CPU Time, Logical/Physical IO Reads/Writes, Memory, or Row Count |
| Min Plans | Only include queries with at least this many distinct execution plans (default: 1) |

| Metric | Column |
|--------|--------|
| Duration (ms) | `SUM(avg_duration × executions) × 0.001` |
| CPU Time (ms) | `SUM(avg_cpu_time × executions) × 0.001` |
| Logical IO Reads (KB) | `SUM(avg_logical_io_reads × executions) × 8` |
| Logical IO Writes (KB) | `SUM(avg_logical_io_writes × executions) × 8` |
| Physical IO Reads (KB) | `SUM(avg_physical_io_reads × executions) × 8` |
| Memory (KB) | `SUM(avg_query_max_used_memory × executions) × 8` |
| Row Count | `SUM(avg_rowcount × executions)` |

---

## Query Execution Plan Viewer

Click any row in a report grid to open the drill-down panel. The lower section renders the XML execution plan as an SVG node graph:

- **Node color** encodes relative cost: green (cheap) → red (expensive).
- **Variable edge thickness** — edge lines scale logarithmically with estimated row count, making heavy data flows easy to spot.
- **Arrowheads** on edges indicating data flow direction.
- **Row count labels** at the midpoint of each edge.
- **Object names** displayed on nodes (e.g., `dbo.Users.PK_Users`) when the operator references a table or index.
- **Warning badges** (⚠) on nodes with SpillToTempDb, NoJoinPredicate, missing statistics, or unmatched indexes.
- **Parallelism indicators** (‖) on parallel operators.
- **Structured tooltips** — hover over a node to see a formatted card with operator name, cost metrics (CPU, I/O, subtree cost, estimated rows), object name, and warnings.
- **Edge tooltips** — hover over an edge to see estimated rows, row size, and data size.
- **Zoom controls** (Fit / + / −) in the plan toolbar.
- **Force This Plan** button stores the displayed plan as the forced plan for the query (`sp_query_store_force_plan`).
- **Remove Forced Plan** reverts to automatic plan selection (`sp_query_store_unforce_plan`).

> The plan viewer parses the standard SQL Server XML Showplan format. Plans from SQL Server 2016 through SQL Server 2022 and Azure SQL Database are supported.

---

## Replica Groups

All queries include a `@replica_group_id` parameter, which defaults to **1** (the primary replica). This is relevant for Always On Availability Groups and Azure SQL Hyperscale where Query Store captures per-replica statistics. A replica selector will be added in a future release.

---

## Known Limitations

- **Query Store must be enabled** — if it is off, reports will return no data or an error.
- **Read replicas** — `replica_group_id = 1` always targets the primary. Secondary replica data requires manual parameter adjustment (future UI).
- **Encrypted modules** — queries inside natively compiled or encrypted modules show as `<restricted text>` per SQL Server's own access controls.
- **Plan XML** — very large plans (thousands of nodes) may render slowly. Use the Fit button to reset zoom.
- **Windows Integrated auth on macOS** — requires a Kerberos ticket (`kinit`). Azure AD / Entra ID is the recommended alternative on non-Windows hosts.
- **Server address format** — the extension handles both `host,port` (SQL Server convention) and separate port configuration automatically.

---

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full architecture guide, build instructions, and instructions for adding new reports.

---

## License

MIT
