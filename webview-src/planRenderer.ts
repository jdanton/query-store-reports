export interface PlanNode {
  physicalOp: string;
  logicalOp: string;
  objectName: string;          // table/index from Object element
  estimateRows: number;
  estimateCpu: number;
  estimateIo: number;
  estimateRebinds: number;
  estimateRewinds: number;
  estimateExecutions: number;
  avgRowSize: number;
  totalSubtreeCost: number;
  relOpCost: number;           // cost as fraction 0-1 of root totalSubtreeCost
  parallelism: boolean;
  nodeId: number;
  warnings: string[];
  children: PlanNode[];
  // layout
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_W = 140;
const NODE_H = 68;
const H_GAP  = 30;
const V_GAP  = 60;

// ---- XML Parsing ----

export function parsePlan(xml: string): PlanNode | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    return null;
  }

  // Find root RelOp — first RelOp that is a direct child of a StmtSimple/StmtCursor
  const rootRelOp = doc.querySelector('StmtSimple > QueryPlan > RelOp')
    ?? doc.querySelector('StmtCursor > QueryPlan > RelOp')
    ?? doc.querySelector('RelOp');

  if (!rootRelOp) {
    return null;
  }

  const rootCost = parseFloat(rootRelOp.getAttribute('TotalSubtreeCost') ?? '1') || 1;
  return parseRelOp(rootRelOp, rootCost);
}

function parseRelOp(el: Element, rootCost: number): PlanNode {
  const totalCost = parseFloat(el.getAttribute('TotalSubtreeCost') ?? '0');

  // Single pass: collect all direct-grandchild RelOp elements, de-duplicated
  const seen = new Set<Element>();
  const uniqueChildren: PlanNode[] = [];
  const allRelOps = el.querySelectorAll(':scope > * > RelOp');
  for (const relOp of allRelOps) {
    if (!seen.has(relOp)) {
      seen.add(relOp);
      uniqueChildren.push(parseRelOp(relOp, rootCost));
    }
  }

  // Extract object name from child Object elements (table, index)
  const objectName = extractObjectName(el);

  // Extract warnings
  const warnings = extractWarnings(el);

  const node: PlanNode = {
    physicalOp:          el.getAttribute('PhysicalOp') ?? 'Unknown',
    logicalOp:           el.getAttribute('LogicalOp')  ?? '',
    objectName,
    estimateRows:        parseFloat(el.getAttribute('EstimateRows')    ?? '0'),
    estimateCpu:         parseFloat(el.getAttribute('EstimateCPU')     ?? '0'),
    estimateIo:          parseFloat(el.getAttribute('EstimateIO')      ?? '0'),
    estimateRebinds:     parseFloat(el.getAttribute('EstimateRebinds') ?? '0'),
    estimateRewinds:     parseFloat(el.getAttribute('EstimateRewinds') ?? '0'),
    estimateExecutions:  parseFloat(el.getAttribute('EstimateExecutions') ?? '1'),
    avgRowSize:          parseFloat(el.getAttribute('AvgRowSize')      ?? '0'),
    totalSubtreeCost:    totalCost,
    relOpCost:           rootCost > 0 ? totalCost / rootCost : 0,
    parallelism:         el.getAttribute('Parallel') === '1' || el.getAttribute('Parallel') === 'true',
    nodeId:              parseInt(el.getAttribute('NodeId') ?? '0', 10),
    warnings,
    children:            uniqueChildren,
    x: 0, y: 0, width: NODE_W, height: NODE_H,
  };
  return node;
}

function extractObjectName(relOp: Element): string {
  // Look for Object element inside the physical op child (e.g., IndexScan > Object)
  const obj = relOp.querySelector(':scope > * > Object');
  if (!obj) return '';

  const table = obj.getAttribute('Table')?.replace(/[\[\]]/g, '') ?? '';
  const index = obj.getAttribute('Index')?.replace(/[\[\]]/g, '') ?? '';
  const schema = obj.getAttribute('Schema')?.replace(/[\[\]]/g, '') ?? '';

  if (index && table) return `${schema ? schema + '.' : ''}${table}.${index}`;
  if (table) return `${schema ? schema + '.' : ''}${table}`;
  if (index) return index;
  return '';
}

