/// <reference lib="dom" />
import { parsePlan, renderPlanSvg } from './planRenderer';

declare const Chart: any;
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ---- DOM helpers ----
function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) { throw new Error(`Missing element: #${id}`); }
  return el as T;
}

// ---- DOM refs ----
const app         = getEl('app');
const toolbar     = getEl('toolbar');
const statusBar   = getEl('status-bar');
const mainContent = getEl('main-content');
const chartSection = getEl('chart-section');
const gridContainer = getEl('grid-container');
const drilldownSection = getEl('drilldown-section');
const drilldownTitle   = getEl('drilldown-title');
const drilldownClose   = getEl('drilldown-close');
const planContainer    = getEl('plan-container');
const planCanvas       = getEl('plan-canvas');
const planTooltip      = getEl('plan-tooltip');
const forcePlanCheckbox = getEl<HTMLInputElement>('force-plan-checkbox');
const forcePlanLabel    = getEl('force-plan-label');
const planZoomFit  = getEl('plan-zoom-fit');
const planZoomIn   = getEl('plan-zoom-in');
const planZoomOut  = getEl('plan-zoom-out');

// ---- State ----
const reportType = app.dataset.reportType!;
const defaultNow     = app.dataset.defaultNow!;
const defaultMinus1h = app.dataset.defaultMinus1h!;
const defaultMinus7d = app.dataset.defaultMinus7d!;
const defaultMinus30d = app.dataset.defaultMinus30d!;

let currentParams: Record<string, unknown> = {};
let currentRows: Record<string, unknown>[] = [];
let currentChart: any = null;
let drilldownChart: any = null;
let planScale = 1;
let currentPlanRoot: ReturnType<typeof parsePlan> = null;
let currentDrilldownQueryId: number | null = null;
let currentDrilldownPlanId: number | null = null;
let availablePlanIds: number[] = [];

// ---- Toolbar builders ----

function fmtDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeLabel(text: string): HTMLLabelElement {
  const l = document.createElement('label');
  l.className = 'qs-label';
  l.textContent = text;
  return l;
}

function makeInput(type: string, value: string, attrs?: Record<string,string>): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.value = value;
  i.className = 'qs-input';
  if (attrs) for (const [k,v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}

function makeSelect(options: { value: string; label: string }[], selected: string): HTMLSelectElement {
  const s = document.createElement('select');
  s.className = 'qs-select';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === selected) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

function makeRefreshBtn(): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = '↻ Refresh';
  b.className = 'qs-btn qs-btn-primary';
  return b;
}

function makeGroup(...children: HTMLElement[]): HTMLDivElement {
  const g = document.createElement('div');
  g.className = 'qs-toolbar-group';
  for (const c of children) g.appendChild(c);
  return g;
}

const TIME_PRESETS = [
  { value: '1h',    label: 'Last 1 hour' },
  { value: '4h',    label: 'Last 4 hours' },
  { value: '24h',   label: 'Last 24 hours' },
  { value: '7d',    label: 'Last 7 days' },
  { value: '30d',   label: 'Last 30 days' },
  { value: 'custom', label: 'Custom…' },
];

function timePresetToDates(preset: string): { start: Date; end: Date } {
  const now = new Date();
  const ms = (h: number) => h * 3600000;
  switch (preset) {
    case '1h':  return { start: new Date(Date.now() - ms(1)),    end: now };
    case '4h':  return { start: new Date(Date.now() - ms(4)),    end: now };
    case '24h': return { start: new Date(Date.now() - ms(24)),   end: now };
    case '7d':  return { start: new Date(Date.now() - ms(168)),  end: now };
    case '30d': return { start: new Date(Date.now() - ms(720)),  end: now };
    default:    return { start: new Date(Date.now() - ms(1)),    end: now };
  }
}

