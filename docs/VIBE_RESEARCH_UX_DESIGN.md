# Vibe Research — UX Design Review

**Audience:** Codex agent implementing frontend/backend improvements
**Codebase:** `frontend/src/components/VibeResearcherPanel.jsx`, `frontend/src/index.css`, `backend/src/routes/researchops.js`
**Goal:** Make the research → implement → run → check → iterate loop fast and obvious

---

## Mental model of a vibe researcher

A typical session looks like this:

```
Read paper → Extract idea → Plan experiment
     ↓
Implement code change (agent)
     ↓
Run experiment / bash script
     ↓
Check output numbers
     ↓
Compare with baseline → Decide next step
     ↓
Iterate (loop back)
```

The current UI handles the middle steps (implement, run) but **fails at the transitions**: "what should I do next?", "how do I quickly re-run?", "where are the numbers?"

---

## Priority 1 — Quick Bash Runner

### Problem
Running `python eval.py --lr 0.001` currently requires going through "Experiment" skill → Codex agent plans it → schedules bash → waits. This is 2–4 minutes of latency for something that should take 2 seconds to trigger.

### Design

Add a **Quick Bash** panel between the launcher and the workspace grid. It is always visible when a project is selected.

```
┌─────────────────────────────────────────────────────────────────────┐
│ $ [compute.example.edu ▾]  [python eval.py --seed 42 ─────────────] [▶ Run] │
│                                                                     │
│ (output appears here, last 20 lines, scrollable)                    │
│ > Epoch 10/10: loss=0.023  acc=0.891                                │
│ > Done in 4.2s                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**State variables to add:**
```jsx
const [quickBashCmd, setQuickBashCmd] = useState('');
const [quickBashRunning, setQuickBashRunning] = useState(false);
const [quickBashLog, setQuickBashLog] = useState([]); // array of strings
const [quickBashRunId, setQuickBashRunId] = useState(null);
```

**How it works:**
1. User types a command and presses Enter or clicks Run
2. POST to `/researchops/runs` with `runType: 'EXPERIMENT'`, `schemaVersion: '1.0'`, `metadata.command` and `metadata.args` directly (not going through Codex planning)
3. Poll run events every 2s while RUNNING, append LOG_LINE events to `quickBashLog`
4. When done, show exit status (SUCCEEDED in green, FAILED in red)
5. The completed run appears in Run History as usual

**Backend note:** The existing `runner.js` `resolveExecutionSpec` for non-v2 runs already handles `metadata.command` + `metadata.args` directly. No backend changes needed.

**CSS class:** `.vibe-quick-bash` — dark terminal background (`#0f172a`), monospace font, max-height 180px scrollable.

**Placement:** Between `.vibe-launcher` and `.vibe-workspace-grid--neo`.

---

## Priority 2 — Live Log Tail While Running

### Problem
When a run is RUNNING, the Outputs card is blank. The user has no feedback. They don't know if the agent is doing anything.

### Design

When `selectedRun?.status === 'RUNNING'`, poll `GET /researchops/runs/{id}/report?inline=true` every 3 seconds. Extract `events` with `eventType === 'LOG_LINE'` and display the **last 8 lines** in the Outputs card, replacing the artifact list.

```
┌─ Outputs ──────────────────────── ● LIVE ─┐
│ [stdout] Loading dataset...                │
│ [stdout] Epoch 1/10: loss=2.14             │
│ [stdout] Epoch 2/10: loss=1.87             │
│ [stderr] Warning: CUDA memory 94%          │
│ (polling every 3s)                         │
└────────────────────────────────────────────┘
```

**Implementation:**
```jsx
// In Outputs card, before artifact list:
{selectedRun?.status === 'RUNNING' && (
  <div className="vibe-live-log">
    <span className="vibe-live-indicator">● LIVE</span>
    {liveLogs.slice(-8).map((line, i) => (
      <code key={i} className="vibe-log-line">{line}</code>
    ))}
  </div>
)}
```

**State variables:**
```jsx
const [liveLogs, setLiveLogs] = useState([]);
const liveLogTimerRef = useRef(null);
```

**Effect:** When `selectedRunId` changes or `selectedRun.status` becomes RUNNING, start a 3s interval that fetches events and sets `liveLogs`. Clear interval when status leaves RUNNING.