function extractWarnings(relOp: Element): string[] {
  const warnings: string[] = [];
  const warningsEl = relOp.querySelector(':scope > * > Warnings');
  if (!warningsEl) return warnings;

  // SpillToTempDb
  if (warningsEl.querySelector('SpillToTempDb')) {
    warnings.push('SpillToTempDb');
  }
  // NoJoinPredicate
  if (warningsEl.querySelector('NoJoinPredicate')) {
    warnings.push('No Join Predicate');
  }
  // ColumnsWithNoStatistics
  const noStats = warningsEl.querySelector('ColumnsWithNoStatistics');
  if (noStats) {
    warnings.push('Missing Statistics');
  }
  // UnmatchedIndexes
  if (warningsEl.querySelector('UnmatchedIndexes')) {
    warnings.push('Unmatched Indexes');
  }
  // Generic warning children
  for (const child of warningsEl.children) {
    const tag = child.tagName;
    if (!['SpillToTempDb', 'NoJoinPredicate', 'ColumnsWithNoStatistics', 'UnmatchedIndexes'].includes(tag)) {
      warnings.push(tag);
    }
  }
  return warnings;
}

// ---- Layout ----

interface BBox { w: number; h: number }

function computeLayout(node: PlanNode): BBox {
  if (node.children.length === 0) {
    node.width = NODE_W;
    node.height = NODE_H;
    return { w: NODE_W, h: NODE_H };
  }

  const childBoxes = node.children.map(computeLayout);
  const totalChildW = childBoxes.reduce((s, b) => s + b.w, 0) + H_GAP * (node.children.length - 1);
  const maxChildH   = Math.max(...childBoxes.map((b) => b.h));

  node.width  = Math.max(NODE_W, totalChildW);
  node.height = NODE_H;

  return { w: node.width, h: NODE_H + V_GAP + maxChildH };
}

