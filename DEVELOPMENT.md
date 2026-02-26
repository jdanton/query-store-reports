# Development Guide

This document describes the architecture, build system, and patterns used in the Query Store Reports extension. Read this before making changes.

---

## Prerequisites

```bash
node --version   # >= 18
npm --version    # >= 9
```

```bash
npm install
```

---

## Build

| Command | Output | Use case |
|---------|--------|----------|
| `npm run compile` | `out/extension.js` + `media/webview.js` with source maps | Development |
| `npm run build` | Same files, minified, no source maps | Packaging |
| `node esbuild.mjs --watch` | Incremental builds on file change | Active development |

Two independent bundles are produced by [esbuild.mjs](esbuild.mjs):

1. **Extension bundle** (`out/extension.js`) — runs in VS Code's Node.js extension host.
   - Entry: `src/extension.ts`
   - Format: CommonJS (`cjs`)
   - `vscode` is external (provided by the host at runtime)
   - All other dependencies (including `mssql`/`tedious`) are inlined

2. **Webview bundle** (`media/webview.js`) — runs in the isolated webview browser context.
   - Entry: `webview-src/main.ts`
   - Format: IIFE (no module system in webview)
   - `Chart` is external (loaded separately from `media/chart.umd.min.js`)

---

## Project Structure

```
query-store-reports/
│
├── src/                        Extension host (Node.js context)
│   ├── extension.ts            Activation entry point
│   ├── connectionManager.ts    Connection discovery & password resolution
│   ├── queryRunner.ts          mssql ConnectionPool lifecycle
│   ├── queries/                One file per report — SQL + TypeScript types
│   │   ├── topResourceConsuming.ts
│   │   ├── regressedQueries.ts
│   │   ├── highVariation.ts
│   │   ├── waitStats.ts
│   │   ├── forcedPlans.ts
│   │   ├── overallConsumption.ts
│   │   ├── executionStats.ts   Drill-down: per-query time-bucketed stats
│   │   └── queryPlan.ts        Drill-down: fetch XML showplan
│   └── panels/
│       └── QueryStorePanel.ts  Webview panel — HTML shell, message routing, query dispatch
│
├── webview-src/                Webview browser context (compiled to media/webview.js)
│   ├── main.ts                 Toolbar UI, Chart.js rendering, grid, drilldown orchestration
│   └── planRenderer.ts         XML showplan parser → SVG node graph
│
├── media/
│   ├── chart.umd.min.js        Chart.js 4.x — loaded separately (not bundled)
│   ├── style.css               VS Code theme-aware styles (--vscode-* CSS variables)
│   └── webview.js              Compiled webview bundle (git-ignored in production)
│
├── out/
│   └── extension.js            Compiled extension bundle
│
├── esbuild.mjs                 Unified build script
├── tsconfig.json               Compiles src/ only (webview-src is compiled by esbuild)
└── package.json                Extension manifest
```

---

## Architecture

### Extension ↔ Webview Communication

Messages flow bidirectionally through `vscode.postMessage` / `onDidReceiveMessage`.

**Extension → Webview**

| `type` | Payload | Meaning |
|--------|---------|---------|
| `loading` | — | Query is running, show spinner |
| `data` | `{ rows }` | Main report data (array of row objects) |
| `error` | `{ message }` | Query failed |
| `drilldownData` | `{ rows }` | Execution stats rows for drill-down chart |
| `planData` | `{ xml, isForcedPlan }` | XML showplan string for the plan viewer |
| `forcePlanResult` | `{ success, queryId, planId, message? }` | Result of `sp_query_store_force_plan` |
| `removeForcedPlanResult` | `{ success, queryId, message? }` | Result of `sp_query_store_unforce_plan` |

**Webview → Extension**

| `type` | Payload | Meaning |
|--------|---------|---------|
| `refresh` | `{ params }` | User clicked Refresh or changed a parameter |
| `drilldown` | `{ queryId, planId, params }` | User clicked a row in the grid |
| `forcePlan` | `{ queryId, planId }` | User clicked "Force This Plan" |
| `removeForcedPlan` | `{ queryId }` | User clicked "Remove Forced Plan" |

The webview sends `refresh` on startup with default parameters, triggering the first data load automatically.

### Connection Lifecycle

```
Command invoked
    │
    ▼
resolveConnection()              connectionManager.ts
    │  Reads vscode.workspace.getConfiguration('mssql').connections
    │  Shows QuickPick if no tree node arg
    │  Resolves password from SecretStorage or prompt
    │
    ▼
QueryRunner(config)              queryRunner.ts
    │  Wraps a single mssql.ConnectionPool
    │  Pool is created lazily on first getPool() call
    │  Keyed by "server:database" in extension.ts runners Map
    │  Reused across panels for the same database
    │
    ▼
QueryStorePanel.createOrShow()   panels/QueryStorePanel.ts
    │  One panel per "connectionLabel::database::reportType"
    │  Reuses existing panel if already open
```

### Panel HTML Generation

