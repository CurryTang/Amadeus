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

function endOfWeek(dateStr) {
  const ws = startOfWeek(dateStr);
  const d = new Date(ws + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

function daysRemainingInWeek(dateStr) {
  const we = endOfWeek(dateStr);
  const today = new Date(dateStr + 'T00:00:00Z');
  const end = new Date(we + 'T00:00:00Z');
  return Math.max(1, Math.round((end - today) / 86400000) + 1); // including today
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
    // Legacy: weekly_credit still in DB, but we expose totalTarget
    weeklyCredit: row.weekly_credit ?? (row.total_target || 7),
    totalTarget: row.total_target ?? null, // null = routine task (no target)
    targetPeriod: row.target_period || 'weekly',
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

function normalizeMilestone(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name || '',
    description: row.description || '',
    dueAt: row.due_at || null,
    status: row.status || 'planned',
    recurrence: row.recurrence || null, // null | 'weekly'
    recurrenceDay: row.recurrence_day ?? null, // 0=Sun, 6=Sat
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

  async function createDailyTask({ title, description, category, frequency, weekday, estimatedMinutes, weeklyCredit, totalTarget, targetPeriod, priority }) {
    if (!title?.trim()) throw new Error('Title is required');
    if (frequency && !DAILY_TASK_FREQUENCIES.includes(frequency)) {
      throw new Error(`Invalid frequency: ${frequency}. Must be one of: ${DAILY_TASK_FREQUENCIES.join(', ')}`);
    }
    const db = getDb();
    const id = uid();
    const now = nowIso();
    // Backward compat: if weeklyCredit provided but totalTarget not, use weeklyCredit as totalTarget
    let target = totalTarget ?? null;
    if (target == null && weeklyCredit != null && weeklyCredit !== 7 && weeklyCredit !== 1) {
      target = weeklyCredit;
    }
    // For weekly_credit column (legacy), compute from totalTarget or default
    const credit = target ?? (frequency === 'daily' ? 7 : 1);
    await db.execute({
      sql: `INSERT INTO aris_daily_tasks (id, title, description, category, frequency, weekday, estimated_minutes, weekly_credit, total_target, target_period, priority, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      args: [id, title.trim(), description || '', category || 'general', frequency || 'daily', weekday ?? null, estimatedMinutes ?? 30, credit, target, targetPeriod || 'weekly', priority ?? 0, now, now],
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
    const allowed = {
      title: 'title', description: 'description', category: 'category',
      frequency: 'frequency', weekday: 'weekday', estimatedMinutes: 'estimated_minutes',
      weeklyCredit: 'weekly_credit', totalTarget: 'total_target', targetPeriod: 'target_period',
      priority: 'priority', isActive: 'is_active',
    };
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

  async function toggleCompletion(dailyTaskId, date, count) {
    const db = getDb();
    date = date || todayDate();
    const existing = await db.execute({
      sql: `SELECT id FROM aris_daily_completions WHERE daily_task_id = ? AND completed_date = ?`,
      args: [dailyTaskId, date],
    });

    // If count is provided (target-based task), add multiple completions or remove today's
    if (count != null && count > 0) {
      // Remove any existing completions for today first
      for (const row of (existing.rows || [])) {
        await db.execute({ sql: `DELETE FROM aris_daily_completions WHERE id = ?`, args: [row.id] });
      }
      // Add 'count' completions for today
      for (let i = 0; i < count; i++) {
        const id = uid();
        await db.execute({
          sql: `INSERT INTO aris_daily_completions (id, daily_task_id, completed_date, created_at) VALUES (?, ?, ?, ?)`,
          args: [id, dailyTaskId, date, nowIso()],
        });
      }
      return { completed: true, date, count };
    }

    // Simple toggle (routine tasks)
    if (existing.rows?.length > 0) {
      // Remove all completions for today
      for (const row of (existing.rows || [])) {
        await db.execute({ sql: `DELETE FROM aris_daily_completions WHERE id = ?`, args: [row.id] });
      }
      return { completed: false, date };
    }
    const id = uid();
    await db.execute({
      sql: `INSERT INTO aris_daily_completions (id, daily_task_id, completed_date, created_at) VALUES (?, ?, ?, ?)`,
      args: [id, dailyTaskId, date, nowIso()],
    });
    return { completed: true, date };
  }

  // ─── Weekly Progress + Daily Quota Calculation ────────────────────────────

  async function getWeeklyProgress(dateStr) {
    dateStr = dateStr || todayDate();
    const ws = startOfWeek(dateStr);
    const tasks = await listDailyTasks({ activeOnly: true });
    const completions = await listCompletions({ weekStart: ws });

    const completionsByTask = {};
    for (const c of completions) {
      if (!completionsByTask[c.dailyTaskId]) completionsByTask[c.dailyTaskId] = [];
      completionsByTask[c.dailyTaskId].push(c);
    }

    const daysLeft = daysRemainingInWeek(dateStr);

    return tasks.map((task) => {
      const taskCompletions = completionsByTask[task.id] || [];
      const completedCount = taskCompletions.length;

      // Determine the effective weekly target
      let weeklyTarget;
      if (task.totalTarget != null) {
        // User-set target (e.g. "10 leetcode/week")
        weeklyTarget = task.targetPeriod === 'daily' ? task.totalTarget * 7 : task.totalTarget;
      } else {
        // Routine task: frequency-based (daily=7, weekly=1, one_time=1)
        weeklyTarget = task.frequency === 'daily' ? 7 : 1;
      }

      const remaining = Math.max(0, weeklyTarget - completedCount);
      // Daily quota: how many should be done today to stay on track
      const dailyQuota = remaining > 0 ? Math.ceil(remaining / daysLeft) : 0;

      return {
        ...task,
        weeklyCredit: weeklyTarget, // backward compat
        weeklyTarget,
        totalTarget: task.totalTarget,
        targetPeriod: task.targetPeriod,
        completedThisWeek: completedCount,
        remaining,
        dailyQuota,
        isOnTrack: completedCount >= weeklyTarget,
      };
    });
  }

  // ─── Cross-Project Ongoing Tasks ─────────────────────────────────────────

  async function getOngoingWorkItems() {
    const db = getDb();
    const projectsResult = await db.execute(`SELECT id, name FROM aris_projects`);
    const projectMap = {};
    for (const p of (projectsResult.rows || [])) {
      projectMap[p.id] = p.name;
    }

    // Only two states matter: ongoing (everything not done/canceled) and done
    const result = await db.execute({
      sql: `SELECT * FROM aris_work_items
            WHERE status NOT IN ('done', 'canceled')
              AND archived_at IS NULL
            ORDER BY
              COALESCE(priority, 0) DESC,
              datetime(COALESCE(updated_at, created_at)) DESC`,
    });
    return (result.rows || [])
      .map((row) => ({
        id: row.id,
        projectId: row.project_id,
        projectName: projectMap[row.project_id] || 'Unknown Project',
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

  // ─── Milestones (scheduling-relevant) ─────────────────────────────────────

  async function getUpcomingMilestones(dateStr) {
    const db = getDb();
    dateStr = dateStr || todayDate();
    const dayOfWeek = new Date(dateStr + 'T00:00:00Z').getUTCDay();

    // Get project names
    const projectsResult = await db.execute(`SELECT id, name FROM aris_projects`);
    const projectMap = {};
    for (const p of (projectsResult.rows || [])) {
      projectMap[p.id] = p.name;
    }

    // One-time milestones with due_at in next 14 days
    const twoWeeksOut = new Date(new Date(dateStr + 'T00:00:00Z').getTime() + 14 * 86400000).toISOString().slice(0, 10);
    const oneTimeResult = await db.execute({
      sql: `SELECT * FROM aris_milestones
            WHERE status != 'completed'
              AND recurrence IS NULL
              AND due_at IS NOT NULL
              AND date(due_at) >= date(?)
              AND date(due_at) <= date(?)
            ORDER BY due_at ASC`,
      args: [dateStr, twoWeeksOut],
    });

    // Weekly recurring milestones
    const recurringResult = await db.execute({
      sql: `SELECT * FROM aris_milestones
            WHERE status != 'completed'
              AND recurrence = 'weekly'`,
    });

    const milestones = [];

    for (const row of (oneTimeResult.rows || [])) {
      const m = normalizeMilestone(row);
      const daysUntil = Math.round((new Date(m.dueAt).getTime() - new Date(dateStr + 'T00:00:00Z').getTime()) / 86400000);
      milestones.push({
        ...m,
        projectName: projectMap[m.projectId] || 'Unknown',
        type: 'deadline',
        daysUntil,
        isToday: daysUntil === 0,
      });
    }

    for (const row of (recurringResult.rows || [])) {
      const m = normalizeMilestone(row);
      const isToday = m.recurrenceDay === dayOfWeek;
      // Calculate days until next occurrence
      let daysUntil = (m.recurrenceDay - dayOfWeek + 7) % 7;
      if (daysUntil === 0) daysUntil = 0; // today
      milestones.push({
        ...m,
        projectName: projectMap[m.projectId] || 'Unknown',
        type: 'recurring',
        daysUntil,
        isToday,
      });
    }

    // Sort: today first, then by daysUntil
    milestones.sort((a, b) => {
      if (a.isToday && !b.isToday) return -1;
      if (!a.isToday && b.isToday) return 1;
      return a.daysUntil - b.daysUntil;
    });

    return milestones;
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

  // ─── Schedule My Day (build context) ──────────────────────────────────────

  async function buildDayContext(date) {
    date = date || todayDate();
    const weeklyProgress = await getWeeklyProgress(date);
    const ongoingItems = await getOngoingWorkItems();
    const todayCompletions = await listCompletions({ date });
    const completedTaskIds = new Set(todayCompletions.map((c) => c.dailyTaskId));
    const milestones = await getUpcomingMilestones(date);

    // Filter daily tasks that are due today
    const dayOfWeek = new Date(date + 'T00:00:00Z').getUTCDay(); // 0=Sun
    const todayTasks = weeklyProgress.filter((task) => {
      if (!task.isActive) return false;
      if (task.frequency === 'daily') return true;
      if (task.frequency === 'weekly') return task.weekday === dayOfWeek || task.weekday === null;
      if (task.frequency === 'one_time') return task.remaining > 0;
      return false;
    });

    // Tasks that still have remaining target and aren't done today
    const pendingDailyTasks = todayTasks.filter((t) => t.remaining > 0 && !completedTaskIds.has(t.id));
    const completedDailyTasks = todayTasks.filter((t) => completedTaskIds.has(t.id));

    const daysLeft = daysRemainingInWeek(date);

    return {
      date,
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
      daysRemainingInWeek: daysLeft,
      pendingDailyTasks: pendingDailyTasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        estimatedMinutes: t.estimatedMinutes,
        weeklyTarget: t.weeklyTarget,
        totalTarget: t.totalTarget,
        targetPeriod: t.targetPeriod,
        completedThisWeek: t.completedThisWeek,
        remaining: t.remaining,
        dailyQuota: t.dailyQuota,
        isRoutine: t.totalTarget == null, // no target = routine task
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
      milestones: milestones.map((m) => ({
        id: m.id,
        name: m.name,
        projectName: m.projectName,
        type: m.type, // 'deadline' | 'recurring'
        daysUntil: m.daysUntil,
        isToday: m.isToday,
        dueAt: m.dueAt,
        recurrenceDay: m.recurrenceDay,
      })),
      weeklyProgress: weeklyProgress.map((t) => ({
        title: t.title,
        weeklyTarget: t.weeklyTarget,
        totalTarget: t.totalTarget,
        completedThisWeek: t.completedThisWeek,
        remaining: t.remaining,
        dailyQuota: t.dailyQuota,
        isOnTrack: t.isOnTrack,
        isRoutine: t.totalTarget == null,
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
    getUpcomingMilestones,
    getDayPlan,
    saveDayPlan,
    buildDayContext,
  };
}

module.exports = { createArisDailyService };