function assignPositions(node: PlanNode, x: number, y: number): void {
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

function treeBounds(node: PlanNode): { minX: number; minY: number; maxX: number; maxY: number } {
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

// ---- Edge weight (from Azure Data Studio) ----

export function edgeWeight(rowCount: number): number {
  if (rowCount <= 0) return 0.5;
  return Math.max(0.5, Math.min(0.5 + 0.75 * Math.log10(rowCount), 6));
}

// ---- Formatting helpers ----

export function formatRows(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

export function formatCost(n: number): string {
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.001) return n.toFixed(4);
  return n.toExponential(2);
}

// ---- SVG Rendering ----

export function costColor(fraction: number): string {
  // green (hue 120) -> red (hue 0) based on cost fraction
  const hue = Math.round((1 - Math.min(fraction, 1)) * 120);
  return `hsl(${hue}, 70%, 45%)`;
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s;
}

function buildTooltipHtml(node: PlanNode): string {
  const pct = (node.relOpCost * 100).toFixed(1);

  const rows: [string, string][] = [
    ['Logical Op', node.logicalOp],
  ];

  if (node.objectName) {
    rows.push(['Object', node.objectName]);
  }

  rows.push(
    ['Est. Rows', formatRows(node.estimateRows)],
    ['Est. CPU', formatCost(node.estimateCpu)],
    ['Est. I/O', formatCost(node.estimateIo)],
    ['Subtree Cost', formatCost(node.totalSubtreeCost)],
    ['Cost', pct + '%'],
    ['Avg Row Size', node.avgRowSize.toFixed(0) + ' B'],
  );

  if (node.parallelism) {
    rows.push(['Parallelism', 'Yes']);
  }
  if (node.estimateRebinds > 0) {
    rows.push(['Est. Rebinds', node.estimateRebinds.toFixed(0)]);
  }
  if (node.estimateRewinds > 0) {
    rows.push(['Est. Rewinds', node.estimateRewinds.toFixed(0)]);
  }

  let html = `<div class="ptt-title">${escAttr(node.physicalOp)}</div>`;

  if (node.warnings.length > 0) {
    html += `<div class="ptt-warn">\u26a0 ${escAttr(node.warnings.join(', '))}</div>`;
  }

  html += '<div class="ptt-metrics">';
  for (let i = 0; i < rows.length; i++) {
    html += `<div class="ptt-row"><span class="ptt-name">${escAttr(rows[i][0])}</span><span class="ptt-val">${escAttr(rows[i][1])}</span></div>`;
  }
  html += '</div>';

  return html;
}

function buildEdgeTooltipHtml(parent: PlanNode, child: PlanNode): string {
  const rows: [string, string][] = [
    ['Est. Rows', formatRows(child.estimateRows)],
    ['Avg Row Size', child.avgRowSize.toFixed(0) + ' B'],
    ['Est. Data Size', formatRows(child.estimateRows * child.avgRowSize) + ' B'],
  ];

  let html = '<div class="ptt-metrics">';
  for (const [name, val] of rows) {
    html += `<div class="ptt-row"><span class="ptt-name">${escAttr(name)}</span><span class="ptt-val">${escAttr(val)}</span></div>`;
  }
  html += '</div>';
  return html;
}

function renderNodeSvg(node: PlanNode, lines: string[]): void {
  const x = node.x;
  const y = node.y;
  const w = NODE_W;
  const h = NODE_H;
  const pct = (node.relOpCost * 100).toFixed(1);
  const fillColor = costColor(node.relOpCost);
  const textColor = '#fff';

  const tooltipHtml = buildTooltipHtml(node);

  // Node group
  const line2 = node.objectName
    ? truncate(node.objectName, 22)
    : truncate(node.logicalOp, 22);

  // Parallelism indicator
  const parallelBadge = node.parallelism ? ' \u2016' : '';
  // Warning indicator
  const warnBadge = node.warnings.length > 0 ? '\u26a0 ' : '';

  lines.push(
    `<g class="plan-node" data-node-id="${node.nodeId}" data-tooltip="${escAttr(tooltipHtml)}">`
    + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${fillColor}" />`
    // Line 1: Physical Op
    + `<text x="${x + w / 2}" y="${y + 17}" text-anchor="middle" fill="${textColor}" font-size="11" font-weight="600">${warnBadge}${escAttr(truncate(node.physicalOp, 18))}${parallelBadge}</text>`
    // Line 2: Object name or Logical Op
    + `<text x="${x + w / 2}" y="${y + 33}" text-anchor="middle" fill="${textColor}" font-size="10" opacity="0.85">${escAttr(line2)}</text>`
    // Line 3: Cost and Rows
    + `<text x="${x + w / 2}" y="${y + 50}" text-anchor="middle" fill="${textColor}" font-size="10" opacity="0.8">`
    + `Cost: ${pct}%`
    + `</text>`
    // Line 4: Row count
    + `<text x="${x + w / 2}" y="${y + 62}" text-anchor="middle" fill="${textColor}" font-size="9" opacity="0.7">`
    + `Est. Rows: ${formatRows(node.estimateRows)}`
    + `</text>`
    + `</g>`,
  );

  // Draw edges to children (edges first so nodes draw on top)
  for (const child of node.children) {
    const x1 = x + w / 2;
    const y1 = y + h;
    const x2 = child.x + NODE_W / 2;
    const y2 = child.y;
    const cy = (y1 + y2) / 2;

    // Variable stroke width based on child's estimated row count (ADS formula)
    const strokeW = edgeWeight(child.estimateRows);

    const edgeTooltip = buildEdgeTooltipHtml(node, child);

    // Edge path with arrowhead
    lines.push(
      `<g class="plan-edge" data-tooltip="${escAttr(edgeTooltip)}">`
      + `<path d="M${x2},${y2} C${x2},${cy} ${x1},${cy} ${x1},${y1}" `
      + `fill="none" stroke="var(--vscode-editorWidget-border,#888)" `
      + `stroke-width="${strokeW.toFixed(1)}" opacity="0.7" `
      + `marker-end="url(#arrowhead)"/>`
      + `</g>`,
    );

    // Row count label on the edge
    const labelX = (x1 + x2) / 2;
    const labelY = cy - 4;
    const rowLabel = formatRows(child.estimateRows);
    lines.push(
      `<text x="${labelX}" y="${labelY}" text-anchor="middle" `
      + `fill="var(--vscode-descriptionForeground,#999)" font-size="9" class="plan-edge-label">`
      + `${rowLabel}`
      + `</text>`,
    );

    renderNodeSvg(child, lines);
  }
}

export function renderPlanSvg(root: PlanNode): string {
  computeLayout(root);
  assignPositions(root, 0, 0);
  const bounds = treeBounds(root);

  const pad = 20;
  const svgW = bounds.maxX - bounds.minX + pad * 2;
  const svgH = bounds.maxY - bounds.minY + pad * 2;

  // Shift all nodes so min is at (pad, pad)
  const shiftNodes = (n: PlanNode): void => {
    n.x -= bounds.minX - pad;
    n.y -= bounds.minY - pad;
    for (const c of n.children) {
      shiftNodes(c);
    }
  };
  shiftNodes(root);

  const lines: string[] = [];
  renderNodeSvg(root, lines);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="display:block">
  <defs>
    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">
      <polygon points="0 0, 8 3, 0 6" fill="var(--vscode-editorWidget-border,#888)" opacity="0.7"/>
    </marker>
  </defs>
  <style>
    .plan-node rect { cursor: pointer; transition: opacity 0.15s; }
    .plan-node:hover rect { opacity: 0.85; }
    .plan-node text { pointer-events: none; font-family: var(--vscode-font-family, sans-serif); }
    .plan-edge path { cursor: pointer; }
    .plan-edge:hover path { opacity: 1; }
    .plan-edge-label { pointer-events: none; font-family: var(--vscode-font-family, sans-serif); }
  </style>
  ${lines.join('\n  ')}
</svg>`;
}