function buildTimeRangeControls(defaultPreset: string): {
  elements: HTMLElement[];
  getStart: () => string;
  getEnd: () => string;
} {
  const preset = makeSelect(TIME_PRESETS, defaultPreset);
  const startInput = makeInput('datetime-local', fmtDateTimeLocal(defaultMinus1h), { style: 'display:none' });
  const endInput   = makeInput('datetime-local', fmtDateTimeLocal(defaultNow),     { style: 'display:none' });

  const updateVisibility = () => {
    const custom = preset.value === 'custom';
    startInput.style.display = custom ? '' : 'none';
    endInput.style.display   = custom ? '' : 'none';
  };
  preset.addEventListener('change', updateVisibility);

  return {
    elements: [makeLabel('Time Range:'), preset, startInput, makeLabel('to'), endInput],
    getStart: () => {
      if (preset.value === 'custom') return new Date(startInput.value).toISOString();
      return timePresetToDates(preset.value).start.toISOString();
    },
    getEnd: () => {
      if (preset.value === 'custom') return new Date(endInput.value).toISOString();
      return new Date().toISOString();
    },
  };
}

function buildToolbar(): void {
  toolbar.innerHTML = '';

  const refresh = makeRefreshBtn();

  if (reportType === 'topResources') {
    const { elements: timeEls, getStart, getEnd } = buildTimeRangeControls('1h');
    const rowCountInput = makeInput('number', '25', { min: '1', max: '200', style: 'width:70px' });
    const metricSelect = makeSelect([
      { value: 'duration',      label: 'Duration (ms)' },
      { value: 'cpu',           label: 'CPU Time (ms)' },
      { value: 'logicalReads',  label: 'Logical IO Reads' },
      { value: 'logicalWrites', label: 'Logical IO Writes' },
      { value: 'physicalReads', label: 'Physical IO Reads' },
      { value: 'memory',        label: 'Memory (KB)' },
      { value: 'rowcount',      label: 'Row Count' },
    ], 'duration');
    const minPlansInput = makeInput('number', '1', { min: '1', max: '100', style: 'width:60px' });

    toolbar.appendChild(makeGroup(...timeEls));
    toolbar.appendChild(makeGroup(makeLabel('Metric:'), metricSelect));
    toolbar.appendChild(makeGroup(makeLabel('Top:'), rowCountInput));
    toolbar.appendChild(makeGroup(makeLabel('Min Plans:'), minPlansInput));
    toolbar.appendChild(refresh);

    refresh.addEventListener('click', () => {
      currentParams = {
        intervalStartTime: getStart(),
        intervalEndTime: getEnd(),
        resultsRowCount: parseInt(rowCountInput.value, 10) || 25,
        metric: metricSelect.value,
        minPlans: parseInt(minPlansInput.value, 10) || 1,
        replicaGroupId: 1,
      };
      requestData();
    });
    currentParams = {
      intervalStartTime: defaultMinus1h,
      intervalEndTime: defaultNow,
      resultsRowCount: 25,
      metric: 'duration',
      minPlans: 1,
      replicaGroupId: 1,
    };

  } else if (reportType === 'regressed') {
    const recentPreset = makeSelect(TIME_PRESETS.slice(0,5), '1h');
    const histPreset   = makeSelect([
      { value: '7d',  label: 'Last 7 days (history)' },
      { value: '30d', label: 'Last 30 days (history)' },
    ], '7d');
    const minExecInput  = makeInput('number', '1', { min: '1', style: 'width:60px' });
    const rowCountInput = makeInput('number', '25', { min: '1', max: '200', style: 'width:70px' });

    toolbar.appendChild(makeGroup(makeLabel('Recent Period:'), recentPreset));
    toolbar.appendChild(makeGroup(makeLabel('History Period:'), histPreset));
    toolbar.appendChild(makeGroup(makeLabel('Min Executions:'), minExecInput));
    toolbar.appendChild(makeGroup(makeLabel('Top:'), rowCountInput));
    toolbar.appendChild(refresh);

    const getParams = () => {
      const recentDates = timePresetToDates(recentPreset.value);
      const histDates   = timePresetToDates(histPreset.value);
      return {
        recentStartTime:  recentDates.start.toISOString(),
        recentEndTime:    recentDates.end.toISOString(),
        historyStartTime: histDates.start.toISOString(),
        historyEndTime:   histDates.end.toISOString(),
        minExecCount:     parseInt(minExecInput.value, 10) || 1,
        resultsRowCount:  parseInt(rowCountInput.value, 10) || 25,
        replicaGroupId: 1,
      };
    };
    refresh.addEventListener('click', () => { currentParams = getParams(); requestData(); });
    currentParams = getParams();

  } else if (reportType === 'highVariation') {
    const { elements: timeEls, getStart, getEnd } = buildTimeRangeControls('1h');
    const rowCountInput = makeInput('number', '25', { min: '1', max: '200', style: 'width:70px' });

    toolbar.appendChild(makeGroup(...timeEls));
    toolbar.appendChild(makeGroup(makeLabel('Top:'), rowCountInput));
    toolbar.appendChild(refresh);

    refresh.addEventListener('click', () => {
      currentParams = {
        intervalStartTime: getStart(),
        intervalEndTime: getEnd(),
        resultsRowCount: parseInt(rowCountInput.value, 10) || 25,
        replicaGroupId: 1,
      };
      requestData();
    });
    currentParams = { intervalStartTime: defaultMinus1h, intervalEndTime: defaultNow, resultsRowCount: 25, replicaGroupId: 1 };

  } else if (reportType === 'waitStats') {
    const { elements: timeEls, getStart, getEnd } = buildTimeRangeControls('1h');
    const rowCountInput = makeInput('number', '10', { min: '1', max: '100', style: 'width:70px' });

    toolbar.appendChild(makeGroup(...timeEls));
    toolbar.appendChild(makeGroup(makeLabel('Top:'), rowCountInput));
    toolbar.appendChild(refresh);

    refresh.addEventListener('click', () => {
      currentParams = {
        intervalStartTime: getStart(),
        intervalEndTime: getEnd(),
        resultsRowCount: parseInt(rowCountInput.value, 10) || 10,
        replicaGroupId: 1,
      };
      requestData();
    });
    currentParams = { intervalStartTime: defaultMinus1h, intervalEndTime: defaultNow, resultsRowCount: 10, replicaGroupId: 1 };

  } else if (reportType === 'forcedPlans') {
    toolbar.appendChild(refresh);
    refresh.addEventListener('click', () => { currentParams = { replicaGroupId: 1 }; requestData(); });
    currentParams = { replicaGroupId: 1 };

  } else if (reportType === 'overallConsumption') {
    const { elements: timeEls, getStart, getEnd } = buildTimeRangeControls('30d');

    // Metric checkboxes for line chart series
    const metrics = [
      { key: 'total_duration',              label: 'Duration (ms)' },
      { key: 'total_cpu_time',              label: 'CPU Time (ms)' },
      { key: 'total_logical_io_reads',      label: 'Logical Reads (KB)' },
      { key: 'total_logical_io_writes',     label: 'Logical Writes (KB)' },
      { key: 'total_physical_io_reads',     label: 'Physical Reads (KB)' },
      { key: 'total_query_wait_time',       label: 'Wait Time (ms)' },
      { key: 'total_query_max_used_memory', label: 'Memory (KB)' },
      { key: 'total_rowcount',              label: 'Row Count' },
    ];
    const checkboxes: Record<string, HTMLInputElement> = {};
    const cbGroup = makeGroup(makeLabel('Show:'));
    for (const m of metrics) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `cb-${m.key}`;
      cb.checked = ['total_duration', 'total_cpu_time', 'total_query_wait_time'].includes(m.key);
      cb.addEventListener('change', () => renderChart(currentRows));
      checkboxes[m.key] = cb;
      const lbl = document.createElement('label');
      lbl.htmlFor = cb.id;
      lbl.textContent = m.label;
      lbl.style.marginLeft = '2px';
      lbl.style.marginRight = '10px';
      cbGroup.appendChild(cb);
      cbGroup.appendChild(lbl);
    }
    (app as any)._consumptionCheckboxes = checkboxes;

    toolbar.appendChild(makeGroup(...timeEls));
    toolbar.appendChild(cbGroup);
    toolbar.appendChild(refresh);

    refresh.addEventListener('click', () => {
      currentParams = {
        intervalStartTime: getStart(),
        intervalEndTime: getEnd(),
        replicaGroupId: 1,
      };
      requestData();
    });
    currentParams = { intervalStartTime: defaultMinus30d, intervalEndTime: defaultNow, replicaGroupId: 1 };
  }
}

