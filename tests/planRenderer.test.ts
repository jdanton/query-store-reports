// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  parsePlan,
  renderPlanSvg,
  costColor,
  edgeWeight,
  formatRows,
  formatCost,
} from '../webview-src/planRenderer';
import {
  SIMPLE_SCAN_PLAN,
  NESTED_LOOP_PLAN,
  WARNINGS_PLAN,
  PARALLEL_PLAN,
  INVALID_XML,
  NO_RELOP_XML,
} from './helpers/samplePlans';

// ---- parsePlan() ----

describe('parsePlan', () => {
  it('returns null for invalid XML', () => {
    expect(parsePlan(INVALID_XML)).toBeNull();
  });

  it('returns null when no RelOp found', () => {
    expect(parsePlan(NO_RELOP_XML)).toBeNull();
  });

  it('parses a single-node plan', () => {
    const root = parsePlan(SIMPLE_SCAN_PLAN);
    expect(root).not.toBeNull();
    expect(root!.physicalOp).toBe('Clustered Index Scan');
    expect(root!.logicalOp).toBe('Clustered Index Scan');
    expect(root!.estimateRows).toBe(1000);
    expect(root!.estimateCpu).toBeCloseTo(0.01);
    expect(root!.estimateIo).toBeCloseTo(0.05);
    expect(root!.totalSubtreeCost).toBeCloseTo(0.06);
    expect(root!.avgRowSize).toBe(100);
    expect(root!.children).toHaveLength(0);
  });

  it('computes relOpCost as 1.0 for root node', () => {
    const root = parsePlan(SIMPLE_SCAN_PLAN);
    expect(root!.relOpCost).toBeCloseTo(1.0);
  });

  it('computes relOpCost as fraction for child nodes', () => {
    const root = parsePlan(NESTED_LOOP_PLAN);
    expect(root!.relOpCost).toBeCloseTo(1.0);
    // Child cost / root cost should be < 1
    for (const child of root!.children) {
      expect(child.relOpCost).toBeLessThan(1.0);
      expect(child.relOpCost).toBeGreaterThan(0);
    }
  });

  it('extracts object name (schema.table.index)', () => {
    const root = parsePlan(SIMPLE_SCAN_PLAN);
    expect(root!.objectName).toBe('dbo.Users.PK_Users');
  });

  it('extracts object names for child nodes', () => {
    const root = parsePlan(NESTED_LOOP_PLAN);
    expect(root!.children).toHaveLength(2);
    expect(root!.children[0].objectName).toBe('dbo.Orders.IX_Orders_UserId');
    expect(root!.children[1].objectName).toBe('dbo.Users.PK_Users');
  });

  it('extracts warnings', () => {
    const root = parsePlan(WARNINGS_PLAN);
    expect(root!.warnings).toContain('SpillToTempDb');
    expect(root!.warnings).toContain('No Join Predicate');
  });

  it('detects parallelism', () => {
    const root = parsePlan(PARALLEL_PLAN);
    expect(root!.parallelism).toBe(true);
    expect(root!.children[0].parallelism).toBe(true);
  });

  it('sets parallelism false when not parallel', () => {
    const root = parsePlan(SIMPLE_SCAN_PLAN);
    expect(root!.parallelism).toBe(false);
  });

  it('builds tree structure with children', () => {
    const root = parsePlan(NESTED_LOOP_PLAN);
    expect(root!.physicalOp).toBe('Nested Loops');
    expect(root!.children).toHaveLength(2);
    expect(root!.children[0].physicalOp).toBe('Index Seek');
    expect(root!.children[1].physicalOp).toBe('Clustered Index Seek');
  });

  it('extracts estimateRebinds', () => {
    const root = parsePlan(NESTED_LOOP_PLAN);
    // The second child (CIS on Users) has EstimateRebinds="499"
    expect(root!.children[1].estimateRebinds).toBe(499);
  });

  it('picks up object name from descendant operators', () => {
    const root = parsePlan(NESTED_LOOP_PLAN);
    // Root Nested Loops node extracts object from its physical op children
    // This is expected — extractObjectName looks at :scope > * > Object
    expect(root!.objectName).toBeTruthy();
  });
});

// ---- costColor() ----

describe('costColor', () => {
  it('returns green for cost 0', () => {
    expect(costColor(0)).toBe('hsl(120, 70%, 45%)');
  });

  it('returns red for cost 1', () => {
    expect(costColor(1)).toBe('hsl(0, 70%, 45%)');
  });

  it('returns yellow for cost 0.5', () => {
    expect(costColor(0.5)).toBe('hsl(60, 70%, 45%)');
  });

  it('clamps values above 1', () => {
    expect(costColor(1.5)).toBe('hsl(0, 70%, 45%)');
  });
});

// ---- edgeWeight() ----

