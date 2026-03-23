const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parsePlanMarkdown, buildPlanTree, normalizePlanNode } = require('../src/services/arisPlan.service');

// ─── parsePlanMarkdown ──────────────────────────────────────────────────────

describe('parsePlanMarkdown', () => {
  it('returns empty array for empty/null input', () => {
    assert.deepStrictEqual(parsePlanMarkdown(''), []);
    assert.deepStrictEqual(parsePlanMarkdown(null), []);
    assert.deepStrictEqual(parsePlanMarkdown(undefined), []);
  });

  it('parses a single step with no TODOs', () => {
    const md = '### Step 1: Setup environment';
    const nodes = parsePlanMarkdown(md);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].nodeKey, 'Step-1');
    assert.equal(nodes[0].title, 'Step 1: Setup environment');
    assert.equal(nodes[0].parentKey, null);
    assert.equal(nodes[0].status, 'pending');
  });

  it('parses multiple sequential steps with correct dependencies', () => {
    const md = `### Step 1: Data prep
### Step 2: Model training
### Step 3: Evaluation`;
    const nodes = parsePlanMarkdown(md);
    const steps = nodes.filter(n => n.nodeKey.startsWith('Step-'));
    assert.equal(steps.length, 3);
    assert.deepStrictEqual(steps[0].dependsOn, []);
    assert.deepStrictEqual(steps[1].dependsOn, ['Step-1']);
    assert.deepStrictEqual(steps[2].dependsOn, ['Step-2']);
  });

  it('parses TODOs under a step with correct parentKey', () => {
    const md = `### Step 1: Setup
#### TODO-1.0: Initialize repo
Set up the base repository.
#### TODO-1.1: Add dependencies
Install required packages.`;
    const nodes = parsePlanMarkdown(md);
    const todos = nodes.filter(n => !n.nodeKey.startsWith('Step-'));
    assert.equal(todos.length, 2);
    assert.equal(todos[0].parentKey, 'Step-1');
    assert.equal(todos[1].parentKey, 'Step-1');
    assert.equal(todos[0].nodeKey, 'TODO-1.0');
    assert.equal(todos[1].nodeKey, 'TODO-1.1');
  });

  it('captures TODO descriptions from lines after the header', () => {
    const md = `### Step 1: Setup
#### TODO-1.0: Initialize repo
Set up the base repository.
This is a multi-line description.
#### TODO-1.1: Add deps
Install packages.`;
    const nodes = parsePlanMarkdown(md);
    const todo0 = nodes.find(n => n.nodeKey === 'TODO-1.0');
    assert.ok(todo0.description.includes('Set up the base repository.'));
    assert.ok(todo0.description.includes('multi-line description'));
  });

  it('marks TODOs with ✅ as completed', () => {
    const md = `### Step 1: Setup
#### TODO-1.0: Initialize repo ✅
Already done.`;
    const nodes = parsePlanMarkdown(md);
    const todo = nodes.find(n => n.nodeKey === 'TODO-1.0');
    assert.equal(todo.status, 'completed');
  });

  it('sets TODO-X.1+ to depend on TODO-X.0 (base dependency)', () => {
    const md = `### Step 1: Setup
#### TODO-1.0: Foundation
Base work.
#### TODO-1.1: Create adapter module
Build adapter A.
#### TODO-1.2: Create dataset module
Build dataset B.`;
    const nodes = parsePlanMarkdown(md);
    const todo1 = nodes.find(n => n.nodeKey === 'TODO-1.1');
    const todo2 = nodes.find(n => n.nodeKey === 'TODO-1.2');
    assert.deepStrictEqual(todo1.dependsOn, ['TODO-1.0']);
    assert.deepStrictEqual(todo2.dependsOn, ['TODO-1.0']);
    assert.equal(todo1.canParallel, true);
    assert.equal(todo2.canParallel, true);
  });

  it('detects aggregation TODOs (wire/benchmark) as depending on all siblings', () => {
    const md = `### Step 2: Implementation
#### TODO-2.0: Foundation
Base.
#### TODO-2.1: Create adapter A
Adapter.
#### TODO-2.2: Create adapter B
Adapter.
#### TODO-2.3: Wire up adapters
Wire everything.`;
    const nodes = parsePlanMarkdown(md);
    const wireNode = nodes.find(n => n.nodeKey === 'TODO-2.3');
    assert.ok(wireNode.dependsOn.includes('TODO-2.1'), 'should depend on sibling 2.1');
    assert.ok(wireNode.dependsOn.includes('TODO-2.2'), 'should depend on sibling 2.2');
    assert.equal(wireNode.canParallel, false);
  });

  it('handles "Phase" keyword as well as "Step"', () => {
    const md = '### Phase 1: Data collection';
    const nodes = parsePlanMarkdown(md);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].nodeKey, 'Step-1');
    assert.ok(nodes[0].title.includes('Data collection'));
  });

  it('handles step headers with week annotations', () => {
    const md = '### Step 3: Evaluation (Week 4)';
    const nodes = parsePlanMarkdown(md);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].nodeKey, 'Step-3');
    assert.equal(nodes[0].title, 'Step 3: Evaluation');
  });

  it('handles TODO keys with various separators (dash, space)', () => {
    const md = `### Step 1: Setup
#### TODO 1.0: First task
Description.
#### TODO-1.1: Second task
Description.`;
    const nodes = parsePlanMarkdown(md);
    const todos = nodes.filter(n => !n.nodeKey.startsWith('Step-'));
    assert.equal(todos.length, 2);
    // Both should be normalized to dash-separated
    assert.ok(todos[0].nodeKey.match(/TODO-1\.0/i));
    assert.ok(todos[1].nodeKey.match(/TODO-1\.1/i));
  });

  it('assigns incrementing sortOrder to nodes', () => {
    const md = `### Step 1: A
#### TODO-1.0: B
Desc.
### Step 2: C
#### TODO-2.0: D
Desc.`;
    const nodes = parsePlanMarkdown(md);
    const orders = nodes.map(n => n.sortOrder);
    // Each should be strictly increasing
    for (let i = 1; i < orders.length; i++) {
      assert.ok(orders[i] > orders[i - 1], `sortOrder[${i}] should be > sortOrder[${i - 1}]`);
    }
  });

  it('handles complex plan with multiple steps and mixed parallel/sequential TODOs', () => {
    const md = `### Step 1: Data prep
#### TODO-1.0: Download datasets
Get data.
#### TODO-1.1: Implement dataset loader A
Loader A.
#### TODO-1.2: Implement dataset loader B
Loader B.
#### TODO-1.3: Benchmark all loaders
Benchmark.

### Step 2: Model
#### TODO-2.0: Base model setup
Setup.
#### TODO-2.1: Add metric module
Metric.`;
    const nodes = parsePlanMarkdown(md);

    // Step 2 depends on Step 1
    const step2 = nodes.find(n => n.nodeKey === 'Step-2');
    assert.deepStrictEqual(step2.dependsOn, ['Step-1']);

    // TODO-1.1 and 1.2 are parallel (both depend on 1.0)
    const t11 = nodes.find(n => n.nodeKey === 'TODO-1.1');
    const t12 = nodes.find(n => n.nodeKey === 'TODO-1.2');
    assert.deepStrictEqual(t11.dependsOn, ['TODO-1.0']);
    assert.deepStrictEqual(t12.dependsOn, ['TODO-1.0']);
    assert.equal(t11.canParallel, true);
    assert.equal(t12.canParallel, true);

    // TODO-1.3 (benchmark) depends on all prior siblings
    const t13 = nodes.find(n => n.nodeKey === 'TODO-1.3');
    assert.ok(t13.dependsOn.includes('TODO-1.1'));
    assert.ok(t13.dependsOn.includes('TODO-1.2'));
  });

  it('handles TODOs without a parent step (orphan TODOs)', () => {
    const md = `#### TODO-1.0: Standalone task
Some work.`;
    const nodes = parsePlanMarkdown(md);
    const todo = nodes.find(n => n.nodeKey === 'TODO-1.0');
    assert.equal(todo.parentKey, null);
  });

  it('ignores non-matching markdown lines', () => {
    const md = `# Big Title
Some paragraph text.
- A list item
## Subtitle
### Step 1: Real step
#### TODO-1.0: Real todo
Description.
Regular text between.`;
    const nodes = parsePlanMarkdown(md);
    assert.equal(nodes.length, 2); // 1 step + 1 TODO
  });

  it('handles step with dash separator', () => {
    const md = '### Step 1 - Data preparation';
    const nodes = parsePlanMarkdown(md);
    assert.equal(nodes.length, 1);
    assert.ok(nodes[0].title.includes('Data preparation'));
  });

  it('handles step with em dash separator', () => {
    const md = '### Step 1 — Data preparation';
    const nodes = parsePlanMarkdown(md);
    assert.equal(nodes.length, 1);
    assert.ok(nodes[0].title.includes('Data preparation'));
  });

  it('handles step with en dash separator', () => {
    const md = '### Step 1 – Data preparation';
    const nodes = parsePlanMarkdown(md);
    assert.equal(nodes.length, 1);
    assert.ok(nodes[0].title.includes('Data preparation'));
  });
});