// ---- Data requests ----

function requestData(): void {
  setStatus('loading');
  vscode.postMessage({ type: 'refresh', params: currentParams });
}

// ---- Status ----

function setStatus(type: 'loading' | 'error' | 'ok', text?: string): void {
  statusBar.classList.remove('hidden', 'loading', 'error', 'ok');
  if (type === 'loading') {
    statusBar.classList.add('loading');
    statusBar.textContent = '⏳ Loading…';
  } else if (type === 'error') {
    statusBar.classList.add('error');
    statusBar.textContent = '⚠ ' + (text ?? 'Unknown error');
  } else {
    statusBar.classList.add('hidden');
  }
}

// ---- Chart rendering ----

const CHART_COLORS = [
  '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
  '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac',
];

function renderChart(rows: Record<string, unknown>[]): void {
  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
  }

  if (reportType === 'forcedPlans') {
    chartSection.style.display = 'none';
    return;
  }

  chartSection.style.display = '';
  const canvas = document.getElementById('main-chart') as HTMLCanvasElement;

  if (reportType === 'topResources' || reportType === 'highVariation') {
    renderHorizontalBar(canvas, rows);
  } else if (reportType === 'regressed') {
    renderRegressedChart(canvas, rows);
  } else if (reportType === 'waitStats') {
    renderWaitStatsChart(canvas, rows);
  } else if (reportType === 'overallConsumption') {
    renderOverallConsumptionChart(canvas, rows);
  }
}