**CSS:** `.vibe-live-log` dark bg, monospace, `.vibe-live-indicator` red pulsing dot (CSS animation).

---

## Priority 3 — Run Result Snippet + Re-run Button

### Problem
Run History rows show only status + skill + prompt + timestamp. After a run completes, the key output (loss, accuracy, error message) is invisible. To retry, you must scroll up and retype the prompt.

### Design

**3a. Result snippet in run row**

After run row, if `run.status` is SUCCEEDED or FAILED, show 1 line of the most meaningful output:

```
┌──────────────────────────────────────────────────────────────────┐
│ ✓ SUCCEEDED  implement  "Add attention pooling to..."  Feb 25    │
│   › Epoch 10: loss=0.023, acc=0.891 · 3 files changed           │
├──────────────────────────────────────────────────────────────────┤
│ ✗ FAILED     implement  "Fix CUDA OOM error"           Feb 25    │
│   › RuntimeError: CUDA out of memory at train.py:142             │
└──────────────────────────────────────────────────────────────────┘
```

The snippet comes from `run.metadata?.resultSnippet` (populated by backend on completion) OR parsed from the last meaningful LOG_LINE stored in `run.metadata`.

**Backend change:** In `runner.js` `child.on('close')`, before calling `updateRunStatus`, extract the last non-empty stdout line and store it:
```js
// In store.updateRunStatus call, pass extra metadata:
{ resultSnippet: lastStdoutLine.slice(0, 120) }
```

This requires `updateRunStatus` to accept an optional metadata patch (check `store.js`).

**3b. Re-run button**

Add a `↺` button on hover to each run row that:
- Copies `run.metadata.prompt` into `runPrompt` state
- Sets `agentSkill` to match `run.metadata.agentSkill`
- Scrolls to the launcher
- Does NOT submit — lets user review/edit before launching

```jsx
<button
  className="vibe-run-rerun-btn"
  onClick={(e) => {
    e.stopPropagation();
    setRunPrompt(run.metadata?.prompt || '');
    setAgentSkill(run.metadata?.agentSkill || 'implement');
    launcherRef.current?.scrollIntoView({ behavior: 'smooth' });
  }}
  title="Copy prompt to launcher"
>↺</button>
```

Add `const launcherRef = useRef(null)` and attach to the launcher div.

---

## Priority 4 — "What's Next?" Post-Run Suggestions

### Problem
After a run completes (success or failure), the user stares at the result and must independently decide what to do next. For a new researcher this is the hardest part.

### Design

In the **Outputs card**, after the artifact list, add a "Suggested Next Steps" section. This is populated by the run report's `summary` field, or by a lightweight prompt to the backend.

```
┌─ Outputs ─────────────────────────────────┐
│ 3 artifacts                               │
│ [README.md] [eval_results.json] [plot.png]│
│                                           │
│ ── Suggested next steps ──                │
│ ○ Run with seed=42,43,44 for variance     │
│ ○ Compare against baseline in results/    │
│ ○ Write findings to docs/notes.md         │
│                          [→ Implement #1] │
└────────────────────────────────────────────┘
```

**Implementation path (minimal):**
1. The `report.render` workflow step (already in the v2 workflow) produces a `summary` field
2. Parse the summary for bullet points (lines starting with `- ` or `* `)
3. Display top 3 bullets as "suggested next steps"
4. Each bullet has a "→ Launch" button that pre-fills the launcher

**State:**
```jsx
const nextStepSuggestions = useMemo(() => {
  const summary = runReport?.summary || '';
  return summary.split('\n')
    .filter(l => l.match(/^[-*]\s/))
    .map(l => l.replace(/^[-*]\s/, '').trim())
    .slice(0, 3);
}, [runReport]);
```

**No backend change needed** if report.render already produces structured output.

---

## Priority 5 — Idea → Implement Direct Button

### Problem
The Project Management card shows todos/ideas but they're dead ends. You read "idea: implement gradient checkpointing" but have to manually copy it to the launcher.

### Design

Add an "→ Implement" button to each open idea in the Project Management card:

```jsx
{!done && (
  <button
    className="vibe-secondary-btn vibe-todo-implement-btn"
    onClick={() => {
      setRunPrompt(idea.hypothesis || idea.title);
      setAgentSkill('implement');
      launcherRef.current?.scrollIntoView({ behavior: 'smooth' });
    }}
  >
    → Implement
  </button>
)}
```