`QueryStorePanel._getHtml()` returns a static HTML shell. Critically:
- All dynamic content (toolbar, chart, grid) is built entirely in the webview JS — the HTML shell contains only the container `<div>` elements and `data-*` attributes that seed the initial state.
- `data-report-type` tells `main.ts` which toolbar and chart renderer to build.
- `data-default-*` provides ISO 8601 date strings for default time range values.
- Content Security Policy restricts scripts and styles to the extension's own `vscode-resource:` scheme — no CDN calls are made at runtime.

---

## Query Modules

Each file under `src/queries/` follows this pattern:

```typescript
// 1. Parameter interface
export interface MyReportParams {
  intervalStartTime: Date;
  intervalEndTime: Date;
  replicaGroupId: number;
  resultsRowCount: number;
}

// 2. Row type matching the SELECT list
export interface MyReportRow {
  query_id: number;
  query_sql_text: string;
  // ...
}

// 3. Execute function — adds inputs to a Request, runs the query
export async function executeMyReport(
  pool: sql.ConnectionPool,
  params: MyReportParams,
): Promise<MyReportRow[]> {
  const request = pool.request();
  request.input('interval_start_time', sql.DateTimeOffset, params.intervalStartTime);
  // ...
  const result = await request.query<MyReportRow>(`SELECT ...`);
  return result.recordset;
}
```

`DateTimeOffset` parameters accept JavaScript `Date` objects. The `mssql`/`tedious` driver serializes them as UTC. The `SWITCHOFFSET` and `DATEPART(tz, ...)` calls within the queries handle timezone-relative bucketing.

---

## Adding a New Report

### 1. Add the query module

Create `src/queries/myNewReport.ts` following the pattern above.

### 2. Register a command

In `package.json`, add to `contributes.commands`:
```json
{ "command": "queryStore.myNewReport", "title": "My New Report", "category": "Query Store" }
```

Add it to `contributes.menus.commandPalette` and `contributes.menus.queryStore.submenu`.

### 3. Add the `ReportType` entry

In `src/panels/QueryStorePanel.ts`:
```typescript
export enum ReportType {
  // ...
  MyNewReport = 'myNewReport',
}

const REPORT_TITLES: Record<ReportType, string> = {
  // ...
  [ReportType.MyNewReport]: 'My New Report',
};
```

### 4. Add the query dispatch case

In `QueryStorePanel._loadMainData()`, add a `case ReportType.MyNewReport:` that calls your execute function.

### 5. Register the command

In `src/extension.ts`, `registerCommand(ReportType.MyNewReport)` is called automatically if you added it to the enum — no change needed.

### 6. Add the toolbar builder

In `webview-src/main.ts`, add an `else if (reportType === 'myNewReport')` block in `buildToolbar()` that builds the parameter controls and sets the initial `currentParams`.

### 7. Add the chart renderer

In `webview-src/main.ts`, add a branch in `renderChart()` that calls your new render function, and add the column definitions to `COLUMN_DEFS`.

---

## Plan Renderer

`webview-src/planRenderer.ts` is a self-contained module with no runtime dependencies (it uses the browser's native `DOMParser`).

**Parsing:**
1. `parsePlan(xml)` finds the root `RelOp` element under `StmtSimple > QueryPlan > RelOp`.
2. `parseRelOp()` recursively walks nested `RelOp` elements, building a `PlanNode` tree.
3. Each node captures: `PhysicalOp`, `LogicalOp`, `EstimateRows`, `EstimateCPU`, `EstimateIO`, `TotalSubtreeCost`, and `Parallel`.
4. `relOpCost` is computed as `node.totalSubtreeCost / rootTotalSubtreeCost`, giving a 0–1 fraction used for color mapping.

**Layout:**
1. `computeLayout()` recursively assigns `width` and `height` to each node using a bottom-up bounding-box algorithm.
2. `assignPositions()` does a top-down pass that centers each parent over its children.

**Rendering:**
1. `renderPlanSvg()` walks the tree and emits SVG `<rect>`, `<text>`, and `<path>` elements.
2. `costColor(fraction)` maps 0–1 to `hsl(120,70%,45%)` (green) → `hsl(0,70%,45%)` (red).
3. Tooltip text is stored in `data-tooltip` attributes; `main.ts` attaches `mouseenter`/`mousemove`/`mouseleave` listeners to display a floating overlay.

---

## Refreshing Chart.js

The bundled `media/chart.umd.min.js` was downloaded from jsDelivr at build time. To update it:

```bash
node -e "
const https = require('https'), fs = require('fs');
https.get('https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js', r => {
  r.pipe(fs.createWriteStream('media/chart.umd.min.js'))
    .on('finish', () => console.log('done'));
});
"
```

---

## Packaging

```bash
npm install -g @vscode/vsce
vsce package
```

This produces a `.vsix` file that can be installed via **Install from VSIX…** or uploaded to the VS Code Marketplace.

The `.vscodeignore` file ensures that `src/`, `webview-src/`, `node_modules/`, and build artifacts are excluded from the package — only the compiled `out/` and `media/` directories are shipped.