function sqlLabel(row: Record<string, unknown>): string {
  const name = row.object_name as string;
  const sql  = row.query_sql_text as string ?? '';
  const short = sql.replace(/\s+/g, ' ').trim().slice(0, 60);
  return name ? `[${name}] ${short}` : short;
}

function renderHorizontalBar(canvas: HTMLCanvasElement, rows: Record<string, unknown>[]): void {
  const metricKey = reportType === 'topResources' ? 'metric_value' : 'variation_duration';
  const labels = rows.map(r => sqlLabel(r));
  const data   = rows.map(r => r[metricKey] as number ?? 0);

  currentChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: reportType === 'topResources'
          ? String(currentParams.metric ?? 'Duration')
          : 'Variation',
        data,
        backgroundColor: CHART_COLORS[0] + 'cc',
        borderColor: CHART_COLORS[0],
        borderWidth: 1,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { color: 'var(--vscode-foreground)' }, grid: { color: 'var(--vscode-editorWidget-border)' } },
        y: { ticks: { color: 'var(--vscode-foreground)', font: { size: 11 } }, grid: { display: false } },
      },
      onClick: (_: unknown, elements: any[]) => {
        if (elements.length > 0) {
          const idx = elements[0].index;
          openDrilldown(rows[idx]);
        }
      },
    },
  });
}

function renderRegressedChart(canvas: HTMLCanvasElement, rows: Record<string, unknown>[]): void {
  const labels = rows.map(r => sqlLabel(r));
  currentChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Recent Duration (ms)',
          data: rows.map(r => r.total_duration_recent as number ?? 0),
          backgroundColor: CHART_COLORS[0] + 'cc',
          borderColor: CHART_COLORS[0],
          borderWidth: 1,
        },
        {
          label: 'Historical Duration (ms)',
          data: rows.map(r => r.total_duration_hist as number ?? 0),
          backgroundColor: CHART_COLORS[1] + 'cc',
          borderColor: CHART_COLORS[1],
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: 'var(--vscode-foreground)' } } },
      scales: {
        x: { ticks: { color: 'var(--vscode-foreground)', font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: 'var(--vscode-foreground)' }, grid: { color: 'var(--vscode-editorWidget-border)' } },
      },
      onClick: (_: unknown, elements: any[]) => {
        if (elements.length > 0) openDrilldown(rows[elements[0].index]);
      },
    },
  });
}