// ─── buildPlanTree ──────────────────────────────────────────────────────────

describe('buildPlanTree', () => {
  it('returns empty roots and zero stats for empty input', () => {
    const result = buildPlanTree([]);
    assert.deepStrictEqual(result.roots, []);
    assert.deepStrictEqual(result.stats, { total: 0, completed: 0, running: 0, failed: 0, pending: 0 });
  });

  it('builds flat tree when all nodes are root-level', () => {
    const nodes = [
      { nodeKey: 'A', parentKey: null, status: 'pending', dependsOn: [] },
      { nodeKey: 'B', parentKey: null, status: 'completed', dependsOn: [] },
    ];
    const result = buildPlanTree(nodes);
    assert.equal(result.roots.length, 2);
    assert.equal(result.stats.total, 2);
    assert.equal(result.stats.completed, 1);
    assert.equal(result.stats.pending, 1);
  });

  it('nests children under parent nodes', () => {
    const nodes = [
      { nodeKey: 'Step-1', parentKey: null, status: 'pending', dependsOn: [] },
      { nodeKey: 'TODO-1.0', parentKey: 'Step-1', status: 'pending', dependsOn: [] },
      { nodeKey: 'TODO-1.1', parentKey: 'Step-1', status: 'pending', dependsOn: [] },
    ];
    const result = buildPlanTree(nodes);
    assert.equal(result.roots.length, 1);
    assert.equal(result.roots[0].children.length, 2);
  });

  it('computes aggregate status: all children completed => parent completed', () => {
    const nodes = [
      { nodeKey: 'Step-1', parentKey: null, status: 'pending', dependsOn: [] },
      { nodeKey: 'TODO-1.0', parentKey: 'Step-1', status: 'completed', dependsOn: [] },
      { nodeKey: 'TODO-1.1', parentKey: 'Step-1', status: 'completed', dependsOn: [] },
    ];
    const result = buildPlanTree(nodes);
    assert.equal(result.roots[0].status, 'completed');
  });

  it('computes aggregate status: some running => parent running', () => {
    const nodes = [
      { nodeKey: 'Step-1', parentKey: null, status: 'pending', dependsOn: [] },
      { nodeKey: 'TODO-1.0', parentKey: 'Step-1', status: 'running', dependsOn: [] },
      { nodeKey: 'TODO-1.1', parentKey: 'Step-1', status: 'pending', dependsOn: [] },
    ];
    const result = buildPlanTree(nodes);
    assert.equal(result.roots[0].status, 'running');
  });

  it('computes aggregate status: some failed => parent failed', () => {
    const nodes = [
      { nodeKey: 'Step-1', parentKey: null, status: 'pending', dependsOn: [] },
      { nodeKey: 'TODO-1.0', parentKey: 'Step-1', status: 'completed', dependsOn: [] },
      { nodeKey: 'TODO-1.1', parentKey: 'Step-1', status: 'failed', dependsOn: [] },
    ];
    const result = buildPlanTree(nodes);
    assert.equal(result.roots[0].status, 'failed');
  });

  it('computes aggregate status: some completed (none running/failed) => parent running (partial)', () => {
    const nodes = [
      { nodeKey: 'Step-1', parentKey: null, status: 'pending', dependsOn: [] },
      { nodeKey: 'TODO-1.0', parentKey: 'Step-1', status: 'completed', dependsOn: [] },
      { nodeKey: 'TODO-1.1', parentKey: 'Step-1', status: 'pending', dependsOn: [] },
    ];
    const result = buildPlanTree(nodes);
    assert.equal(result.roots[0].status, 'running'); // partially done
  });

  it('counts only leaf nodes in stats', () => {
    const nodes = [
      { nodeKey: 'Step-1', parentKey: null, status: 'pending', dependsOn: [] },
      { nodeKey: 'TODO-1.0', parentKey: 'Step-1', status: 'completed', dependsOn: [] },
      { nodeKey: 'TODO-1.1', parentKey: 'Step-1', status: 'pending', dependsOn: [] },
      { nodeKey: 'Step-2', parentKey: null, status: 'pending', dependsOn: [] },
      { nodeKey: 'TODO-2.0', parentKey: 'Step-2', status: 'running', dependsOn: [] },
    ];
    const result = buildPlanTree(nodes);
    assert.equal(result.stats.total, 3); // only TODOs (leaves)
    assert.equal(result.stats.completed, 1);
    assert.equal(result.stats.running, 1);
    assert.equal(result.stats.pending, 1);
  });

  it('handles deep nesting (3 levels)', () => {
    const nodes = [
      { nodeKey: 'root', parentKey: null, status: 'pending', dependsOn: [] },
      { nodeKey: 'mid', parentKey: 'root', status: 'pending', dependsOn: [] },
      { nodeKey: 'leaf', parentKey: 'mid', status: 'completed', dependsOn: [] },
    ];
    const result = buildPlanTree(nodes);
    assert.equal(result.roots.length, 1);
    assert.equal(result.roots[0].children[0].children[0].status, 'completed');
    // Aggregate should bubble up
    assert.equal(result.roots[0].children[0].status, 'completed');
    assert.equal(result.roots[0].status, 'completed');
  });

  it('orphan children (parentKey not in nodes) become roots', () => {
    const nodes = [
      { nodeKey: 'orphan', parentKey: 'nonexistent', status: 'pending', dependsOn: [] },
    ];
    const result = buildPlanTree(nodes);
    assert.equal(result.roots.length, 1);
    assert.equal(result.roots[0].nodeKey, 'orphan');
  });
});