This pre-fills the launcher with the idea's hypothesis as the prompt, sets skill to "implement", and scrolls to the top. User reviews and clicks Launch.

---

## Priority 6 — Key Metrics Extraction from Logs

### Problem
Experiment results buried in long log text. Researchers care about 3-5 numbers.

### Design

In the Outputs card, add a "Key Metrics" panel that auto-extracts `key: value` and `key = value` patterns from log lines:

```
┌─ Key Metrics ─────────────────────┐
│ loss          0.0234              │
│ accuracy      89.1%               │
│ epoch         10/10               │
│ duration      4.2s                │
└───────────────────────────────────┘
```

**Implementation:**
```js
function extractMetrics(logLines = []) {
  const metrics = new Map();
  const pattern = /([a-zA-Z_][a-zA-Z0-9_\s]*?)[=:]\s*([\d.]+[%sms]*)/g;
  for (const line of logLines.slice(-30)) { // last 30 lines
    let m;
    while ((m = pattern.exec(line)) !== null) {
      const key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
      if (key.length < 20) metrics.set(key, m[2]);
    }
  }
  return [...metrics.entries()].slice(0, 6);
}
```

Show only if ≥ 2 metrics found. Pull log lines from `runReport?.events`.

---

## Priority 7 — Research Session Timeline (Future / Nice-to-have)

A chronological log of the research session that auto-populates:

```
Feb 25 ────────────────────────────────────
10:32  📄 Read: "A Pre-training Framework..."
10:45  💡 Idea: "Apply attention pooling"
11:00  ⚡ Implement: "Add attention pooling to model.py"
11:08  ✓ SUCCEEDED · loss=0.023 · 3 files changed
11:10  🔬 Experiment: "Ablation: LR sweep"
11:45  ✓ SUCCEEDED · best_lr=0.001
```

This is a read-only audit trail derived from:
- `runs` (agent + bash runs with timestamps)
- `ideas` (created at timestamp)
- KB paper reads (file open events)

Stored in `docs/session-{date}.md` by the system automatically.

This gives researchers a legible narrative of what they did in a session — useful for writing up results.

---

## Implementation priority order

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 1 | Quick Bash runner | Medium | Very High — eliminates the biggest friction point |
| 2 | Live log tail while RUNNING | Small | High — removes the "is it working?" anxiety |
| 3a | Result snippet in run row | Small | High — results scannable without clicking |
| 3b | Re-run button on run row | Small | High — closes the iterate loop |
| 4 | Post-run next-step suggestions | Medium | High — guidance for researchers |
| 5 | Idea → Implement button | Tiny | Medium — removes copy-paste friction |
| 6 | Key metrics extraction | Small | Medium — makes numbers instantly visible |
| 7 | Session timeline | Large | Medium — nice research narrative, not urgent |

---

## Files to change

### Frontend
- `frontend/src/components/VibeResearcherPanel.jsx`
  - Add state: `quickBashCmd`, `quickBashRunning`, `quickBashLog`, `quickBashRunId`, `liveLogs`, `liveLogTimerRef`, `launcherRef`
  - Add handlers: `handleQuickBash()`, live log polling effect
  - Add UI: Quick Bash panel, live log in Outputs card, run row snippet + re-run button, idea → implement button, metrics panel
- `frontend/src/index.css`
  - `.vibe-quick-bash`, `.vibe-live-log`, `.vibe-live-indicator`, `.vibe-run-snippet`, `.vibe-run-rerun-btn`, `.vibe-metrics-table`, `.vibe-todo-implement-btn`

### Backend
- `backend/src/routes/researchops.js` or `backend/src/services/researchops/runner.js`
  - In run completion handler: extract last stdout line → store as `resultSnippet` in run metadata
  - This is a small patch to `store.updateRunStatus` call in `runner.js`

### No backend changes needed for:
- Live log tail (polls existing `/runs/{id}/report` endpoint)
- Quick Bash (uses existing experiment run path with `schemaVersion: '1.0'`)
- Metrics extraction (pure frontend parsing of existing log events)
- Next step suggestions (parses existing `runReport.summary`)
- Idea → Implement button (uses existing launcher state)