function renderWaitStatsChart(canvas: HTMLCanvasElement, rows: Record<string, unknown>[]): void {
  const labels = rows.map(r => r.wait_category_desc as string);
  const data   = rows.map(r => r.total_query_wait_time as number ?? 0);
  currentChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Wait Time (ms)',
        data,
        backgroundColor: CHART_COLORS.slice(0, rows.length).map(c => c + 'cc'),
        borderColor:     CHART_COLORS.slice(0, rows.length),
        borderWidth: 1,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { color: 'var(--vscode-foreground)' }, grid: { color: 'var(--vscode-editorWidget-border)' } },
        y: { ticks: { color: 'var(--vscode-foreground)' }, grid: { display: false } },
      },
    },
  });
}

const CONSUMPTION_METRICS = [
  { key: 'total_duration',              label: 'Duration (ms)',    color: CHART_COLORS[0] },
  { key: 'total_cpu_time',              label: 'CPU Time (ms)',    color: CHART_COLORS[1] },
  { key: 'total_logical_io_reads',      label: 'Logical Reads',   color: CHART_COLORS[2] },
  { key: 'total_logical_io_writes',     label: 'Logical Writes',  color: CHART_COLORS[3] },
  { key: 'total_physical_io_reads',     label: 'Physical Reads',  color: CHART_COLORS[4] },
  { key: 'total_query_wait_time',       label: 'Wait Time (ms)',  color: CHART_COLORS[5] },
  { key: 'total_query_max_used_memory', label: 'Memory (KB)',     color: CHART_COLORS[6] },
  { key: 'total_rowcount',              label: 'Row Count',       color: CHART_COLORS[7] },
];

function renderOverallConsumptionChart(canvas: HTMLCanvasElement, rows: Record<string, unknown>[]): void {
  const labels = rows.map(r => {
    const d = new Date(r.bucket_start as string);
    return d.toLocaleDateString();
  });

  const checkboxes = (app as any)._consumptionCheckboxes as Record<string, HTMLInputElement>;
  const datasets = CONSUMPTION_METRICS
    .filter(m => checkboxes?.[m.key]?.checked ?? true)
    .map(m => ({
      label: m.label,
      data: rows.map(r => r[m.key] as number ?? 0),
      borderColor: m.color,
      backgroundColor: m.color + '33',
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.2,
      fill: false,
    }));

  currentChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: 'var(--vscode-foreground)', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: 'var(--vscode-foreground)', font: { size: 10 } }, grid: { color: 'var(--vscode-editorWidget-border)' } },
        y: { beginAtZero: true, ticks: { color: 'var(--vscode-foreground)' }, grid: { color: 'var(--vscode-editorWidget-border)' } },
      },
    },
  });
}

// ---- Grid rendering ----

