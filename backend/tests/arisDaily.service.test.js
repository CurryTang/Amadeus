const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── In-memory DB mock ──────────────────────────────────────────────────────
// Uses positional ? args matching against the SQL to build row filters.

const tables = {};

function resetDb() {
  tables.aris_daily_tasks = [];
  tables.aris_daily_completions = [];
  tables.aris_day_plans = [];
  tables.aris_milestones = [];
  tables.aris_projects = [];
  tables.aris_work_items = [];
}

// Build a filter function from SQL WHERE clause and positional args.
// Walks through the SQL finding each ? and maps it to the column it compares against.
function buildFilter(sql, args) {
  if (!sql.toLowerCase().includes('where')) return () => true;
  const whereStr = sql.substring(sql.toLowerCase().indexOf('where') + 5);
  const filters = [];

  // Track which arg index we're at by scanning ? placeholders in WHERE clause
  let argIdx = 0;
  // Count ? in the part BEFORE WHERE to offset args
  const beforeWhere = sql.substring(0, sql.toLowerCase().indexOf('where'));
  const beforeCount = (beforeWhere.match(/\?/g) || []).length;
  argIdx = beforeCount;

  // Static filters (no ? needed)
  if (/is_active\s*=\s*1/i.test(whereStr)) {
    filters.push(r => r.is_active === 1 || r.is_active === true);
  }
  if (/status\s+NOT\s+IN\s*\('done',\s*'canceled'\)/i.test(whereStr)) {
    filters.push(r => !['done', 'canceled'].includes(r.status));
  }
  if (/archived_at\s+IS\s+NULL/i.test(whereStr)) {
    filters.push(r => r.archived_at == null);
  }
  if (/status\s*!=\s*'completed'/i.test(whereStr)) {
    filters.push(r => r.status !== 'completed');
  }
  if (/recurrence\s+IS\s+NULL/i.test(whereStr)) {
    filters.push(r => r.recurrence == null);
  }
  if (/recurrence\s*=\s*'weekly'/i.test(whereStr)) {
    filters.push(r => r.recurrence === 'weekly');
  }

  // Dynamic filters with ? — scan WHERE for patterns like `col = ?`, `col >= ?`, etc.
  const paramPatterns = [
    // date(col) >= date(?) AND date(col) <= date(?)
    { re: /date\((\w+)\)\s*>=\s*date\(\?\)/gi, op: '>=' },
    { re: /date\((\w+)\)\s*<=\s*date\(\?\)/gi, op: '<=' },
    // col >= ? AND col <= ?
    { re: /(\w+)\s*>=\s*\?/gi, op: '>=' },
    { re: /(\w+)\s*<=\s*\?/gi, op: '<=' },
    // col = ?
    { re: /(\w+)\s*=\s*\?/gi, op: '=' },
  ];

  // Collect all ? positions with their column and operator
  const paramSlots = [];
  // Find each ? in whereStr and determine which column/op it belongs to
  const tokens = whereStr.replace(/\n/g, ' ');

  // Simple approach: find all column-op-? patterns and map them in order
  const allMatches = [];
  for (const { re, op } of paramPatterns) {
    let m;
    while ((m = re.exec(tokens)) !== null) {
      allMatches.push({ col: m[1], op, pos: m.index });
    }
  }
  // Sort by position in the string (this matches arg order)
  allMatches.sort((a, b) => a.pos - b.pos);

  for (const { col, op } of allMatches) {
    const val = args[argIdx++];
    if (op === '=') {
      filters.push(r => String(r[col] ?? '') === String(val));
    } else if (op === '>=') {
      filters.push(r => (r[col] ?? '') >= val);
    } else if (op === '<=') {
      filters.push(r => (r[col] ?? '') <= val);
    }
  }

  return (row) => filters.every(f => f(row));
}