// ─── normalizePlanNode ──────────────────────────────────────────────────────

describe('normalizePlanNode', () => {
  it('returns null for empty/null input', () => {
    assert.equal(normalizePlanNode(null), null);
    assert.equal(normalizePlanNode({}), null);
    assert.equal(normalizePlanNode(undefined), null);
  });

  it('normalizes snake_case DB row to camelCase', () => {
    const row = {
      id: 'abc',
      run_id: 'run1',
      node_key: 'TODO-1.0',
      title: 'My task',
      description: 'Desc',
      status: 'running',
      parent_key: 'Step-1',
      depends_on: '["TODO-0.0"]',
      can_parallel: 1,
      sort_order: 3,
      started_at: '2025-01-01',
      completed_at: null,
      result_summary: 'OK',
      created_at: '2025-01-01',
    };
    const result = normalizePlanNode(row);
    assert.equal(result.runId, 'run1');
    assert.equal(result.nodeKey, 'TODO-1.0');
    assert.equal(result.parentKey, 'Step-1');
    assert.deepStrictEqual(result.dependsOn, ['TODO-0.0']);
    assert.equal(result.canParallel, true);
    assert.equal(result.sortOrder, 3);
    assert.equal(result.status, 'running');
  });

  it('handles dependsOn as array (not string)', () => {
    const row = { id: 'x', depends_on: ['A', 'B'] };
    const result = normalizePlanNode(row);
    assert.deepStrictEqual(result.dependsOn, ['A', 'B']);
  });

  it('handles malformed dependsOn JSON gracefully', () => {
    const row = { id: 'x', depends_on: '{broken json' };
    const result = normalizePlanNode(row);
    assert.deepStrictEqual(result.dependsOn, []);
  });

  it('defaults status to pending', () => {
    const row = { id: 'x' };
    const result = normalizePlanNode(row);
    assert.equal(result.status, 'pending');
  });
});