const COLUMN_DEFS: Record<string, { key: string; label: string; fmt?: (v: unknown) => string }[]> = {
  topResources: [
    { key: 'query_id',         label: 'Query ID' },
    { key: 'object_name',      label: 'Object' },
    { key: 'metric_value',     label: 'Metric',         fmt: fmtNum },
    { key: 'total_duration',   label: 'Total Dur (ms)', fmt: fmtNum },
    { key: 'count_executions', label: 'Executions',     fmt: fmtInt },
    { key: 'num_plans',        label: 'Plans',          fmt: fmtInt },
    { key: 'query_sql_text',   label: 'SQL Text' },
  ],
  regressed: [
    { key: 'query_id',                       label: 'Query ID' },
    { key: 'object_name',                    label: 'Object' },
    { key: 'additional_duration_workload',   label: 'Extra Duration',  fmt: fmtNum },
    { key: 'total_duration_recent',          label: 'Recent (ms)',     fmt: fmtNum },
    { key: 'total_duration_hist',            label: 'History (ms)',    fmt: fmtNum },
    { key: 'count_executions_recent',        label: 'Exec (Recent)',   fmt: fmtInt },
    { key: 'count_executions_hist',          label: 'Exec (History)',  fmt: fmtInt },
    { key: 'num_plans',                      label: 'Plans',           fmt: fmtInt },
    { key: 'query_sql_text',                 label: 'SQL Text' },
  ],
  highVariation: [
    { key: 'query_id',          label: 'Query ID' },
    { key: 'object_name',       label: 'Object' },
    { key: 'variation_duration', label: 'Variation',      fmt: fmtNum },
    { key: 'stdev_duration',    label: 'StdDev (ms)',     fmt: fmtNum },
    { key: 'avg_duration',      label: 'Avg (ms)',        fmt: fmtNum },
    { key: 'count_executions',  label: 'Executions',      fmt: fmtInt },
    { key: 'num_plans',         label: 'Plans',           fmt: fmtInt },
    { key: 'query_sql_text',    label: 'SQL Text' },
  ],
  waitStats: [
    { key: 'wait_category_desc',    label: 'Wait Type' },
    { key: 'total_query_wait_time', label: 'Total (ms)',   fmt: fmtNum },
    { key: 'avg_query_wait_time',   label: 'Avg (ms)',     fmt: fmtNum },
    { key: 'max_query_wait_time',   label: 'Max (ms)',     fmt: fmtNum },
    { key: 'min_query_wait_time',   label: 'Min (ms)',     fmt: fmtNum },
    { key: 'stdev_query_wait_time', label: 'StdDev (ms)',  fmt: fmtNum },
    { key: 'count_executions',      label: 'Executions',   fmt: fmtInt },
  ],
  forcedPlans: [
    { key: 'query_id',                     label: 'Query ID' },
    { key: 'object_name',                  label: 'Object' },
    { key: 'plan_id',                      label: 'Plan ID' },
    { key: 'last_execution_time',          label: 'Last Executed', fmt: fmtDate },
    { key: 'force_failure_count',          label: 'Force Failures', fmt: fmtInt },
    { key: 'last_force_failure_reason_desc', label: 'Last Failure Reason' },
    { key: 'num_plans',                    label: 'Plans',         fmt: fmtInt },
    { key: 'query_sql_text',               label: 'SQL Text' },
  ],
  overallConsumption: [
    { key: 'bucket_start',                 label: 'Date',           fmt: fmtDate },
    { key: 'total_count_executions',       label: 'Executions',     fmt: fmtInt },
    { key: 'total_duration',               label: 'Duration (ms)',  fmt: fmtNum },
    { key: 'total_cpu_time',               label: 'CPU (ms)',       fmt: fmtNum },
    { key: 'total_logical_io_reads',       label: 'Log Reads (KB)', fmt: fmtNum },
    { key: 'total_physical_io_reads',      label: 'Phys Reads (KB)',fmt: fmtNum },
    { key: 'total_query_wait_time',        label: 'Wait (ms)',      fmt: fmtNum },
    { key: 'total_query_max_used_memory',  label: 'Memory (KB)',    fmt: fmtNum },
    { key: 'total_rowcount',               label: 'Row Count',      fmt: fmtInt },
  ],
};

function fmtNum(v: unknown): string {
  const n = Number(v);
  return isNaN(n) ? '' : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtInt(v: unknown): string {
  const n = Number(v);
  return isNaN(n) ? '' : n.toLocaleString();
}
function fmtDate(v: unknown): string {
  if (!v) return '';
  const d = new Date(v as string);
  return d.toLocaleString();
}

function renderGrid(rows: Record<string, unknown>[]): void {
  const cols = COLUMN_DEFS[reportType] ?? [];
  if (cols.length === 0 || rows.length === 0) {
    gridContainer.innerHTML = '<div class="qs-empty">No data returned.</div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'qs-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const col of cols) {
    const th = document.createElement('th');
    th.textContent = col.label;
    headerRow.appendChild(th);
  }
  if (reportType === 'forcedPlans') {
    const th = document.createElement('th');
    th.textContent = 'Actions';
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const tr = document.createElement('tr');
    tr.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      openDrilldown(row);
    });

    for (const col of cols) {
      const td = document.createElement('td');
      const raw = row[col.key];
      if (col.key === 'query_sql_text') {
        td.className = 'qs-sql-cell';
        td.title = String(raw ?? '');
        td.textContent = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) + (String(raw ?? '').length > 80 ? '…' : '');
      } else {
        td.textContent = col.fmt ? col.fmt(raw) : String(raw ?? '');
      }
      tr.appendChild(td);
    }

    if (reportType === 'forcedPlans') {
      const td = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'qs-btn qs-btn-sm qs-btn-danger';
      btn.textContent = 'Remove Forced Plan';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'removeForcedPlan', queryId: row.query_id, planId: row.plan_id });
      });
      td.appendChild(btn);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  gridContainer.innerHTML = '';
  gridContainer.appendChild(table);
}

