"use strict";
(() => {
  // webview-src/planRenderer.ts
  var NODE_W = 130;
  var NODE_H = 60;
  var H_GAP = 30;
  var V_GAP = 50;
  function parsePlan(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      return null;
    }
    const rootRelOp = doc.querySelector("StmtSimple > QueryPlan > RelOp") ?? doc.querySelector("StmtCursor > QueryPlan > RelOp") ?? doc.querySelector("RelOp");
    if (!rootRelOp) {
      return null;
    }
    const rootCost = parseFloat(rootRelOp.getAttribute("TotalSubtreeCost") ?? "1") || 1;
    return parseRelOp(rootRelOp, rootCost);
  }
  function parseRelOp(el, rootCost) {
    const totalCost = parseFloat(el.getAttribute("TotalSubtreeCost") ?? "0");
    const children = [];
    for (const child of el.children) {
      const nested = child.querySelectorAll(":scope > RelOp");
      for (const n of nested) {
        children.push(parseRelOp(n, rootCost));
      }
      if (child.tagName !== "RelOp") {
        for (const relOp of child.querySelectorAll("RelOp")) {
          if (relOp.parentElement === child) {
            children.push(parseRelOp(relOp, rootCost));
          }
        }
      }
    }
    const seen = /* @__PURE__ */ new Set();
    const uniqueChildren = [];
    const allRelOps = el.querySelectorAll(":scope > * > RelOp");
    for (const relOp of allRelOps) {
      if (!seen.has(relOp)) {
        seen.add(relOp);
        uniqueChildren.push(parseRelOp(relOp, rootCost));
      }
    }
    const node = {
      physicalOp: el.getAttribute("PhysicalOp") ?? "Unknown",
      logicalOp: el.getAttribute("LogicalOp") ?? "",
      estimateRows: parseFloat(el.getAttribute("EstimateRows") ?? "0"),
      estimateCpu: parseFloat(el.getAttribute("EstimateCPU") ?? "0"),
      estimateIo: parseFloat(el.getAttribute("EstimateIO") ?? "0"),
      estimateRebinds: parseFloat(el.getAttribute("EstimateRebinds") ?? "0"),
      estimateRewinds: parseFloat(el.getAttribute("EstimateRewinds") ?? "0"),
      avgRowSize: parseFloat(el.getAttribute("AvgRowSize") ?? "0"),
      totalSubtreeCost: totalCost,
      relOpCost: rootCost > 0 ? totalCost / rootCost : 0,
      parallelism: el.getAttribute("Parallel") === "1",
      nodeId: parseInt(el.getAttribute("NodeId") ?? "0", 10),
      children: uniqueChildren.length > 0 ? uniqueChildren : children,
      x: 0,
      y: 0,
      width: NODE_W,
      height: NODE_H
    };
    return node;
  }
  function computeLayout(node) {
    if (node.children.length === 0) {
      node.width = NODE_W;
      node.height = NODE_H;
      return { w: NODE_W, h: NODE_H };
    }
    const childBoxes = node.children.map(computeLayout);
    const totalChildW = childBoxes.reduce((s, b) => s + b.w, 0) + H_GAP * (node.children.length - 1);
    const maxChildH = Math.max(...childBoxes.map((b) => b.h));
    node.width = Math.max(NODE_W, totalChildW);
    node.height = NODE_H;
    return { w: node.width, h: NODE_H + V_GAP + maxChildH };
  }
  function assignPositions(node, x, y) {
    node.x = x + (node.width - NODE_W) / 2;
    node.y = y;
    if (node.children.length === 0) {
      return;
    }
    const totalChildW = node.children.reduce((s, c) => s + c.width, 0) + H_GAP * (node.children.length - 1);
    let cx = x + (node.width - totalChildW) / 2;
    for (const child of node.children) {
      assignPositions(child, cx, y + NODE_H + V_GAP);
      cx += child.width + H_GAP;
    }
  }
  function treeBounds(node) {
    let minX = node.x, minY = node.y, maxX = node.x + NODE_W, maxY = node.y + NODE_H;
    for (const c of node.children) {
      const b = treeBounds(c);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    return { minX, minY, maxX, maxY };
  }
  function costColor(fraction) {
    const hue = Math.round((1 - Math.min(fraction, 1)) * 120);
    return `hsl(${hue}, 70%, 45%)`;
  }
  function escAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function truncate(s, maxLen) {
    return s.length > maxLen ? s.slice(0, maxLen - 1) + "\u2026" : s;
  }
  function renderNodeSvg(node, lines, onTooltip) {
    const x = node.x;
    const y = node.y;
    const w = NODE_W;
    const h = NODE_H;
    const pct = (node.relOpCost * 100).toFixed(1);
    const fillColor = costColor(node.relOpCost);
    const textColor = "#fff";
    const tooltipInfo = [
      `Physical Op: ${node.physicalOp}`,
      `Logical Op: ${node.logicalOp}`,
      `Est. Rows: ${node.estimateRows.toFixed(0)}`,
      `Est. CPU: ${node.estimateCpu.toExponential(2)}`,
      `Est. I/O: ${node.estimateIo.toExponential(2)}`,
      `Subtree Cost: ${node.totalSubtreeCost.toFixed(4)}`,
      `Cost %: ${pct}%`,
      `Parallelism: ${node.parallelism ? "Yes" : "No"}`
    ].join("\n");
    lines.push(
      `<g class="plan-node" data-node-id="${node.nodeId}" data-tooltip="${escAttr(tooltipInfo)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fillColor}" /><text x="${x + w / 2}" y="${y + 18}" text-anchor="middle" fill="${textColor}" font-size="11" font-weight="600">${escAttr(truncate(node.physicalOp, 18))}</text><text x="${x + w / 2}" y="${y + 32}" text-anchor="middle" fill="${textColor}" font-size="10" opacity="0.85">${escAttr(truncate(node.logicalOp, 20))}</text><text x="${x + w / 2}" y="${y + 48}" text-anchor="middle" fill="${textColor}" font-size="10" opacity="0.8">Cost: ${pct}%  Rows: ${node.estimateRows.toFixed(0)}</text></g>`
    );
    for (const child of node.children) {
      const x1 = x + w / 2;
      const y1 = y + h;
      const x2 = child.x + NODE_W / 2;
      const y2 = child.y;
      const cy = (y1 + y2) / 2;
      lines.push(
        `<path d="M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}" fill="none" stroke="var(--vscode-editorWidget-border,#666)" stroke-width="1.5" opacity="0.7"/>`
      );
      renderNodeSvg(child, lines, onTooltip);
    }
  }
  function renderPlanSvg(root) {
    computeLayout(root);
    assignPositions(root, 0, 0);
    const bounds = treeBounds(root);
    const pad = 20;
    const svgW = bounds.maxX - bounds.minX + pad * 2;
    const svgH = bounds.maxY - bounds.minY + pad * 2;
    const shiftNodes = (n) => {
      n.x -= bounds.minX - pad;
      n.y -= bounds.minY - pad;
      for (const c of n.children) {
        shiftNodes(c);
      }
    };
    shiftNodes(root);
    const lines = [];
    renderNodeSvg(root, lines, () => {
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="display:block">
  <style>
    .plan-node rect { cursor: pointer; transition: opacity 0.15s; }
    .plan-node:hover rect { opacity: 0.85; }
    .plan-node text { pointer-events: none; font-family: var(--vscode-font-family, monospace); }
  </style>
  ${lines.join("\n  ")}
</svg>`;
  }

  // webview-src/main.ts
  var vscode = acquireVsCodeApi();
  var app = document.getElementById("app");
  var toolbar = document.getElementById("toolbar");
  var statusBar = document.getElementById("status-bar");
  var mainContent = document.getElementById("main-content");
  var chartSection = document.getElementById("chart-section");
  var gridContainer = document.getElementById("grid-container");
  var drilldownSection = document.getElementById("drilldown-section");
  var drilldownTitle = document.getElementById("drilldown-title");
  var drilldownClose = document.getElementById("drilldown-close");
  var planContainer = document.getElementById("plan-container");
  var planCanvas = document.getElementById("plan-canvas");
  var planTooltip = document.getElementById("plan-tooltip");
  var forcePlanBtn = document.getElementById("force-plan-btn");
  var unforcePlanBtn = document.getElementById("unforce-plan-btn");
  var planZoomFit = document.getElementById("plan-zoom-fit");
  var planZoomIn = document.getElementById("plan-zoom-in");
  var planZoomOut = document.getElementById("plan-zoom-out");
  var reportType = app.dataset.reportType;
  var defaultNow = app.dataset.defaultNow;
  var defaultMinus1h = app.dataset.defaultMinus1h;
  var defaultMinus7d = app.dataset.defaultMinus7d;
  var defaultMinus30d = app.dataset.defaultMinus30d;
  var currentParams = {};
  var currentRows = [];
  var currentChart = null;
  var drilldownChart = null;
  var planScale = 1;
  var currentPlanRoot = null;
  var currentDrilldownQueryId = null;
  var currentDrilldownPlanId = null;
  function fmtDateTimeLocal(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function makeLabel(text) {
    const l = document.createElement("label");
    l.className = "qs-label";
    l.textContent = text;
    return l;
  }
  function makeInput(type, value, attrs) {
    const i = document.createElement("input");
    i.type = type;
    i.value = value;
    i.className = "qs-input";
    if (attrs)
      for (const [k, v] of Object.entries(attrs))
        i.setAttribute(k, v);
    return i;
  }
  function makeSelect(options, selected) {
    const s = document.createElement("select");
    s.className = "qs-select";
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === selected)
        opt.selected = true;
      s.appendChild(opt);
    }
    return s;
  }
  function makeRefreshBtn() {
    const b = document.createElement("button");
    b.textContent = "\u21BB Refresh";
    b.className = "qs-btn qs-btn-primary";
    return b;
  }
  function makeGroup(...children) {
    const g = document.createElement("div");
    g.className = "qs-toolbar-group";
    for (const c of children)
      g.appendChild(c);
    return g;
  }
  var TIME_PRESETS = [
    { value: "1h", label: "Last 1 hour" },
    { value: "4h", label: "Last 4 hours" },
    { value: "24h", label: "Last 24 hours" },
    { value: "7d", label: "Last 7 days" },
    { value: "30d", label: "Last 30 days" },
    { value: "custom", label: "Custom\u2026" }
  ];
  function timePresetToDates(preset) {
    const now = /* @__PURE__ */ new Date();
    const ms = (h) => h * 36e5;
    switch (preset) {
      case "1h":
        return { start: new Date(Date.now() - ms(1)), end: now };
      case "4h":
        return { start: new Date(Date.now() - ms(4)), end: now };
      case "24h":
        return { start: new Date(Date.now() - ms(24)), end: now };
      case "7d":
        return { start: new Date(Date.now() - ms(168)), end: now };
      case "30d":
        return { start: new Date(Date.now() - ms(720)), end: now };
      default:
        return { start: new Date(Date.now() - ms(1)), end: now };
    }
  }
  function buildTimeRangeControls(defaultPreset) {
    const preset = makeSelect(TIME_PRESETS, defaultPreset);
    const startInput = makeInput("datetime-local", fmtDateTimeLocal(defaultMinus1h), { style: "display:none" });
    const endInput = makeInput("datetime-local", fmtDateTimeLocal(defaultNow), { style: "display:none" });
    const updateVisibility = () => {
      const custom = preset.value === "custom";
      startInput.style.display = custom ? "" : "none";
      endInput.style.display = custom ? "" : "none";
    };
    preset.addEventListener("change", updateVisibility);
    return {
      elements: [makeLabel("Time Range:"), preset, startInput, makeLabel("to"), endInput],
      getStart: () => {
        if (preset.value === "custom")
          return new Date(startInput.value).toISOString();
        return timePresetToDates(preset.value).start.toISOString();
      },
      getEnd: () => {
        if (preset.value === "custom")
          return new Date(endInput.value).toISOString();
        return (/* @__PURE__ */ new Date()).toISOString();
      }
    };
  }
  function buildToolbar() {
    toolbar.innerHTML = "";
    const refresh = makeRefreshBtn();
    if (reportType === "topResources") {
      const { elements: timeEls, getStart, getEnd } = buildTimeRangeControls("1h");
      const rowCountInput = makeInput("number", "25", { min: "1", max: "200", style: "width:70px" });
      const metricSelect = makeSelect([
        { value: "duration", label: "Duration (ms)" },
        { value: "cpu", label: "CPU Time (ms)" },
        { value: "logicalReads", label: "Logical IO Reads" },
        { value: "logicalWrites", label: "Logical IO Writes" },
        { value: "physicalReads", label: "Physical IO Reads" },
        { value: "memory", label: "Memory (KB)" },
        { value: "rowcount", label: "Row Count" }
      ], "duration");
      toolbar.appendChild(makeGroup(...timeEls));
      toolbar.appendChild(makeGroup(makeLabel("Metric:"), metricSelect));
      toolbar.appendChild(makeGroup(makeLabel("Top:"), rowCountInput));
      toolbar.appendChild(refresh);
      refresh.addEventListener("click", () => {
        currentParams = {
          intervalStartTime: getStart(),
          intervalEndTime: getEnd(),
          resultsRowCount: parseInt(rowCountInput.value, 10) || 25,
          metric: metricSelect.value,
          replicaGroupId: 1
        };
        requestData();
      });
      currentParams = {
        intervalStartTime: defaultMinus1h,
        intervalEndTime: defaultNow,
        resultsRowCount: 25,
        metric: "duration",
        replicaGroupId: 1
      };
    } else if (reportType === "regressed") {
      const recentPreset = makeSelect(TIME_PRESETS.slice(0, 5), "1h");
      const histPreset = makeSelect([
        { value: "7d", label: "Last 7 days (history)" },
        { value: "30d", label: "Last 30 days (history)" }
      ], "7d");
      const minExecInput = makeInput("number", "1", { min: "1", style: "width:60px" });
      const rowCountInput = makeInput("number", "25", { min: "1", max: "200", style: "width:70px" });
      toolbar.appendChild(makeGroup(makeLabel("Recent Period:"), recentPreset));
      toolbar.appendChild(makeGroup(makeLabel("History Period:"), histPreset));
      toolbar.appendChild(makeGroup(makeLabel("Min Executions:"), minExecInput));
      toolbar.appendChild(makeGroup(makeLabel("Top:"), rowCountInput));
      toolbar.appendChild(refresh);
      const getParams = () => {
        const recentDates = timePresetToDates(recentPreset.value);
        const histDates = timePresetToDates(histPreset.value);
        return {
          recentStartTime: recentDates.start.toISOString(),
          recentEndTime: recentDates.end.toISOString(),
          historyStartTime: histDates.start.toISOString(),
          historyEndTime: histDates.end.toISOString(),
          minExecCount: parseInt(minExecInput.value, 10) || 1,
          resultsRowCount: parseInt(rowCountInput.value, 10) || 25,
          replicaGroupId: 1
        };
      };
      refresh.addEventListener("click", () => {
        currentParams = getParams();
        requestData();
      });
      currentParams = getParams();
    } else if (reportType === "highVariation") {
      const { elements: timeEls, getStart, getEnd } = buildTimeRangeControls("1h");
      const rowCountInput = makeInput("number", "25", { min: "1", max: "200", style: "width:70px" });
      toolbar.appendChild(makeGroup(...timeEls));
      toolbar.appendChild(makeGroup(makeLabel("Top:"), rowCountInput));
      toolbar.appendChild(refresh);
      refresh.addEventListener("click", () => {
        currentParams = {
          intervalStartTime: getStart(),
          intervalEndTime: getEnd(),
          resultsRowCount: parseInt(rowCountInput.value, 10) || 25,
          replicaGroupId: 1
        };
        requestData();
      });
      currentParams = { intervalStartTime: defaultMinus1h, intervalEndTime: defaultNow, resultsRowCount: 25, replicaGroupId: 1 };
    } else if (reportType === "waitStats") {
      const { elements: timeEls, getStart, getEnd } = buildTimeRangeControls("1h");
      const rowCountInput = makeInput("number", "10", { min: "1", max: "100", style: "width:70px" });
      toolbar.appendChild(makeGroup(...timeEls));
      toolbar.appendChild(makeGroup(makeLabel("Top:"), rowCountInput));
      toolbar.appendChild(refresh);
      refresh.addEventListener("click", () => {
        currentParams = {
          intervalStartTime: getStart(),
          intervalEndTime: getEnd(),
          resultsRowCount: parseInt(rowCountInput.value, 10) || 10,
          replicaGroupId: 1
        };
        requestData();
      });
      currentParams = { intervalStartTime: defaultMinus1h, intervalEndTime: defaultNow, resultsRowCount: 10, replicaGroupId: 1 };
    } else if (reportType === "forcedPlans") {
      toolbar.appendChild(refresh);
      refresh.addEventListener("click", () => {
        currentParams = { replicaGroupId: 1 };
        requestData();
      });
      currentParams = { replicaGroupId: 1 };
    } else if (reportType === "overallConsumption") {
      const { elements: timeEls, getStart, getEnd } = buildTimeRangeControls("30d");
      const metrics = [
        { key: "total_duration", label: "Duration (ms)" },
        { key: "total_cpu_time", label: "CPU Time (ms)" },
        { key: "total_logical_io_reads", label: "Logical Reads (KB)" },
        { key: "total_logical_io_writes", label: "Logical Writes (KB)" },
        { key: "total_physical_io_reads", label: "Physical Reads (KB)" },
        { key: "total_query_wait_time", label: "Wait Time (ms)" },
        { key: "total_query_max_used_memory", label: "Memory (KB)" },
        { key: "total_rowcount", label: "Row Count" }
      ];
      const checkboxes = {};
      const cbGroup = makeGroup(makeLabel("Show:"));
      for (const m of metrics) {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = `cb-${m.key}`;
        cb.checked = ["total_duration", "total_cpu_time", "total_query_wait_time"].includes(m.key);
        cb.addEventListener("change", () => renderChart(currentRows));
        checkboxes[m.key] = cb;
        const lbl = document.createElement("label");
        lbl.htmlFor = cb.id;
        lbl.textContent = m.label;
        lbl.style.marginLeft = "2px";
        lbl.style.marginRight = "10px";
        cbGroup.appendChild(cb);
        cbGroup.appendChild(lbl);
      }
      app._consumptionCheckboxes = checkboxes;
      toolbar.appendChild(makeGroup(...timeEls));
      toolbar.appendChild(cbGroup);
      toolbar.appendChild(refresh);
      refresh.addEventListener("click", () => {
        currentParams = {
          intervalStartTime: getStart(),
          intervalEndTime: getEnd(),
          replicaGroupId: 1
        };
        requestData();
      });
      currentParams = { intervalStartTime: defaultMinus30d, intervalEndTime: defaultNow, replicaGroupId: 1 };
    }
  }
  function requestData() {
    setStatus("loading");
    vscode.postMessage({ type: "refresh", params: currentParams });
  }
  function setStatus(type, text) {
    statusBar.classList.remove("hidden", "loading", "error", "ok");
    if (type === "loading") {
      statusBar.classList.add("loading");
      statusBar.textContent = "\u23F3 Loading\u2026";
    } else if (type === "error") {
      statusBar.classList.add("error");
      statusBar.textContent = "\u26A0 " + (text ?? "Unknown error");
    } else {
      statusBar.classList.add("hidden");
    }
  }
  var CHART_COLORS = [
    "#4e79a7",
    "#f28e2b",
    "#e15759",
    "#76b7b2",
    "#59a14f",
    "#edc948",
    "#b07aa1",
    "#ff9da7",
    "#9c755f",
    "#bab0ac"
  ];
  function renderChart(rows) {
    if (currentChart) {
      currentChart.destroy();
      currentChart = null;
    }
    if (reportType === "forcedPlans") {
      chartSection.style.display = "none";
      return;
    }
    chartSection.style.display = "";
    const canvas = document.getElementById("main-chart");
    if (reportType === "topResources" || reportType === "highVariation") {
      renderHorizontalBar(canvas, rows);
    } else if (reportType === "regressed") {
      renderRegressedChart(canvas, rows);
    } else if (reportType === "waitStats") {
      renderWaitStatsChart(canvas, rows);
    } else if (reportType === "overallConsumption") {
      renderOverallConsumptionChart(canvas, rows);
    }
  }
  function sqlLabel(row) {
    const name = row.object_name;
    const sql = row.query_sql_text ?? "";
    const short = sql.replace(/\s+/g, " ").trim().slice(0, 60);
    return name ? `[${name}] ${short}` : short;
  }
  function renderHorizontalBar(canvas, rows) {
    const metricKey = reportType === "topResources" ? "metric_value" : "variation_duration";
    const labels = rows.map((r) => sqlLabel(r));
    const data = rows.map((r) => r[metricKey] ?? 0);
    currentChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: reportType === "topResources" ? String(currentParams.metric ?? "Duration") : "Variation",
          data,
          backgroundColor: CHART_COLORS[0] + "cc",
          borderColor: CHART_COLORS[0],
          borderWidth: 1
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: "var(--vscode-foreground)" }, grid: { color: "var(--vscode-editorWidget-border)" } },
          y: { ticks: { color: "var(--vscode-foreground)", font: { size: 11 } }, grid: { display: false } }
        },
        onClick: (_, elements) => {
          if (elements.length > 0) {
            const idx = elements[0].index;
            openDrilldown(rows[idx]);
          }
        }
      }
    });
  }
  function renderRegressedChart(canvas, rows) {
    const labels = rows.map((r) => sqlLabel(r));
    currentChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Recent Duration (ms)",
            data: rows.map((r) => r.total_duration_recent ?? 0),
            backgroundColor: CHART_COLORS[0] + "cc",
            borderColor: CHART_COLORS[0],
            borderWidth: 1
          },
          {
            label: "Historical Duration (ms)",
            data: rows.map((r) => r.total_duration_hist ?? 0),
            backgroundColor: CHART_COLORS[1] + "cc",
            borderColor: CHART_COLORS[1],
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "var(--vscode-foreground)" } } },
        scales: {
          x: { ticks: { color: "var(--vscode-foreground)", font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: "var(--vscode-foreground)" }, grid: { color: "var(--vscode-editorWidget-border)" } }
        },
        onClick: (_, elements) => {
          if (elements.length > 0)
            openDrilldown(rows[elements[0].index]);
        }
      }
    });
  }
  function renderWaitStatsChart(canvas, rows) {
    const labels = rows.map((r) => r.wait_category_desc);
    const data = rows.map((r) => r.total_query_wait_time ?? 0);
    currentChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Total Wait Time (ms)",
          data,
          backgroundColor: CHART_COLORS.slice(0, rows.length).map((c) => c + "cc"),
          borderColor: CHART_COLORS.slice(0, rows.length),
          borderWidth: 1
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: "var(--vscode-foreground)" }, grid: { color: "var(--vscode-editorWidget-border)" } },
          y: { ticks: { color: "var(--vscode-foreground)" }, grid: { display: false } }
        }
      }
    });
  }
  var CONSUMPTION_METRICS = [
    { key: "total_duration", label: "Duration (ms)", color: CHART_COLORS[0] },
    { key: "total_cpu_time", label: "CPU Time (ms)", color: CHART_COLORS[1] },
    { key: "total_logical_io_reads", label: "Logical Reads", color: CHART_COLORS[2] },
    { key: "total_logical_io_writes", label: "Logical Writes", color: CHART_COLORS[3] },
    { key: "total_physical_io_reads", label: "Physical Reads", color: CHART_COLORS[4] },
    { key: "total_query_wait_time", label: "Wait Time (ms)", color: CHART_COLORS[5] },
    { key: "total_query_max_used_memory", label: "Memory (KB)", color: CHART_COLORS[6] },
    { key: "total_rowcount", label: "Row Count", color: CHART_COLORS[7] }
  ];
  function renderOverallConsumptionChart(canvas, rows) {
    const labels = rows.map((r) => {
      const d = new Date(r.bucket_start);
      return d.toLocaleDateString();
    });
    const checkboxes = app._consumptionCheckboxes;
    const datasets = CONSUMPTION_METRICS.filter((m) => checkboxes?.[m.key]?.checked ?? true).map((m) => ({
      label: m.label,
      data: rows.map((r) => r[m.key] ?? 0),
      borderColor: m.color,
      backgroundColor: m.color + "33",
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.2,
      fill: false
    }));
    currentChart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "var(--vscode-foreground)", font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: "var(--vscode-foreground)", font: { size: 10 } }, grid: { color: "var(--vscode-editorWidget-border)" } },
          y: { beginAtZero: true, ticks: { color: "var(--vscode-foreground)" }, grid: { color: "var(--vscode-editorWidget-border)" } }
        }
      }
    });
  }
  var COLUMN_DEFS = {
    topResources: [
      { key: "query_id", label: "Query ID" },
      { key: "object_name", label: "Object" },
      { key: "metric_value", label: "Metric", fmt: fmtNum },
      { key: "total_duration", label: "Total Dur (ms)", fmt: fmtNum },
      { key: "count_executions", label: "Executions", fmt: fmtInt },
      { key: "num_plans", label: "Plans", fmt: fmtInt },
      { key: "query_sql_text", label: "SQL Text" }
    ],
    regressed: [
      { key: "query_id", label: "Query ID" },
      { key: "object_name", label: "Object" },
      { key: "additional_duration_workload", label: "Extra Duration", fmt: fmtNum },
      { key: "total_duration_recent", label: "Recent (ms)", fmt: fmtNum },
      { key: "total_duration_hist", label: "History (ms)", fmt: fmtNum },
      { key: "count_executions_recent", label: "Exec (Recent)", fmt: fmtInt },
      { key: "count_executions_hist", label: "Exec (History)", fmt: fmtInt },
      { key: "num_plans", label: "Plans", fmt: fmtInt },
      { key: "query_sql_text", label: "SQL Text" }
    ],
    highVariation: [
      { key: "query_id", label: "Query ID" },
      { key: "object_name", label: "Object" },
      { key: "variation_duration", label: "Variation", fmt: fmtNum },
      { key: "stdev_duration", label: "StdDev (ms)", fmt: fmtNum },
      { key: "avg_duration", label: "Avg (ms)", fmt: fmtNum },
      { key: "count_executions", label: "Executions", fmt: fmtInt },
      { key: "num_plans", label: "Plans", fmt: fmtInt },
      { key: "query_sql_text", label: "SQL Text" }
    ],
    waitStats: [
      { key: "wait_category_desc", label: "Wait Type" },
      { key: "total_query_wait_time", label: "Total (ms)", fmt: fmtNum },
      { key: "avg_query_wait_time", label: "Avg (ms)", fmt: fmtNum },
      { key: "max_query_wait_time", label: "Max (ms)", fmt: fmtNum },
      { key: "min_query_wait_time", label: "Min (ms)", fmt: fmtNum },
      { key: "stdev_query_wait_time", label: "StdDev (ms)", fmt: fmtNum },
      { key: "count_executions", label: "Executions", fmt: fmtInt }
    ],
    forcedPlans: [
      { key: "query_id", label: "Query ID" },
      { key: "object_name", label: "Object" },
      { key: "plan_id", label: "Plan ID" },
      { key: "last_execution_time", label: "Last Executed", fmt: fmtDate },
      { key: "force_failure_count", label: "Force Failures", fmt: fmtInt },
      { key: "last_force_failure_reason_desc", label: "Last Failure Reason" },
      { key: "num_plans", label: "Plans", fmt: fmtInt },
      { key: "query_sql_text", label: "SQL Text" }
    ],
    overallConsumption: [
      { key: "bucket_start", label: "Date", fmt: fmtDate },
      { key: "total_count_executions", label: "Executions", fmt: fmtInt },
      { key: "total_duration", label: "Duration (ms)", fmt: fmtNum },
      { key: "total_cpu_time", label: "CPU (ms)", fmt: fmtNum },
      { key: "total_logical_io_reads", label: "Log Reads (KB)", fmt: fmtNum },
      { key: "total_physical_io_reads", label: "Phys Reads (KB)", fmt: fmtNum },
      { key: "total_query_wait_time", label: "Wait (ms)", fmt: fmtNum },
      { key: "total_query_max_used_memory", label: "Memory (KB)", fmt: fmtNum },
      { key: "total_rowcount", label: "Row Count", fmt: fmtInt }
    ]
  };
  function fmtNum(v) {
    const n = Number(v);
    return isNaN(n) ? "" : n.toLocaleString(void 0, { maximumFractionDigits: 2 });
  }
  function fmtInt(v) {
    const n = Number(v);
    return isNaN(n) ? "" : n.toLocaleString();
  }
  function fmtDate(v) {
    if (!v)
      return "";
    const d = new Date(v);
    return d.toLocaleString();
  }
  function renderGrid(rows) {
    const cols = COLUMN_DEFS[reportType] ?? [];
    if (cols.length === 0 || rows.length === 0) {
      gridContainer.innerHTML = '<div class="qs-empty">No data returned.</div>';
      return;
    }
    const table = document.createElement("table");
    table.className = "qs-table";
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const col of cols) {
      const th = document.createElement("th");
      th.textContent = col.label;
      headerRow.appendChild(th);
    }
    if (reportType === "forcedPlans") {
      const th = document.createElement("th");
      th.textContent = "Actions";
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const tr = document.createElement("tr");
      tr.addEventListener("click", (e) => {
        if (e.target.tagName === "BUTTON")
          return;
        openDrilldown(row);
      });
      for (const col of cols) {
        const td = document.createElement("td");
        const raw = row[col.key];
        if (col.key === "query_sql_text") {
          td.className = "qs-sql-cell";
          td.title = String(raw ?? "");
          td.textContent = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80) + (String(raw ?? "").length > 80 ? "\u2026" : "");
        } else {
          td.textContent = col.fmt ? col.fmt(raw) : String(raw ?? "");
        }
        tr.appendChild(td);
      }
      if (reportType === "forcedPlans") {
        const td = document.createElement("td");
        const btn = document.createElement("button");
        btn.className = "qs-btn qs-btn-sm qs-btn-danger";
        btn.textContent = "Remove Forced Plan";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "removeForcedPlan", queryId: row.query_id });
        });
        td.appendChild(btn);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    gridContainer.innerHTML = "";
    gridContainer.appendChild(table);
  }
  function openDrilldown(row) {
    const queryId = row.query_id;
    const planId = row.plan_id ?? 0;
    if (!queryId)
      return;
    currentDrilldownQueryId = queryId;
    currentDrilldownPlanId = planId;
    drilldownTitle.textContent = `Query ${queryId} \u2014 Execution Statistics & Plan`;
    drilldownSection.classList.remove("hidden");
    planCanvas.innerHTML = '<div class="qs-plan-loading">Loading plan\u2026</div>';
    forcePlanBtn.style.display = "none";
    unforcePlanBtn.style.display = "none";
    vscode.postMessage({
      type: "drilldown",
      queryId,
      planId,
      params: currentParams
    });
  }
  drilldownClose.addEventListener("click", () => {
    drilldownSection.classList.add("hidden");
    if (drilldownChart) {
      drilldownChart.destroy();
      drilldownChart = null;
    }
    planCanvas.innerHTML = "";
  });
  forcePlanBtn.addEventListener("click", () => {
    if (currentDrilldownQueryId !== null && currentDrilldownPlanId !== null) {
      vscode.postMessage({ type: "forcePlan", queryId: currentDrilldownQueryId, planId: currentDrilldownPlanId });
    }
  });
  unforcePlanBtn.addEventListener("click", () => {
    if (currentDrilldownQueryId !== null) {
      vscode.postMessage({ type: "removeForcedPlan", queryId: currentDrilldownQueryId });
    }
  });
  function renderDrilldownChart(rows) {
    if (drilldownChart) {
      drilldownChart.destroy();
      drilldownChart = null;
    }
    const canvas = document.getElementById("drilldown-chart");
    const planIds = [...new Set(rows.map((r) => r.plan_id))];
    const datasets = planIds.map((pid, idx) => {
      const planRows = rows.filter((r) => r.plan_id === pid).sort(
        (a, b) => new Date(a.bucket_start).getTime() - new Date(b.bucket_start).getTime()
      );
      return {
        label: `Plan ${pid}`,
        data: planRows.map((r) => ({ x: new Date(r.bucket_start).toLocaleString(), y: r.avg_duration })),
        borderColor: CHART_COLORS[idx % CHART_COLORS.length],
        backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] + "33",
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.2,
        fill: false
      };
    });
    const allBuckets = [...new Set(rows.map((r) => new Date(r.bucket_start).toLocaleString()))].sort();
    drilldownChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: allBuckets,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "var(--vscode-foreground)", font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: "var(--vscode-foreground)", font: { size: 10 } }, grid: { color: "var(--vscode-editorWidget-border)" } },
          y: { beginAtZero: true, title: { display: true, text: "Avg Duration (ms)", color: "var(--vscode-foreground)" }, ticks: { color: "var(--vscode-foreground)" }, grid: { color: "var(--vscode-editorWidget-border)" } }
        }
      }
    });
  }
  function renderPlan(xml, isForcedPlan) {
    const root = parsePlan(xml);
    if (!root) {
      planCanvas.innerHTML = '<div class="qs-plan-loading">Could not parse query plan XML.</div>';
      return;
    }
    currentPlanRoot = root;
    const svgHtml = renderPlanSvg(root);
    planCanvas.innerHTML = svgHtml;
    planScale = 1;
    planCanvas.querySelectorAll(".plan-node").forEach((node) => {
      node.addEventListener("mouseenter", (e) => {
        const target = e.currentTarget;
        const info = target.dataset.tooltip ?? "";
        planTooltip.textContent = info;
        planTooltip.classList.remove("hidden");
      });
      node.addEventListener("mouseleave", () => {
        planTooltip.classList.add("hidden");
      });
      node.addEventListener("mousemove", (e) => {
        const me = e;
        const rect = planContainer.getBoundingClientRect();
        planTooltip.style.left = me.clientX - rect.left + 12 + "px";
        planTooltip.style.top = me.clientY - rect.top + 12 + "px";
      });
    });
    forcePlanBtn.style.display = isForcedPlan ? "none" : "";
    unforcePlanBtn.style.display = isForcedPlan ? "" : "none";
  }
  planZoomIn.addEventListener("click", () => {
    planScale = Math.min(planScale * 1.25, 5);
    planCanvas.style.transform = `scale(${planScale})`;
    planCanvas.style.transformOrigin = "top left";
  });
  planZoomOut.addEventListener("click", () => {
    planScale = Math.max(planScale / 1.25, 0.2);
    planCanvas.style.transform = `scale(${planScale})`;
    planCanvas.style.transformOrigin = "top left";
  });
  planZoomFit.addEventListener("click", () => {
    planScale = 1;
    planCanvas.style.transform = "";
  });
  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "loading":
        setStatus("loading");
        break;
      case "data": {
        currentRows = msg.rows ?? [];
        setStatus("ok");
        renderChart(currentRows);
        renderGrid(currentRows);
        break;
      }
      case "error":
        setStatus("error", msg.message);
        break;
      case "drilldownData": {
        const rows = msg.rows ?? [];
        renderDrilldownChart(rows);
        break;
      }
      case "planData": {
        const xml = msg.xml;
        if (xml) {
          renderPlan(xml, Boolean(msg.isForcedPlan));
        } else {
          planCanvas.innerHTML = '<div class="qs-plan-loading">No query plan available for this query.</div>';
        }
        break;
      }
      case "forcePlanResult":
      case "removeForcedPlanResult":
        requestData();
        break;
    }
  });
  buildToolbar();
  requestData();
})();
//# sourceMappingURL=webview.js.map