function mockExecute(input) {
  const sql = typeof input === 'string' ? input : input.sql;
  const args = (typeof input === 'object' ? input.args : []) || [];
  const sqlLower = sql.trim().toLowerCase();

  // CREATE TABLE → no-op
  if (sqlLower.startsWith('create table')) {
    return { rows: [] };
  }

  // INSERT
  const insertMatch = sql.match(/INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/is);
  if (insertMatch) {
    const table = insertMatch[1];
    const cols = insertMatch[2].split(',').map(c => c.trim());
    const valTokens = insertMatch[3].split(',').map(v => v.trim());
    const row = {};
    let argIdx = 0;
    cols.forEach((col, i) => {
      const token = valTokens[i];
      if (token === '?') {
        row[col] = args[argIdx++] ?? null;
      } else if (token === 'NULL' || token === 'null') {
        row[col] = null;
      } else if (/^-?\d+(\.\d+)?$/.test(token)) {
        row[col] = Number(token);
      } else if (/^'.*'$/.test(token)) {
        row[col] = token.slice(1, -1);
      } else {
        row[col] = token;
      }
    });
    if (!tables[table]) tables[table] = [];
    tables[table].push(row);
    return { rows: [] };
  }

  // UPDATE
  const updateMatch = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)/is);
  if (updateMatch) {
    const table = updateMatch[1];
    const setClause = updateMatch[2];
    const whereClause = updateMatch[3];

    // Count ? in SET to know where WHERE args start
    const setQCount = (setClause.match(/\?/g) || []).length;
    const setArgs = args.slice(0, setQCount);
    const whereArgs = args.slice(setQCount);

    // Parse SET: handle both `col = ?` and `col = 'literal'` and `col = number`
    const setOps = []; // { col, value } or { col, argIdx }
    const setAllRe = /(\w+)\s*=\s*(\?|'[^']*'|\d+)/g;
    let sm;
    let argIdx = 0;
    while ((sm = setAllRe.exec(setClause)) !== null) {
      const col = sm[1];
      const valToken = sm[2];
      if (valToken === '?') {
        setOps.push({ col, argIdx: argIdx++ });
      } else if (/^'.*'$/.test(valToken)) {
        setOps.push({ col, value: valToken.slice(1, -1) });
      } else {
        setOps.push({ col, value: Number(valToken) });
      }
    }
    const setCols = setOps.filter(o => o.argIdx != null).map(o => o.col);

    // Parse WHERE columns
    const whereCols = [];
    const whereRe = /(\w+)\s*=\s*\?/g;
    let wm;
    while ((wm = whereRe.exec(whereClause)) !== null) {
      whereCols.push(wm[1]);
    }

    if (tables[table]) {
      for (const row of tables[table]) {
        let match = true;
        whereCols.forEach((col, i) => {
          if (String(row[col]) !== String(whereArgs[i])) match = false;
        });
        if (match) {
          for (const op of setOps) {
            if (op.argIdx != null) {
              row[op.col] = setArgs[op.argIdx];
            } else {
              row[op.col] = op.value;
            }
          }
        }
      }
    }
    return { rows: [] };
  }

  // DELETE
  const deleteMatch = sql.match(/DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)/is);
  if (deleteMatch) {
    const table = deleteMatch[1];
    const whereClause = deleteMatch[2];
    const whereCols = [];
    const re = /(\w+)\s*=\s*\?/g;
    let m;
    while ((m = re.exec(whereClause)) !== null) {
      whereCols.push(m[1]);
    }

    if (tables[table]) {
      tables[table] = tables[table].filter(row => {
        let match = true;
        whereCols.forEach((col, i) => {
          if (String(row[col]) !== String(args[i])) match = false;
        });
        return !match;
      });
    }
    return { rows: [] };
  }

  // SELECT
  const selectMatch = sql.match(/SELECT\s+.+?\s+FROM\s+(\w+)/is);
  if (selectMatch) {
    const table = selectMatch[1];
    let rows = [...(tables[table] || [])];

    const filter = buildFilter(sql, args);
    rows = rows.filter(filter);

    // ORDER BY — skip (tests don't depend on order for correctness)

    // LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      rows = rows.slice(0, Number(limitMatch[1]));
    }

    return { rows };
  }

  return { rows: [] };
}

// Mock the db module by pre-populating the require cache
const dbModulePath = require.resolve('../src/db');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    getDb: () => ({ execute: mockExecute }),
    initDatabase: async () => {},
  },
};

const { createArisDailyService } = require('../src/services/arisDaily.service');