// ---- Drilldown ----

function openDrilldown(row: Record<string, unknown>): void {
  const queryId = row.query_id as number;
  const planId  = row.plan_id  as number ?? 0;
  if (!queryId) return;

  currentDrilldownQueryId = queryId;
  currentDrilldownPlanId  = planId;

  drilldownTitle.textContent = `Query ${queryId} — Execution Statistics & Plan`;
  drilldownSection.classList.remove('hidden');
  planCanvas.innerHTML = '<div class="qs-plan-loading">Loading plan…</div>';
  forcePlanLabel.style.display = 'none';

  vscode.postMessage({
    type: 'drilldown',
    queryId,
    planId,
    params: currentParams,
  });
}

drilldownClose.addEventListener('click', () => {
  drilldownSection.classList.add('hidden');
  if (drilldownChart) { drilldownChart.destroy(); drilldownChart = null; }
  planCanvas.innerHTML = '';
});

forcePlanCheckbox.addEventListener('change', () => {
  if (currentDrilldownQueryId !== null && currentDrilldownPlanId !== null) {
    const type = forcePlanCheckbox.checked ? 'forcePlan' : 'removeForcedPlan';
    vscode.postMessage({ type, queryId: currentDrilldownQueryId, planId: currentDrilldownPlanId });
  }
});

function renderDrilldownChart(rows: Record<string, unknown>[]): void {
  if (drilldownChart) { drilldownChart.destroy(); drilldownChart = null; }

  const canvas = document.getElementById('drilldown-chart') as HTMLCanvasElement;
  const planIds = [...new Set(rows.map(r => r.plan_id as number))];
  availablePlanIds = planIds;

  const datasets = planIds.map((pid, idx) => {
    const planRows = rows.filter(r => r.plan_id === pid).sort((a, b) =>
      new Date(a.bucket_start as string).getTime() - new Date(b.bucket_start as string).getTime()
    );
    return {
      label: `Plan ${pid}`,
      data: planRows.map(r => ({ x: new Date(r.bucket_start as string).toLocaleString(), y: r.avg_duration as number })),
      borderColor: CHART_COLORS[idx % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] + '33',
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.2,
      fill: false,
    };
  });

  const allBuckets = [...new Set(rows.map(r => new Date(r.bucket_start as string).toLocaleString()))].sort();

  drilldownChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: allBuckets,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: 'var(--vscode-foreground)',
            font: { size: 11 },
          },
          onClick: (_evt: unknown, legendItem: any) => {
            // Extract plan ID from the legend label ("Plan 54" -> 54)
            const match = String(legendItem.text ?? '').match(/Plan\s+(\d+)/);
            if (match) {
              const pid = parseInt(match[1], 10);
              requestPlan(pid);
            }
          },
          onHover: (_evt: unknown, _legendItem: any, _legend: any) => {
            canvas.style.cursor = 'pointer';
          },
          onLeave: (_evt: unknown, _legendItem: any, _legend: any) => {
            canvas.style.cursor = '';
          },
        },
      },
      scales: {
        x: { ticks: { color: 'var(--vscode-foreground)', font: { size: 10 } }, grid: { color: 'var(--vscode-editorWidget-border)' } },
        y: { beginAtZero: true, title: { display: true, text: 'Avg Duration (ms)', color: 'var(--vscode-foreground)' }, ticks: { color: 'var(--vscode-foreground)' }, grid: { color: 'var(--vscode-editorWidget-border)' } },
      },
    },
  });

  // Update legend styling to show active plan
  updateLegendActiveState();
}

