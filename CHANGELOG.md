# Changelog

All notable changes to **SQL Server Query Store Reports** are documented here.

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
- Azure SQL support validation & testing
