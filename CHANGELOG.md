# Changelog

All notable changes to **SQL Server Query Store Reports** are documented here.

---

## [0.4.0] — 2026-02-26

### Added

- **Min Plans filter** — Top Resource Consuming Queries toolbar now includes a "Min Plans" parameter that filters out queries with fewer than N distinct execution plans (default: 1).
- **Enhanced plan viewer** — merged improvements from Azure Data Studio's execution plan renderer:
  - **Variable edge thickness** — edge lines scale with row count using a logarithmic formula, making high-row-count data flows visually prominent.
  - **Arrowhead markers** — edges now have arrowheads indicating data flow direction.
  - **Row count labels** — estimated row counts are displayed at the midpoint of each edge.
  - **Object names** — nodes display the referenced table/index name (e.g., `dbo.Users.PK_Users`) when available.
  - **Warning badges** — a ⚠ badge appears on nodes with warnings (SpillToTempDb, NoJoinPredicate, missing statistics, unmatched indexes).
  - **Parallelism indicators** — a ‖ badge marks parallel operators.
  - **Structured HTML tooltips** — tooltips now show a formatted card with operator name, metrics table, object name, and warnings instead of plain text.
  - **Edge tooltips** — hover over an edge to see estimated rows, row size, and data size.
- **Unit test suite** — 76 tests across 9 test files using vitest + happy-dom:
  - `tests/planRenderer.test.ts` — 42 tests covering XML parsing, SVG rendering, color mapping, edge weight calculation, and formatting helpers.
  - `tests/queries/*.test.ts` — 34 tests covering all 8 query modules (parameter binding, SQL structure, recordset passthrough).

### Changed

- **Metric validation** — `topResourceConsuming.ts` now validates the metric parameter and throws on invalid values.

---

## [0.3.0] — 2026-02-26

### Added

- **Clickable plan legend** — in the drill-down execution stats chart, click any plan label in the legend (e.g., "Plan 54") to load that plan's execution plan in the viewer below. Pointer cursor on hover indicates clickability.
- **Active plan highlighting** — the currently displayed plan is emphasized in the chart with a thicker line (4px) and larger data points (5px).
- **Plan switching** — new `getPlan` message type allows loading any plan without re-running the full drilldown. Switching plans is instant once execution stats are loaded.

### Fixed

- **Drill-down plan_id resolution** — reports that aggregate across plans (Top Resource Consuming, High Variation, Regressed) no longer default to `plan_id = 1`. The extension now picks the most recent plan from execution stats, so the plan viewer loads the correct plan.

---

## [0.2.0] — 2026-02-26

### Fixed

- **Azure Entra ID / MFA authentication** — replaced `azure-active-directory-default` (DefaultAzureCredential) with VS Code's built-in Microsoft auth provider (`vscode.authentication`). The extension now uses the same Microsoft account you are signed into in VS Code, which resolves "server is not configured to accept the token" errors on Azure SQL Managed Instance and Azure SQL Database.
- **Server address with comma-delimited port** — the mssql extension stores servers as `host,3342` (SQL Server convention) but the node-mssql driver expects host and port separately. The extension now parses these automatically, fixing `ENOTFOUND` DNS errors for servers with non-default ports.
- **Object Explorer context menu** — the "Query Store" submenu now appears when right-clicking database nodes. The `when` clause was updated to use regex matching (`viewItem =~ /\btype=(Database)\b/`) to match the mssql extension's structured context values.
- **Tree node connection extraction** — improved extraction of connection profile from the mssql extension's `TreeNodeInfo` class instances, which use getter properties. Added diagnostic logging to the "Query Store Reports" output channel for debugging connection issues.
- **Plan loading hang** — when a query plan is unavailable (NULL in Query Store), the drill-down panel now shows "No query plan available" instead of hanging indefinitely on "Loading plan...".

---

## [0.1.0] — 2026-02-26

### Added

**Reports**
- **Top Resource Consuming Queries** — horizontal bar chart ranked by a selectable metric (Duration, CPU Time, Logical IO Reads, Logical IO Writes, Physical IO Reads, Memory, Row Count). Grid shows query text, object name, metric value, total duration, execution count, and plan count.
- **Regressed Queries** — grouped bar chart comparing recent avg duration vs. historical baseline. Parameters: recent period, history period, minimum execution count, row count.
- **Queries with High Variation** — bar chart ordered by coefficient of variation (stdev / avg). Surfaces queries with plan instability.
- **Overall Wait Statistics** — horizontal bar chart of total wait time by wait category (CPU, I/O, Lock, Memory, etc.). Grid includes avg/min/max/stdev per category.
- **Forced Plans** — grid listing all queries with a forced execution plan, including force-failure count and last failure reason. One-click **Remove Forced Plan** action per row.
- **Overall Resource Consumption** — multi-series line chart showing daily totals for Duration, CPU Time, Logical/Physical Reads, Memory, Row Count, and Wait Time. Per-metric checkboxes control which series are displayed.

**Drill-down panel**
- Click any row in a query-level report to open a split bottom panel.
- **Execution Statistics chart** — line chart showing avg/min/max duration per plan over time, bucketed by minute.
- **Query Execution Plan viewer** — renders the XML showplan as an interactive SVG node graph:
  - Nodes colored green→red by relative cost percentage.
  - Hover tooltip showing Physical Op, Logical Op, Estimated Rows, CPU cost, I/O cost, Subtree Cost, and Parallelism.
  - Zoom controls: Fit, +, −.
  - **Force This Plan** and **Remove Forced Plan** buttons.

**Connection management**
- Reads saved connections from the mssql extension (`mssql.connections` VS Code configuration).
- QuickPick connection selector when invoked from the command palette.
- Password retrieval from VS Code SecretStorage with optional save prompt.
- SQL Login, Windows/Integrated, and Azure Active Directory (default credential chain) authentication types.

**Entry points**
- Right-click context menu on database nodes in the SQL Server explorer tree (**Query Store** submenu).
- Command Palette: all six reports under the `Query Store:` category.

**Build**
- esbuild-based build producing two bundles: extension (Node.js/CJS) and webview (browser/IIFE).
- TypeScript strict mode; zero type errors.
- Chart.js 4.4.2 bundled locally for offline use.
- VS Code theme-aware CSS using `--vscode-*` custom properties (light, dark, and high-contrast themes).

---

## Roadmap

- Replica group selector for Always On / Hyperscale secondary replicas
- Export report data to CSV
- Query text copy button
- Pinned/bookmarked queries across sessions
- Plan comparison (side-by-side diff of two plans for the same query)
- Azure SQL Managed Instance & Azure SQL Database testing (basic support shipped in 0.2.0)