function requestPlan(planId: number): void {
  if (!currentDrilldownQueryId) return;
  currentDrilldownPlanId = planId;
  planCanvas.innerHTML = '<div class="qs-plan-loading">Loading plan…</div>';
  forcePlanLabel.style.display = 'none';
  vscode.postMessage({ type: 'getPlan', queryId: currentDrilldownQueryId, planId });
  updateLegendActiveState();
}

function updateLegendActiveState(): void {
  if (!drilldownChart) return;
  const datasets = drilldownChart.data.datasets;
  for (let i = 0; i < datasets.length; i++) {
    const pid = availablePlanIds[i];
    const isActive = pid === currentDrilldownPlanId;
    datasets[i].borderWidth = isActive ? 4 : 2;
    datasets[i].pointRadius = isActive ? 5 : 3;
  }
  drilldownChart.update();
}

// ---- Plan viewer ----

function renderPlan(xml: string, isForcedPlan: boolean): void {
  const root = parsePlan(xml);
  if (!root) {
    planCanvas.innerHTML = '<div class="qs-plan-loading">Could not parse query plan XML.</div>';
    return;
  }
  currentPlanRoot = root;
  const svgHtml = renderPlanSvg(root);
  planCanvas.innerHTML = svgHtml;
  planScale = 1;

  // Attach tooltip listeners to both nodes and edges
  planCanvas.querySelectorAll('.plan-node, .plan-edge').forEach(node => {
    node.addEventListener('mouseenter', (e) => {
      const target = e.currentTarget as HTMLElement;
      const info = target.dataset.tooltip ?? '';
      planTooltip.innerHTML = info;
      planTooltip.classList.remove('hidden');
    });
    node.addEventListener('mouseleave', () => {
      planTooltip.classList.add('hidden');
    });
    node.addEventListener('mousemove', (e: Event) => {
      const me = e as MouseEvent;
      const rect = planContainer.getBoundingClientRect();
      planTooltip.style.left = (me.clientX - rect.left + 12) + 'px';
      planTooltip.style.top  = (me.clientY - rect.top  + 12) + 'px';
    });
  });

  // Force plan checkbox
  forcePlanLabel.style.display = '';
  forcePlanCheckbox.checked = isForcedPlan;
}

planZoomIn.addEventListener('click', () => {
  planScale = Math.min(planScale * 1.25, 5);
  (planCanvas as HTMLElement).style.transform = `scale(${planScale})`;
  (planCanvas as HTMLElement).style.transformOrigin = 'top left';
});

planZoomOut.addEventListener('click', () => {
  planScale = Math.max(planScale / 1.25, 0.2);
  (planCanvas as HTMLElement).style.transform = `scale(${planScale})`;
  (planCanvas as HTMLElement).style.transformOrigin = 'top left';
});

planZoomFit.addEventListener('click', () => {
  planScale = 1;
  (planCanvas as HTMLElement).style.transform = '';
});

// ---- Message handler ----

window.addEventListener('message', (event) => {
  const msg = event.data as Record<string, unknown>;
  switch (msg.type) {
    case 'loading':
      setStatus('loading');
      break;

    case 'data': {
      currentRows = (msg.rows as Record<string, unknown>[]) ?? [];
      setStatus('ok');
      renderChart(currentRows);
      renderGrid(currentRows);
      break;
    }

    case 'error':
      setStatus('error', msg.message as string);
      break;

    case 'drilldownData': {
      const rows = (msg.rows as Record<string, unknown>[]) ?? [];
      renderDrilldownChart(rows);
      break;
    }

    case 'planData': {
      const xml = msg.xml as string;
      if (msg.planId) {
        currentDrilldownPlanId = msg.planId as number;
        updateLegendActiveState();
      }
      if (xml) {
        renderPlan(xml, Boolean(msg.isForcedPlan));
      } else {
        planCanvas.innerHTML = '<div class="qs-plan-loading">No query plan available for this query.</div>';
      }
      break;
    }

    case 'forcePlanResult':
    case 'removeForcedPlanResult':
      // Refresh data after plan change
      requestData();
      break;
  }
});

// ---- Init ----

buildToolbar();
requestData();
