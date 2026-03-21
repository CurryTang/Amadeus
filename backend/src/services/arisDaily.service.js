const crypto = require('crypto');
const { getDb } = require('../db');

const DAILY_TASK_CATEGORIES = [
  'reading',
  'exercise',
  'coding',
  'research',
  'writing',
  'review',
  'learning',
  'general',
];

const DAILY_TASK_FREQUENCIES = ['daily', 'weekly', 'one_time'];

function uid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function normalizeDailyTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    category: row.category || 'general',
    frequency: row.frequency || 'daily',
    weekday: row.weekday ?? null,
    estimatedMinutes: row.estimated_minutes ?? 30,
    weeklyCredit: row.weekly_credit ?? 7,
    priority: row.priority ?? 0,
    isActive: row.is_active === 1 || row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeCompletion(row) {
  if (!row) return null;
  return {
    id: row.id,
    dailyTaskId: row.daily_task_id,
    completedDate: row.completed_date,
    notes: row.notes || '',
    durationMinutes: row.duration_minutes ?? null,
    createdAt: row.created_at,
  };
}

function normalizeDayPlan(row) {
  if (!row) return null;
  let planItems = [];
  try {
    planItems = JSON.parse(row.plan_json || '[]');
  } catch (_) { /* ignore */ }
  return {
    id: row.id,
    planDate: row.plan_date,
    status: row.status || 'draft',
    items: planItems,
    summary: row.summary || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

function createArisDailyService() {
  // ─── Daily Tasks CRUD ────────────────────────────────────────────────────

  async function listDailyTasks({ activeOnly = false } = {}) {
    const db = getDb();
    const sql = activeOnly
      ? `SELECT * FROM aris_daily_tasks WHERE is_active = 1 ORDER BY priority DESC, created_at ASC`
      : `SELECT * FROM aris_daily_tasks ORDER BY is_active DESC, priority DESC, created_at ASC`;
    const result = await db.execute(sql);
    return (result.rows || []).map(normalizeDailyTask).filter(Boolean);
  }

  async function getDailyTask(id) {
    const db = getDb();
    const result = await db.execute({ sql: `SELECT * FROM aris_daily_tasks WHERE id = ?`, args: [id] });
    return normalizeDailyTask(result.rows?.[0]);
  }

  async function createDailyTask({ title, description, category, frequency, weekday, estimatedMinutes, weeklyCredit, priority }) {
    if (!title?.trim()) throw new Error('Title is required');
    if (frequency && !DAILY_TASK_FREQUENCIES.includes(frequency)) {
      throw new Error(`Invalid frequency: ${frequency}. Must be one of: ${DAILY_TASK_FREQUENCIES.join(', ')}`);
    }
    const db = getDb();
    const id = uid();
    const now = nowIso();
    // Calculate default weekly credit based on frequency
    let credit = weeklyCredit;
    if (credit == null) {
      if (frequency === 'daily') credit = 7;
      else if (frequency === 'weekly') credit = 1;
      else credit = 1; // one_time
    }
    await db.execute({
      sql: `INSERT INTO aris_daily_tasks (id, title, description, category, frequency, weekday, estimated_minutes, weekly_credit, priority, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      args: [id, title.trim(), description || '', category || 'general', frequency || 'daily', weekday ?? null, estimatedMinutes ?? 30, credit, priority ?? 0, now, now],
    });
    return getDailyTask(id);
  }

  async function updateDailyTask(id, updates) {
    const existing = await getDailyTask(id);
    if (!existing) throw new Error('Daily task not found');
    const db = getDb();
    const now = nowIso();
    const fields = [];
    const args = [];
    const allowed = { title: 'title', description: 'description', category: 'category', frequency: 'frequency', weekday: 'weekday', estimatedMinutes: 'estimated_minutes', weeklyCredit: 'weekly_credit', priority: 'priority', isActive: 'is_active' };
    for (const [key, col] of Object.entries(allowed)) {
      if (updates[key] !== undefined) {
        let val = updates[key];
        if (key === 'isActive') val = val ? 1 : 0;
        fields.push(`${col} = ?`);
        args.push(val);
      }
    }
    if (fields.length === 0) return existing;
    fields.push('updated_at = ?');
    args.push(now);
    args.push(id);
    await db.execute({ sql: `UPDATE aris_daily_tasks SET ${fields.join(', ')} WHERE id = ?`, args });
    return getDailyTask(id);
  }

  async function deleteDailyTask(id) {
    const db = getDb();
    await db.execute({ sql: `DELETE FROM aris_daily_tasks WHERE id = ?`, args: [id] });
    return { ok: true };
  }

  // ─── Completions ─────────────────────────────────────────────────────────

  async function listCompletions({ date, weekStart, dailyTaskId } = {}) {
    const db = getDb();
    const conditions = [];
    const args = [];
    if (dailyTaskId) {
      conditions.push('daily_task_id = ?');
      args.push(dailyTaskId);
    }
    if (date) {
      conditions.push('completed_date = ?');
      args.push(date);
    } else if (weekStart) {
      const weekEnd = new Date(new Date(weekStart + 'T00:00:00Z').getTime() + 6 * 86400000).toISOString().slice(0, 10);
      conditions.push('completed_date >= ? AND completed_date <= ?');
      args.push(weekStart, weekEnd);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.execute({ sql: `SELECT * FROM aris_daily_completions ${where} ORDER BY completed_date DESC, created_at DESC`, args });
    return (result.rows || []).map(normalizeCompletion).filter(Boolean);
  }

  async function toggleCompletion(dailyTaskId, date) {
    const db = getDb();
    date = date || todayDate();
    // Check if already completed today
    const existing = await db.execute({
      sql: `SELECT id FROM aris_daily_completions WHERE daily_task_id = ? AND completed_date = ?`,
      args: [dailyTaskId, date],
    });
    if (existing.rows?.length > 0) {
      // Un-complete: remove
      await db.execute({ sql: `DELETE FROM aris_daily_completions WHERE id = ?`, args: [existing.rows[0].id] });
      return { completed: false, date };
    }
    // Complete: add
    const id = uid();
    await db.execute({
      sql: `INSERT INTO aris_daily_completions (id, daily_task_id, completed_date, created_at) VALUES (?, ?, ?, ?)`,
      args: [id, dailyTaskId, date, nowIso()],
    });
    return { completed: true, date };
  }

  // ─── Weekly Credit Calculation ───────────────────────────────────────────

  async function getWeeklyProgress(dateStr) {
    const weekStart = startOfWeek(dateStr || todayDate());
    const tasks = await listDailyTasks({ activeOnly: true });
    const completions = await listCompletions({ weekStart });

    const completionsByTask = {};
    for (const c of completions) {
      if (!completionsByTask[c.dailyTaskId]) completionsByTask[c.dailyTaskId] = [];
      completionsByTask[c.dailyTaskId].push(c);
    }

    return tasks.map((task) => {
      const taskCompletions = completionsByTask[task.id] || [];
      const completedCount = taskCompletions.length;
      const credit = task.frequency === 'one_time' ? 1 : task.weeklyCredit;
      return {
        ...task,
        weeklyCredit: credit,
        completedThisWeek: completedCount,
        remaining: Math.max(0, credit - completedCount),
        isOnTrack: completedCount >= credit,
      };
    });
  }

  // ─── Cross-Project Ongoing Tasks ─────────────────────────────────────────

  async function getOngoingWorkItems() {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT wi.*, p.name as project_name
            FROM aris_work_items wi
            JOIN aris_projects p ON p.id = wi.project_id
            WHERE wi.status IN ('in_progress', 'ready', 'review', 'blocked', 'waiting')
              AND wi.archived_at IS NULL
            ORDER BY
              CASE wi.status
                WHEN 'blocked' THEN 0
                WHEN 'review' THEN 1
                WHEN 'in_progress' THEN 2
                WHEN 'waiting' THEN 3
                WHEN 'ready' THEN 4
                ELSE 5
              END,
              COALESCE(wi.priority, 0) DESC,
              datetime(COALESCE(wi.updated_at, wi.created_at)) DESC`,
    });
    return (result.rows || []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      title: row.title,
      summary: row.summary || '',
      type: row.type || 'task',
      status: row.status,
      priority: row.priority ?? 0,
      actorType: row.actor_type || 'human',
      dueAt: row.due_at || null,
      estimatedMinutes: row.estimated_minutes ?? null,
      nextBestAction: row.next_best_action || '',
      updatedAt: row.updated_at,
    }));
  }

  // ─── Day Plans ───────────────────────────────────────────────────────────

  async function getDayPlan(date) {
    const db = getDb();
    date = date || todayDate();
    const result = await db.execute({ sql: `SELECT * FROM aris_day_plans WHERE plan_date = ? ORDER BY created_at DESC LIMIT 1`, args: [date] });
    return normalizeDayPlan(result.rows?.[0]);
  }

  async function saveDayPlan(date, items, summary) {
    const db = getDb();
    date = date || todayDate();
    const existing = await getDayPlan(date);
    const now = nowIso();
    if (existing) {
      await db.execute({
        sql: `UPDATE aris_day_plans SET plan_json = ?, summary = ?, status = 'active', updated_at = ? WHERE id = ?`,
        args: [JSON.stringify(items), summary || '', now, existing.id],
      });
      return getDayPlan(date);
    }
    const id = uid();
    await db.execute({
      sql: `INSERT INTO aris_day_plans (id, plan_date, status, plan_json, summary, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?, ?)`,
      args: [id, date, JSON.stringify(items), summary || '', now, now],
    });
    return getDayPlan(date);
  }

  // ─── Schedule My Day (build context for Codex MCP) ───────────────────────

  async function buildDayContext(date) {
    date = date || todayDate();
    const weeklyProgress = await getWeeklyProgress(date);
    const ongoingItems = await getOngoingWorkItems();
    const todayCompletions = await listCompletions({ date });
    const completedTaskIds = new Set(todayCompletions.map((c) => c.dailyTaskId));

    // Filter daily tasks that are due today
    const dayOfWeek = new Date(date + 'T00:00:00Z').getUTCDay(); // 0=Sun
    const todayTasks = weeklyProgress.filter((task) => {
      if (!task.isActive) return false;
      if (task.frequency === 'daily') return true;
      if (task.frequency === 'weekly') return task.weekday === dayOfWeek || task.weekday === null;
      if (task.frequency === 'one_time') return task.remaining > 0;
      return false;
    });

    // Tasks that still have weekly credit remaining and aren't done today
    const pendingDailyTasks = todayTasks.filter((t) => t.remaining > 0 && !completedTaskIds.has(t.id));
    const completedDailyTasks = todayTasks.filter((t) => completedTaskIds.has(t.id));

    return {
      date,
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
      pendingDailyTasks: pendingDailyTasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        estimatedMinutes: t.estimatedMinutes,
        weeklyCredit: t.weeklyCredit,
        completedThisWeek: t.completedThisWeek,
        remaining: t.remaining,
      })),
      completedDailyTasks: completedDailyTasks.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
      })),
      ongoingWorkItems: ongoingItems.map((item) => ({
        id: item.id,
        projectName: item.projectName,
        title: item.title,
        type: item.type,
        status: item.status,
        priority: item.priority,
        actorType: item.actorType,
        dueAt: item.dueAt,
        nextBestAction: item.nextBestAction,
      })),
      weeklyProgress: weeklyProgress.map((t) => ({
        title: t.title,
        weeklyCredit: t.weeklyCredit,
        completedThisWeek: t.completedThisWeek,
        remaining: t.remaining,
        isOnTrack: t.isOnTrack,
      })),
    };
  }

  return {
    DAILY_TASK_CATEGORIES,
    DAILY_TASK_FREQUENCIES,
    listDailyTasks,
    getDailyTask,
    createDailyTask,
    updateDailyTask,
    deleteDailyTask,
    listCompletions,
    toggleCompletion,
    getWeeklyProgress,
    getOngoingWorkItems,
    getDayPlan,
    saveDayPlan,
    buildDayContext,
  };
}

module.exports = { createArisDailyService };