describe('arisDaily.service', () => {
  let svc;

  beforeEach(() => {
    resetDb();
    svc = createArisDailyService();
  });

  // ─── Daily Tasks CRUD ───────────────────────────────────────────────────

  describe('createDailyTask', () => {
    it('creates a task with required fields', async () => {
      const task = await svc.createDailyTask({ title: 'Read papers' });
      assert.ok(task);
      assert.equal(task.title, 'Read papers');
      assert.equal(task.category, 'general');
      assert.equal(task.frequency, 'daily');
      assert.equal(task.isActive, true);
    });

    it('throws on empty title', async () => {
      await assert.rejects(() => svc.createDailyTask({ title: '' }), /Title is required/);
      await assert.rejects(() => svc.createDailyTask({ title: '   ' }), /Title is required/);
      await assert.rejects(() => svc.createDailyTask({}), /Title is required/);
    });

    it('throws on invalid frequency', async () => {
      await assert.rejects(
        () => svc.createDailyTask({ title: 'X', frequency: 'monthly' }),
        /Invalid frequency/,
      );
    });

    it('creates task with totalTarget and targetPeriod', async () => {
      const task = await svc.createDailyTask({
        title: 'Read 100 papers',
        totalTarget: 100,
        targetPeriod: 'total',
      });
      assert.equal(task.totalTarget, 100);
      assert.equal(task.targetPeriod, 'total');
    });

    it('creates task with daily target period', async () => {
      const task = await svc.createDailyTask({
        title: 'Push-ups',
        totalTarget: 50,
        targetPeriod: 'daily',
      });
      assert.equal(task.totalTarget, 50);
      assert.equal(task.targetPeriod, 'daily');
    });

    it('creates task with weekly frequency and weekday', async () => {
      const task = await svc.createDailyTask({
        title: 'Weekly review',
        frequency: 'weekly',
        weekday: 1, // Monday
      });
      assert.equal(task.frequency, 'weekly');
      assert.equal(task.weekday, 1);
    });

    it('defaults estimatedMinutes to 30', async () => {
      const task = await svc.createDailyTask({ title: 'Test' });
      assert.equal(task.estimatedMinutes, 30);
    });

    it('respects custom estimatedMinutes', async () => {
      const task = await svc.createDailyTask({ title: 'Test', estimatedMinutes: 60 });
      assert.equal(task.estimatedMinutes, 60);
    });

    it('backward compat: weeklyCredit maps to totalTarget', async () => {
      const task = await svc.createDailyTask({ title: 'Test', weeklyCredit: 5 });
      assert.equal(task.totalTarget, 5);
    });

    it('backward compat: weeklyCredit=7 does NOT map to totalTarget (default)', async () => {
      const task = await svc.createDailyTask({ title: 'Test', weeklyCredit: 7 });
      assert.equal(task.totalTarget, null);
    });
  });

  describe('updateDailyTask', () => {
    it('updates allowed fields', async () => {
      const task = await svc.createDailyTask({ title: 'Old title' });
      const updated = await svc.updateDailyTask(task.id, { title: 'New title', priority: 5 });
      assert.equal(updated.title, 'New title');
      assert.equal(updated.priority, 5);
    });

    it('throws if task not found', async () => {
      await assert.rejects(() => svc.updateDailyTask('nonexistent', { title: 'X' }), /not found/);
    });

    it('returns unchanged task if no updates provided', async () => {
      const task = await svc.createDailyTask({ title: 'Test' });
      const same = await svc.updateDailyTask(task.id, {});
      assert.equal(same.title, 'Test');
    });

    it('can deactivate a task', async () => {
      const task = await svc.createDailyTask({ title: 'Test' });
      const updated = await svc.updateDailyTask(task.id, { isActive: false });
      assert.equal(updated.isActive, false);
    });
  });

  describe('deleteDailyTask', () => {
    it('deletes a task', async () => {
      const task = await svc.createDailyTask({ title: 'To delete' });
      const result = await svc.deleteDailyTask(task.id);
      assert.deepStrictEqual(result, { ok: true });
      const tasks = await svc.listDailyTasks();
      assert.equal(tasks.length, 0);
    });
  });

  describe('listDailyTasks', () => {
    it('returns all tasks by default', async () => {
      await svc.createDailyTask({ title: 'A' });
      await svc.createDailyTask({ title: 'B' });
      const all = await svc.listDailyTasks();
      assert.equal(all.length, 2);
    });

    it('filters active-only tasks', async () => {
      const task = await svc.createDailyTask({ title: 'Active' });
      await svc.createDailyTask({ title: 'Will deactivate' });
      await svc.updateDailyTask((await svc.listDailyTasks())[1].id, { isActive: false });
      const active = await svc.listDailyTasks({ activeOnly: true });
      assert.equal(active.length, 1);
      assert.equal(active[0].title, 'Active');
    });
  });

  // ─── Completions ────────────────────────────────────────────────────────

  describe('toggleCompletion', () => {
    it('toggles on: creates completion for date', async () => {
      const task = await svc.createDailyTask({ title: 'Test' });
      const result = await svc.toggleCompletion(task.id, '2025-03-20');
      assert.equal(result.completed, true);
      assert.equal(result.date, '2025-03-20');
    });

    it('toggles off: removes existing completion', async () => {
      const task = await svc.createDailyTask({ title: 'Test' });
      await svc.toggleCompletion(task.id, '2025-03-20');
      const result = await svc.toggleCompletion(task.id, '2025-03-20');
      assert.equal(result.completed, false);
    });

    it('count mode: sets exact number of completions', async () => {
      const task = await svc.createDailyTask({ title: 'Push-ups', totalTarget: 50, targetPeriod: 'daily' });
      const result = await svc.toggleCompletion(task.id, '2025-03-20', 3);
      assert.equal(result.completed, true);
      assert.equal(result.count, 3);

      // Verify 3 completion records
      const completions = await svc.listCompletions({ dailyTaskId: task.id, date: '2025-03-20' });
      assert.equal(completions.length, 3);
    });

    it('count mode: replaces existing completions', async () => {
      const task = await svc.createDailyTask({ title: 'Push-ups', totalTarget: 50, targetPeriod: 'daily' });
      await svc.toggleCompletion(task.id, '2025-03-20', 3);
      const result = await svc.toggleCompletion(task.id, '2025-03-20', 5);
      assert.equal(result.count, 5);

      const completions = await svc.listCompletions({ dailyTaskId: task.id, date: '2025-03-20' });
      assert.equal(completions.length, 5);
    });

    it('count=0 removes all completions', async () => {
      const task = await svc.createDailyTask({ title: 'Push-ups', totalTarget: 50, targetPeriod: 'daily' });
      await svc.toggleCompletion(task.id, '2025-03-20', 3);
      const result = await svc.toggleCompletion(task.id, '2025-03-20', 0);
      assert.equal(result.completed, false);
      assert.equal(result.count, 0);
    });

    it('completions for different dates are independent', async () => {
      const task = await svc.createDailyTask({ title: 'Test' });
      await svc.toggleCompletion(task.id, '2025-03-20');
      await svc.toggleCompletion(task.id, '2025-03-21');

      const day1 = await svc.listCompletions({ dailyTaskId: task.id, date: '2025-03-20' });
      const day2 = await svc.listCompletions({ dailyTaskId: task.id, date: '2025-03-21' });
      assert.equal(day1.length, 1);
      assert.equal(day2.length, 1);
    });
  });

  describe('listCompletions', () => {
    it('filters by date', async () => {
      const task = await svc.createDailyTask({ title: 'Test' });
      await svc.toggleCompletion(task.id, '2025-03-20');
      await svc.toggleCompletion(task.id, '2025-03-21');
      const results = await svc.listCompletions({ date: '2025-03-20' });
      assert.equal(results.length, 1);
      assert.equal(results[0].completedDate, '2025-03-20');
    });

    it('filters by weekStart (7-day range)', async () => {
      const task = await svc.createDailyTask({ title: 'Test' });
      await svc.toggleCompletion(task.id, '2025-03-17');
      await svc.toggleCompletion(task.id, '2025-03-20');
      await svc.toggleCompletion(task.id, '2025-03-25'); // outside range
      const results = await svc.listCompletions({ weekStart: '2025-03-17' });
      assert.equal(results.length, 2);
    });
  });

  // ─── Fixed Week Helpers ──────────────────────────────────────────────────

  describe('fixed Mon-Sun week helpers', () => {
    it('startOfFixedWeek returns Monday for any day in the week', () => {
      // 2025-03-20 = Thursday → Monday = 2025-03-17
      assert.equal(svc._startOfFixedWeek('2025-03-20'), '2025-03-17');
      // Monday itself
      assert.equal(svc._startOfFixedWeek('2025-03-17'), '2025-03-17');
      // Sunday → previous Monday
      assert.equal(svc._startOfFixedWeek('2025-03-23'), '2025-03-17');
      // Saturday
      assert.equal(svc._startOfFixedWeek('2025-03-22'), '2025-03-17');
    });

    it('endOfFixedWeek returns Sunday for any day in the week', () => {
      assert.equal(svc._endOfFixedWeek('2025-03-20'), '2025-03-23');
      assert.equal(svc._endOfFixedWeek('2025-03-17'), '2025-03-23');
      assert.equal(svc._endOfFixedWeek('2025-03-23'), '2025-03-23');
    });

    it('daysRemainingInFixedWeek counts remaining days including today', () => {
      // Thursday → Thu,Fri,Sat,Sun = 4
      assert.equal(svc._daysRemainingInFixedWeek('2025-03-20'), 4);
      // Monday → full week = 7
      assert.equal(svc._daysRemainingInFixedWeek('2025-03-17'), 7);
      // Sunday → last day = 1
      assert.equal(svc._daysRemainingInFixedWeek('2025-03-23'), 1);
      // Saturday → 2
      assert.equal(svc._daysRemainingInFixedWeek('2025-03-22'), 2);
    });
  });

  // ─── Weekly Progress ────────────────────────────────────────────────────

  describe('getWeeklyProgress', () => {
    // 2025-03-20 = Thursday. Fixed week = Mon 2025-03-17 to Sun 2025-03-23.
    // daysRemaining = 4 (Thu, Fri, Sat, Sun)

    it('returns progress for daily routine task (no totalTarget)', async () => {
      const task = await svc.createDailyTask({ title: 'Exercise', frequency: 'daily' });
      // Complete 3 times within the fixed Mon-Sun week (Mar 17-23)
      await svc.toggleCompletion(task.id, '2025-03-18'); // Tue
      await svc.toggleCompletion(task.id, '2025-03-19'); // Wed
      await svc.toggleCompletion(task.id, '2025-03-20'); // Thu

      const progress = await svc.getWeeklyProgress('2025-03-20');
      assert.equal(progress.length, 1);
      const p = progress[0];
      assert.equal(p.weeklyTarget, 7); // daily = 7 per week
      assert.equal(p.completedThisWeek, 3);
      assert.equal(p.remaining, 4);
      assert.equal(p.isOnTrack, false);
    });

    it('dailyQuota increases as week progresses (catch-up pressure)', async () => {
      const task = await svc.createDailyTask({ title: 'Exercise', frequency: 'daily' });
      // No completions — check quota on different days of the same week

      // Monday (7 days left): quota = ceil(7/7) = 1
      const mon = await svc.getWeeklyProgress('2025-03-17');
      assert.equal(mon[0].dailyQuota, 1);

      // Thursday (4 days left): quota = ceil(7/4) = 2
      const thu = await svc.getWeeklyProgress('2025-03-20');
      assert.equal(thu[0].dailyQuota, 2);

      // Sunday (1 day left): quota = ceil(7/1) = 7
      const sun = await svc.getWeeklyProgress('2025-03-23');
      assert.equal(sun[0].dailyQuota, 7);
    });

    it('returns progress for weekly routine task', async () => {
      const task = await svc.createDailyTask({ title: 'Weekly review', frequency: 'weekly' });
      const progress = await svc.getWeeklyProgress('2025-03-20');
      assert.equal(progress[0].weeklyTarget, 1);
    });

    it('returns progress for task with totalTarget + weekly period', async () => {
      const task = await svc.createDailyTask({ title: 'Read papers', totalTarget: 5, targetPeriod: 'weekly' });
      await svc.toggleCompletion(task.id, '2025-03-18');
      await svc.toggleCompletion(task.id, '2025-03-19');

      const progress = await svc.getWeeklyProgress('2025-03-20');
      const p = progress[0];
      assert.equal(p.weeklyTarget, 5);
      assert.equal(p.completedThisWeek, 2);
      assert.equal(p.remaining, 3);
      assert.equal(p.isOnTrack, false);
      // 3 remaining, 4 days left → ceil(3/4) = 1
      assert.equal(p.dailyQuota, 1);
    });

    it('returns progress for task with totalTarget + daily period', async () => {
      const task = await svc.createDailyTask({ title: 'Push-ups', totalTarget: 10, targetPeriod: 'daily' });
      const progress = await svc.getWeeklyProgress('2025-03-20');
      const p = progress[0];
      assert.equal(p.weeklyTarget, 70); // 10 * 7
    });

    it('returns progress for task with totalTarget + total period (all-time quota)', async () => {
      const task = await svc.createDailyTask({ title: 'Read 100 papers', totalTarget: 100, targetPeriod: 'total' });
      await svc.toggleCompletion(task.id, '2025-01-01');
      await svc.toggleCompletion(task.id, '2025-02-15');
      await svc.toggleCompletion(task.id, '2025-03-20');

      const progress = await svc.getWeeklyProgress('2025-03-20');
      const p = progress[0];
      assert.equal(p.weeklyTarget, 100);
      assert.equal(p.completedThisWeek, 3); // all-time count
      assert.equal(p.remaining, 97);
      assert.equal(p.dailyQuota, 0); // no daily pressure for 'total' tasks
    });

    it('dailyQuota is 0 when on track', async () => {
      const task = await svc.createDailyTask({ title: 'Test', frequency: 'daily' });
      // Complete all 7 days in fixed week Mon 2025-03-17 to Sun 2025-03-23
      for (let i = 0; i < 7; i++) {
        const d = new Date('2025-03-17T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + i);
        await svc.toggleCompletion(task.id, d.toISOString().slice(0, 10));
      }
      const progress = await svc.getWeeklyProgress('2025-03-20');
      assert.equal(progress[0].dailyQuota, 0);
      assert.equal(progress[0].isOnTrack, true);
    });

    it('only includes active tasks', async () => {
      await svc.createDailyTask({ title: 'Active' });
      const inactive = await svc.createDailyTask({ title: 'Inactive' });
      await svc.updateDailyTask(inactive.id, { isActive: false });

      const progress = await svc.getWeeklyProgress('2025-03-20');
      assert.equal(progress.length, 1);
      assert.equal(progress[0].title, 'Active');
    });

    it('completions outside the fixed week are not counted', async () => {
      const task = await svc.createDailyTask({ title: 'Test', frequency: 'daily' });
      // 2025-03-16 = Sunday of PREVIOUS week → should NOT count
      await svc.toggleCompletion(task.id, '2025-03-16');
      // 2025-03-24 = Monday of NEXT week → should NOT count
      await svc.toggleCompletion(task.id, '2025-03-24');
      // 2025-03-17 = Monday of THIS week → SHOULD count
      await svc.toggleCompletion(task.id, '2025-03-17');

      const progress = await svc.getWeeklyProgress('2025-03-20');
      assert.equal(progress[0].completedThisWeek, 1);
    });

    it('week resets on Monday (new week = clean slate)', async () => {
      const task = await svc.createDailyTask({ title: 'Test', frequency: 'daily' });
      // Fill previous week
      await svc.toggleCompletion(task.id, '2025-03-14'); // Fri of prev week
      await svc.toggleCompletion(task.id, '2025-03-16'); // Sun of prev week

      // Monday of new week — should have 0 completions
      const progress = await svc.getWeeklyProgress('2025-03-17');
      assert.equal(progress[0].completedThisWeek, 0);
      assert.equal(progress[0].remaining, 7);
      assert.equal(progress[0].dailyQuota, 1); // 7 remaining / 7 days
    });
  });

  // ─── Day Plans ──────────────────────────────────────────────────────────

  describe('getDayPlan / saveDayPlan', () => {
    it('returns null when no plan exists', async () => {
      const plan = await svc.getDayPlan('2025-03-20');
      assert.equal(plan, null);
    });

    it('saves and retrieves a day plan', async () => {
      const items = [
        { time: '09:00', title: 'Read papers', category: 'reading', estimatedMinutes: 60 },
        { time: '10:00', title: 'Code review', category: 'review', estimatedMinutes: 30 },
      ];
      await svc.saveDayPlan('2025-03-20', items, 'Productive day');
      const plan = await svc.getDayPlan('2025-03-20');
      assert.ok(plan);
      assert.equal(plan.planDate, '2025-03-20');
      assert.equal(plan.status, 'active');
      assert.equal(plan.summary, 'Productive day');
      assert.equal(plan.items.length, 2);
      assert.equal(plan.items[0].title, 'Read papers');
    });

    it('updates existing plan for same date', async () => {
      await svc.saveDayPlan('2025-03-20', [{ title: 'Old' }], 'Old summary');
      await svc.saveDayPlan('2025-03-20', [{ title: 'New' }], 'New summary');
      const plan = await svc.getDayPlan('2025-03-20');
      assert.equal(plan.items.length, 1);
      assert.equal(plan.items[0].title, 'New');
      assert.equal(plan.summary, 'New summary');
    });

    it('separate dates have separate plans', async () => {
      await svc.saveDayPlan('2025-03-20', [{ title: 'Day 1' }], '');
      await svc.saveDayPlan('2025-03-21', [{ title: 'Day 2' }], '');
      const plan1 = await svc.getDayPlan('2025-03-20');
      const plan2 = await svc.getDayPlan('2025-03-21');
      assert.equal(plan1.items[0].title, 'Day 1');
      assert.equal(plan2.items[0].title, 'Day 2');
    });

    it('handles empty items array', async () => {
      await svc.saveDayPlan('2025-03-20', [], 'Empty day');
      const plan = await svc.getDayPlan('2025-03-20');
      assert.deepStrictEqual(plan.items, []);
    });
  });

  // ─── buildDayContext ────────────────────────────────────────────────────

  describe('buildDayContext', () => {
    it('returns correct structure with all fields', async () => {
      const ctx = await svc.buildDayContext('2025-03-20');
      assert.ok(ctx.date);
      assert.ok(ctx.dayOfWeek);
      assert.ok(typeof ctx.daysRemainingInWeek === 'number');
      assert.ok(Array.isArray(ctx.pendingDailyTasks));
      assert.ok(Array.isArray(ctx.completedDailyTasks));
      assert.ok(Array.isArray(ctx.ongoingWorkItems));
      assert.ok(Array.isArray(ctx.milestones));
      assert.ok(Array.isArray(ctx.weeklyProgress));
    });

    it('correctly identifies day of week', async () => {
      // 2025-03-20 is a Thursday
      const ctx = await svc.buildDayContext('2025-03-20');
      assert.equal(ctx.dayOfWeek, 'Thursday');
    });

    it('separates pending vs completed daily tasks', async () => {
      const task1 = await svc.createDailyTask({ title: 'Pending task', frequency: 'daily' });
      const task2 = await svc.createDailyTask({ title: 'Done task', frequency: 'daily' });
      await svc.toggleCompletion(task2.id, '2025-03-20');

      const ctx = await svc.buildDayContext('2025-03-20');
      const pendingTitles = ctx.pendingDailyTasks.map(t => t.title);
      const completedTitles = ctx.completedDailyTasks.map(t => t.title);
      assert.ok(pendingTitles.includes('Pending task'));
      assert.ok(completedTitles.includes('Done task'));
    });

    it('includes weekly progress with correct fields', async () => {
      await svc.createDailyTask({ title: 'Test', frequency: 'daily' });
      const ctx = await svc.buildDayContext('2025-03-20');
      assert.equal(ctx.weeklyProgress.length, 1);
      const wp = ctx.weeklyProgress[0];
      assert.ok('weeklyTarget' in wp);
      assert.ok('completedThisWeek' in wp);
      assert.ok('remaining' in wp);
      assert.ok('dailyQuota' in wp);
      assert.ok('isOnTrack' in wp);
      assert.ok('isRoutine' in wp);
    });

    it('marks routine tasks correctly (totalTarget == null)', async () => {
      await svc.createDailyTask({ title: 'Routine', frequency: 'daily' });
      await svc.createDailyTask({ title: 'Targeted', totalTarget: 10, targetPeriod: 'weekly' });
      const ctx = await svc.buildDayContext('2025-03-20');
      const routine = ctx.weeklyProgress.find(w => w.title === 'Routine');
      const targeted = ctx.weeklyProgress.find(w => w.title === 'Targeted');
      assert.equal(routine.isRoutine, true);
      assert.equal(targeted.isRoutine, false);
    });

    it('excludes weekly tasks not scheduled for today', async () => {
      // 2025-03-20 is Thursday (day 4)
      await svc.createDailyTask({ title: 'Monday task', frequency: 'weekly', weekday: 1 }); // Monday
      await svc.createDailyTask({ title: 'Thursday task', frequency: 'weekly', weekday: 4 }); // Thursday

      const ctx = await svc.buildDayContext('2025-03-20');
      const pendingTitles = ctx.pendingDailyTasks.map(t => t.title);
      assert.ok(!pendingTitles.includes('Monday task'), 'Monday task should not appear on Thursday');
      assert.ok(pendingTitles.includes('Thursday task'), 'Thursday task should appear on Thursday');
    });

    it('includes weekly tasks with null weekday (any day)', async () => {
      await svc.createDailyTask({ title: 'Anyday weekly', frequency: 'weekly', weekday: null });
      const ctx = await svc.buildDayContext('2025-03-20');
      const pendingTitles = ctx.pendingDailyTasks.map(t => t.title);
      assert.ok(pendingTitles.includes('Anyday weekly'));
    });

    it('includes one_time tasks with remaining > 0', async () => {
      await svc.createDailyTask({ title: 'One-off', frequency: 'one_time' });
      const ctx = await svc.buildDayContext('2025-03-20');
      const pendingTitles = ctx.pendingDailyTasks.map(t => t.title);
      assert.ok(pendingTitles.includes('One-off'));
    });

    it('includes ongoing work items from aris_work_items', async () => {
      // Seed a project and work item directly
      tables.aris_projects.push({ id: 'proj1', name: 'ML Research' });
      tables.aris_work_items.push({
        id: 'wi1', project_id: 'proj1', title: 'Train model',
        status: 'in_progress', priority: 5, actor_type: 'human',
        type: 'task', archived_at: null,
      });

      const ctx = await svc.buildDayContext('2025-03-20');
      assert.equal(ctx.ongoingWorkItems.length, 1);
      assert.equal(ctx.ongoingWorkItems[0].title, 'Train model');
      assert.equal(ctx.ongoingWorkItems[0].projectName, 'ML Research');
    });

    it('excludes done/canceled work items', async () => {
      tables.aris_projects.push({ id: 'proj1', name: 'Test' });
      tables.aris_work_items.push(
        { id: 'wi1', project_id: 'proj1', title: 'Active', status: 'in_progress', archived_at: null },
        { id: 'wi2', project_id: 'proj1', title: 'Done', status: 'done', archived_at: null },
        { id: 'wi3', project_id: 'proj1', title: 'Canceled', status: 'canceled', archived_at: null },
      );

      const ctx = await svc.buildDayContext('2025-03-20');
      assert.equal(ctx.ongoingWorkItems.length, 1);
      assert.equal(ctx.ongoingWorkItems[0].title, 'Active');
    });

    it('includes upcoming one-time milestones within 14 days', async () => {
      tables.aris_projects.push({ id: 'proj1', name: 'Test' });
      tables.aris_milestones.push({
        id: 'm1', project_id: 'proj1', name: 'Paper deadline',
        due_at: '2025-03-25', status: 'planned',
        recurrence: null, recurrence_day: null,
      });

      const ctx = await svc.buildDayContext('2025-03-20');
      assert.equal(ctx.milestones.length, 1);
      assert.equal(ctx.milestones[0].name, 'Paper deadline');
      assert.equal(ctx.milestones[0].type, 'deadline');
      assert.equal(ctx.milestones[0].daysUntil, 5);
    });

    it('includes recurring milestones for today', async () => {
      tables.aris_projects.push({ id: 'proj1', name: 'Test' });
      // Thursday = day 4
      tables.aris_milestones.push({
        id: 'm1', project_id: 'proj1', name: 'Weekly standup',
        due_at: null, status: 'planned',
        recurrence: 'weekly', recurrence_day: 4, // Thursday
      });

      const ctx = await svc.buildDayContext('2025-03-20');
      const standup = ctx.milestones.find(m => m.name === 'Weekly standup');
      assert.ok(standup);
      assert.equal(standup.isToday, true);
      assert.equal(standup.type, 'recurring');
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('getWeeklyProgress with no tasks returns empty array', async () => {
      const progress = await svc.getWeeklyProgress('2025-03-20');
      assert.deepStrictEqual(progress, []);
    });

    it('buildDayContext with no data returns valid structure', async () => {
      const ctx = await svc.buildDayContext('2025-03-20');
      assert.equal(ctx.pendingDailyTasks.length, 0);
      assert.equal(ctx.completedDailyTasks.length, 0);
      assert.equal(ctx.ongoingWorkItems.length, 0);
      assert.equal(ctx.milestones.length, 0);
      assert.equal(ctx.weeklyProgress.length, 0);
    });

    it('fixed week: completion before Monday is not counted', async () => {
      const task = await svc.createDailyTask({ title: 'Test', frequency: 'daily' });
      // 2025-03-16 = Sunday (previous week) → NOT in Mon 17 – Sun 23 window
      await svc.toggleCompletion(task.id, '2025-03-16');
      const progress = await svc.getWeeklyProgress('2025-03-20');
      assert.equal(progress[0].completedThisWeek, 0);
    });

    it('fixed week: completion on Monday IS counted', async () => {
      const task = await svc.createDailyTask({ title: 'Test', frequency: 'daily' });
      // 2025-03-17 = Monday (start of fixed week)
      await svc.toggleCompletion(task.id, '2025-03-17');
      const progress = await svc.getWeeklyProgress('2025-03-20');
      assert.equal(progress[0].completedThisWeek, 1);
    });

    it('task completed today shows in completedDailyTasks, not pending', async () => {
      const task = await svc.createDailyTask({ title: 'Morning run', frequency: 'daily' });
      await svc.toggleCompletion(task.id, '2025-03-20');
      const ctx = await svc.buildDayContext('2025-03-20');
      assert.ok(ctx.completedDailyTasks.some(t => t.title === 'Morning run'));
      assert.ok(!ctx.pendingDailyTasks.some(t => t.title === 'Morning run'));
    });

    it('multiple count-based completions accumulate correctly in progress', async () => {
      const task = await svc.createDailyTask({ title: 'Push-ups', totalTarget: 10, targetPeriod: 'weekly' });
      await svc.toggleCompletion(task.id, '2025-03-18', 3);
      await svc.toggleCompletion(task.id, '2025-03-19', 2);
      await svc.toggleCompletion(task.id, '2025-03-20', 4);
      const progress = await svc.getWeeklyProgress('2025-03-20');
      assert.equal(progress[0].completedThisWeek, 9); // 3+2+4
      assert.equal(progress[0].remaining, 1);
    });
  });

  // ─── Finalize Day Plan ──────────────────────────────────────────────────

  describe('finalizeDayPlan', () => {
    it('marks a plan as finalized', async () => {
      await svc.saveDayPlan('2025-03-20', [{ title: 'Task A' }], 'Summary');
      const finalized = await svc.finalizeDayPlan('2025-03-20');
      assert.equal(finalized.status, 'finalized');
    });

    it('throws if no plan exists for the date', async () => {
      await assert.rejects(
        () => svc.finalizeDayPlan('2025-03-20'),
        /No plan found/,
      );
    });

    it('is idempotent — finalizing an already-finalized plan is a no-op', async () => {
      await svc.saveDayPlan('2025-03-20', [{ title: 'Task A' }], '');
      await svc.finalizeDayPlan('2025-03-20');
      const again = await svc.finalizeDayPlan('2025-03-20');
      assert.equal(again.status, 'finalized');
    });
  });

  // ─── Carry Over to Next Day ─────────────────────────────────────────────

  describe('carryOverToNextDay', () => {
    it('copies incomplete items to the next day', async () => {
      await svc.saveDayPlan('2025-03-20', [
        { title: 'Done task', isDone: true, sourceType: 'daily_task', sourceId: 't1' },
        { title: 'Incomplete task', isDone: false, sourceType: 'work_item', sourceId: 'w1' },
        { title: 'Another incomplete', isDone: false, sourceType: 'daily_task', sourceId: 't2' },
      ], 'Thursday plan');

      const result = await svc.carryOverToNextDay('2025-03-20');
      assert.equal(result.fromDate, '2025-03-20');
      assert.equal(result.toDate, '2025-03-21');
      assert.equal(result.carriedOver, 2);

      // Today's plan should be finalized
      const todayPlan = await svc.getDayPlan('2025-03-20');
      assert.equal(todayPlan.status, 'finalized');

      // Next day's plan should have the 2 incomplete items
      const nextPlan = await svc.getDayPlan('2025-03-21');
      assert.ok(nextPlan);
      assert.equal(nextPlan.items.length, 2);
      assert.ok(nextPlan.items.every(i => !i.isDone));
      assert.ok(nextPlan.items.every(i => i.carriedFrom === '2025-03-20'));
    });

    it('does not duplicate items already in next day plan', async () => {
      await svc.saveDayPlan('2025-03-20', [
        { title: 'Carry me', isDone: false, sourceType: 'work_item', sourceId: 'w1' },
      ], '');
      // Pre-seed next day with the same item
      await svc.saveDayPlan('2025-03-21', [
        { title: 'Carry me', isDone: false, sourceType: 'work_item', sourceId: 'w1' },
      ], 'Existing');

      const result = await svc.carryOverToNextDay('2025-03-20');
      assert.equal(result.carriedOver, 0); // deduped
      const nextPlan = await svc.getDayPlan('2025-03-21');
      assert.equal(nextPlan.items.length, 1); // no duplicates
    });

    it('handles all-items-done (nothing to carry over)', async () => {
      await svc.saveDayPlan('2025-03-20', [
        { title: 'Done', isDone: true },
        { title: 'Also done', isDone: true },
      ], '');

      const result = await svc.carryOverToNextDay('2025-03-20');
      assert.equal(result.carriedOver, 0);
      // Today should still be finalized
      const todayPlan = await svc.getDayPlan('2025-03-20');
      assert.equal(todayPlan.status, 'finalized');
    });

    it('throws if no source plan exists', async () => {
      await assert.rejects(
        () => svc.carryOverToNextDay('2025-03-20'),
        /No plan found/,
      );
    });

    it('merges carried items with existing next-day items', async () => {
      await svc.saveDayPlan('2025-03-20', [
        { title: 'Carry me', isDone: false, sourceType: 'daily_task', sourceId: 't1' },
      ], '');
      await svc.saveDayPlan('2025-03-21', [
        { title: 'Already planned', isDone: false, sourceType: 'daily_task', sourceId: 't2' },
      ], 'Pre-existing');

      const result = await svc.carryOverToNextDay('2025-03-20');
      assert.equal(result.carriedOver, 1);
      const nextPlan = await svc.getDayPlan('2025-03-21');
      assert.equal(nextPlan.items.length, 2);
      const titles = nextPlan.items.map(i => i.title);
      assert.ok(titles.includes('Already planned'));
      assert.ok(titles.includes('Carry me'));
    });

    it('strips time from carried items', async () => {
      await svc.saveDayPlan('2025-03-20', [
        { title: 'Timed task', time: '09:00', isDone: false, sourceType: 'daily_task', sourceId: 't1' },
      ], '');

      await svc.carryOverToNextDay('2025-03-20');
      const nextPlan = await svc.getDayPlan('2025-03-21');
      assert.equal(nextPlan.items[0].time, null);
    });

    it('cross-week carry-over works (Sunday to Monday)', async () => {
      await svc.saveDayPlan('2025-03-23', [
        { title: 'Weekend leftover', isDone: false, sourceType: 'work_item', sourceId: 'w1' },
      ], '');

      const result = await svc.carryOverToNextDay('2025-03-23');
      assert.equal(result.toDate, '2025-03-24'); // Monday of next week
      assert.equal(result.carriedOver, 1);
    });
  });
});