describe('edgeWeight', () => {
  it('returns 0.5 for 0 rows', () => {
    expect(edgeWeight(0)).toBe(0.5);
  });

  it('returns 0.5 for negative rows', () => {
    expect(edgeWeight(-1)).toBe(0.5);
  });

  it('returns 0.5 for 1 row (log10(1) = 0)', () => {
    expect(edgeWeight(1)).toBeCloseTo(0.5);
  });

  it('returns 1.25 for 10 rows', () => {
    expect(edgeWeight(10)).toBeCloseTo(1.25);
  });

  it('returns 2.0 for 100 rows', () => {
    expect(edgeWeight(100)).toBeCloseTo(2.0);
  });

  it('returns 5.0 for 1M rows', () => {
    expect(edgeWeight(1_000_000)).toBeCloseTo(5.0);
  });

  it('clamps at 6.0 for very large row counts', () => {
    expect(edgeWeight(1e12)).toBe(6);
  });
});

// ---- formatRows() ----

describe('formatRows', () => {
  it('formats small numbers as integers', () => {
    expect(formatRows(500)).toBe('500');
  });

  it('formats thousands as K', () => {
    expect(formatRows(1500)).toBe('1.5K');
  });

  it('formats millions as M', () => {
    expect(formatRows(2_500_000)).toBe('2.5M');
  });

  it('formats zero', () => {
    expect(formatRows(0)).toBe('0');
  });
});

// ---- formatCost() ----

describe('formatCost', () => {
  it('formats values >= 1 with 2 decimals', () => {
    expect(formatCost(1.5)).toBe('1.50');
  });

  it('formats small values with 4 decimals', () => {
    expect(formatCost(0.005)).toBe('0.0050');
  });

  it('formats very small values in exponential', () => {
    expect(formatCost(0.0001)).toBe('1.00e-4');
  });
});

// ---- renderPlanSvg() ----

describe('renderPlanSvg', () => {
  it('returns valid SVG string', () => {
    const root = parsePlan(SIMPLE_SCAN_PLAN)!;
    const svg = renderPlanSvg(root);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('</svg>');
  });

  it('includes arrowhead marker definition', () => {
    const root = parsePlan(SIMPLE_SCAN_PLAN)!;
    const svg = renderPlanSvg(root);
    expect(svg).toContain('<marker id="arrowhead"');
  });

  it('renders node rect elements', () => {
    const root = parsePlan(SIMPLE_SCAN_PLAN)!;
    const svg = renderPlanSvg(root);
    expect(svg).toContain('<rect');
    expect(svg).toContain('class="plan-node"');
  });

  it('includes cost percentage text', () => {
    const root = parsePlan(SIMPLE_SCAN_PLAN)!;
    const svg = renderPlanSvg(root);
    expect(svg).toContain('Cost:');
  });

  it('renders edge paths for multi-node plan', () => {
    const root = parsePlan(NESTED_LOOP_PLAN)!;
    const svg = renderPlanSvg(root);
    // Should have paths for edges (2 children = 2 edges)
    const pathMatches = svg.match(/<path d="M/g);
    expect(pathMatches).not.toBeNull();
    expect(pathMatches!.length).toBe(2);
  });

  it('uses variable stroke-width on edges', () => {
    const root = parsePlan(NESTED_LOOP_PLAN)!;
    const svg = renderPlanSvg(root);
    // Edge widths should vary since children have different row counts
    expect(svg).toContain('stroke-width=');
  });

  it('includes row count edge labels', () => {
    const root = parsePlan(NESTED_LOOP_PLAN)!;
    const svg = renderPlanSvg(root);
    // Child with 500 rows
    expect(svg).toContain('500');
    // Edge label class
    expect(svg).toContain('plan-edge-label');
  });

  it('shows warning badge in SVG', () => {
    const root = parsePlan(WARNINGS_PLAN)!;
    const svg = renderPlanSvg(root);
    // Warning unicode character
    expect(svg).toContain('\u26a0');
  });

  it('shows parallelism indicator in SVG', () => {
    const root = parsePlan(PARALLEL_PLAN)!;
    const svg = renderPlanSvg(root);
    // Parallelism unicode character ‖
    expect(svg).toContain('\u2016');
  });

  it('includes structured tooltip HTML in data-tooltip', () => {
    const root = parsePlan(SIMPLE_SCAN_PLAN)!;
    const svg = renderPlanSvg(root);
    // Tooltip should contain structured HTML elements
    expect(svg).toContain('ptt-title');
    expect(svg).toContain('ptt-metrics');
    expect(svg).toContain('ptt-row');
  });

  it('includes object name in tooltip', () => {
    const root = parsePlan(SIMPLE_SCAN_PLAN)!;
    const svg = renderPlanSvg(root);
    expect(svg).toContain('dbo.Users.PK_Users');
  });
});