// ─── Integration: parsePlanMarkdown → buildPlanTree ─────────────────────────

describe('parsePlanMarkdown → buildPlanTree integration', () => {
  it('end-to-end: parse markdown and build tree with correct structure', () => {
    const md = `### Step 1: Data prep
#### TODO-1.0: Download datasets
Get all data.
#### TODO-1.1: Clean data
Remove duplicates.

### Step 2: Training
#### TODO-2.0: Train model
Run training.
#### TODO-2.1: Evaluate model
Check metrics.`;

    const nodes = parsePlanMarkdown(md);
    // Simulate completed status on some nodes
    const todo10 = nodes.find(n => n.nodeKey === 'TODO-1.0');
    todo10.status = 'completed';
    const todo11 = nodes.find(n => n.nodeKey === 'TODO-1.1');
    todo11.status = 'completed';

    const tree = buildPlanTree(nodes);
    assert.equal(tree.roots.length, 2); // 2 steps
    assert.equal(tree.roots[0].status, 'completed'); // Step 1 all done
    assert.equal(tree.roots[1].status, 'pending'); // Step 2 not started
    assert.equal(tree.stats.completed, 2);
    assert.equal(tree.stats.pending, 2);
  });

  it('end-to-end: large plan with parallel and aggregation nodes', () => {
    const md = `### Step 1: Foundation
#### TODO-1.0: Setup base
Base.

### Step 2: Implementation
#### TODO-2.0: Core framework
Core.
#### TODO-2.1: Create adapter module A
Adapter A.
#### TODO-2.2: Create adapter module B
Adapter B.
#### TODO-2.3: Create dataset module C
Dataset C.
#### TODO-2.4: Wire up all modules
Wire.
#### TODO-2.5: Benchmark results
Benchmark.

### Step 3: Polish
#### TODO-3.0: Documentation
Docs.`;

    const nodes = parsePlanMarkdown(md);
    const tree = buildPlanTree(nodes);

    assert.equal(tree.roots.length, 3);
    // Step 2 should have 6 children
    assert.equal(tree.roots[1].children.length, 6);
    // Total leaves = 1 + 6 + 1 = 8
    assert.equal(tree.stats.total, 8);

    // Check dependency structure of step 2
    const t21 = nodes.find(n => n.nodeKey === 'TODO-2.1');
    const t22 = nodes.find(n => n.nodeKey === 'TODO-2.2');
    const t23 = nodes.find(n => n.nodeKey === 'TODO-2.3');
    // These should be parallel (depend only on 2.0)
    assert.equal(t21.canParallel, true);
    assert.equal(t22.canParallel, true);
    assert.equal(t23.canParallel, true);

    // Wire-up (2.4) should depend on 2.1, 2.2, 2.3
    const t24 = nodes.find(n => n.nodeKey === 'TODO-2.4');
    assert.ok(t24.dependsOn.length >= 3, 'wire should depend on at least 3 siblings');

    // Benchmark (2.5) should depend on wire-up or siblings
    const t25 = nodes.find(n => n.nodeKey === 'TODO-2.5');
    assert.ok(t25.dependsOn.length >= 1, 'benchmark should have dependencies');
  });
});
