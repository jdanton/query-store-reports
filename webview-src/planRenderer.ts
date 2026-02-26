export interface PlanNode {
  physicalOp: string;
  logicalOp: string;
  estimateRows: number;
  estimateCpu: number;
  estimateIo: number;
  estimateRebinds: number;
  estimateRewinds: number;
  avgRowSize: number;
  totalSubtreeCost: number;
  relOpCost: number;           // cost as fraction 0-1 of root totalSubtreeCost
  parallelism: boolean;
  nodeId: number;
  children: PlanNode[];
  // layout
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_W = 130;
const NODE_H = 60;
const H_GAP  = 30;
const V_GAP  = 50;

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

  const node: PlanNode = {
    physicalOp:       el.getAttribute('PhysicalOp') ?? 'Unknown',
    logicalOp:        el.getAttribute('LogicalOp')  ?? '',
    estimateRows:     parseFloat(el.getAttribute('EstimateRows')    ?? '0'),
    estimateCpu:      parseFloat(el.getAttribute('EstimateCPU')     ?? '0'),
    estimateIo:       parseFloat(el.getAttribute('EstimateIO')      ?? '0'),
    estimateRebinds:  parseFloat(el.getAttribute('EstimateRebinds') ?? '0'),
    estimateRewinds:  parseFloat(el.getAttribute('EstimateRewinds') ?? '0'),
    avgRowSize:       parseFloat(el.getAttribute('AvgRowSize')      ?? '0'),
    totalSubtreeCost: totalCost,
    relOpCost:        rootCost > 0 ? totalCost / rootCost : 0,
    parallelism:      el.getAttribute('Parallel') === '1',
    nodeId:           parseInt(el.getAttribute('NodeId') ?? '0', 10),
    children:         uniqueChildren,
    x: 0, y: 0, width: NODE_W, height: NODE_H,
  };
  return node;
}

// --- Layout ---

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

// --- SVG Rendering ---

function costColor(fraction: number): string {
  // green (hue 120) → red (hue 0) based on cost fraction
  const hue = Math.round((1 - Math.min(fraction, 1)) * 120);
  return `hsl(${hue}, 70%, 45%)`;
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

function renderNodeSvg(node: PlanNode, lines: string[], onTooltip: (id: number, info: string) => void): void {
  const x = node.x;
  const y = node.y;
  const w = NODE_W;
  const h = NODE_H;
  const pct = (node.relOpCost * 100).toFixed(1);
  const fillColor = costColor(node.relOpCost);
  const textColor = '#fff';

  const tooltipInfo = [
    `Physical Op: ${node.physicalOp}`,
    `Logical Op: ${node.logicalOp}`,
    `Est. Rows: ${node.estimateRows.toFixed(0)}`,
    `Est. CPU: ${node.estimateCpu.toExponential(2)}`,
    `Est. I/O: ${node.estimateIo.toExponential(2)}`,
    `Subtree Cost: ${node.totalSubtreeCost.toFixed(4)}`,
    `Cost %: ${pct}%`,
    `Parallelism: ${node.parallelism ? 'Yes' : 'No'}`,
  ].join('\n');

  lines.push(
    `<g class="plan-node" data-node-id="${node.nodeId}" data-tooltip="${escAttr(tooltipInfo)}">`
    + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fillColor}" />`
    + `<text x="${x + w / 2}" y="${y + 18}" text-anchor="middle" fill="${textColor}" font-size="11" font-weight="600">${escAttr(truncate(node.physicalOp, 18))}</text>`
    + `<text x="${x + w / 2}" y="${y + 32}" text-anchor="middle" fill="${textColor}" font-size="10" opacity="0.85">${escAttr(truncate(node.logicalOp, 20))}</text>`
    + `<text x="${x + w / 2}" y="${y + 48}" text-anchor="middle" fill="${textColor}" font-size="10" opacity="0.8">Cost: ${pct}%  Rows: ${node.estimateRows.toFixed(0)}</text>`
    + `</g>`,
  );

  // Draw edges to children
  for (const child of node.children) {
    const x1 = x + w / 2;
    const y1 = y + h;
    const x2 = child.x + NODE_W / 2;
    const y2 = child.y;
    const cy = (y1 + y2) / 2;
    lines.push(
      `<path d="M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}" fill="none" stroke="var(--vscode-editorWidget-border,#666)" stroke-width="1.5" opacity="0.7"/>`,
    );
    renderNodeSvg(child, lines, onTooltip);
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
  renderNodeSvg(root, lines, () => {});

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="display:block">
  <style>
    .plan-node rect { cursor: pointer; transition: opacity 0.15s; }
    .plan-node:hover rect { opacity: 0.85; }
    .plan-node text { pointer-events: none; font-family: var(--vscode-font-family, monospace); }
  </style>
  ${lines.join('\n  ')}
</svg>`;
}
