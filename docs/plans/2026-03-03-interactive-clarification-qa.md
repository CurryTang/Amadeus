# Interactive Clarification Q&A Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a superpowers-style LLM-driven clarification Q&A phase to (1) todo→node conversion and (2) node execution, with a per-run skip toggle.

**Architecture:** Shared `ClarificationChat` React component for Q&A UI. Two new backend endpoints drive the conversation — both return `{ question, options?, done }`. LLM decides what to ask (one question at a time) and when to stop. Node kind (experiment vs implementation) shapes the run-clarify prompt. Accumulated messages pass into the existing generation/run endpoints as enriched context.

**Tech Stack:** React, Express.js, llmService.generateWithFallback, existing plan/node infrastructure

---

### Task 1: Backend — POST /from-todo/clarify

**File:** `backend/src/routes/researchops/projects.js`

Add immediately after the `from-todo` route (~line 6036):

```js
router.post('/projects/:projectId/tree/nodes/from-todo/clarify', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const todo = req.body?.todo;
    if (!todo?.title) return res.status(400).json({ error: 'todo.title is required' });

    const todoTitle = String(todo.title || '').trim();
    const todoHypothesis = String(todo.hypothesis || todo.description || '').trim();
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const systemContext = `You are a research planning assistant preparing to convert a TODO into an executable research tree node.

Your job: ask ONE short, targeted clarifying question to gather context that will make the generated node more accurate and useful.

Focus on the most important unknown. Good questions cover:
- Whether this references a specific paper or knowledge-base asset (and which one)
- Which codebase files or modules are relevant
- Whether this is an implementation task (coding a design) or an experiment (running/evaluating)
- Dataset or model assumptions for experiment tasks
- Design doc, architecture, or API assumptions for implementation tasks
- Execution environment specifics (GPU, cluster, local)

Ask ONE question at a time. Prefer offering 2–4 concrete multiple-choice options when possible.

When you have enough context to generate a precise node (typically after 2–3 questions), respond with ONLY:
{"done": true}

Otherwise respond with ONLY valid JSON (no markdown fences):
{"question": "...", "options": ["option A", "option B"]}
or if open-ended:
{"question": "...", "options": []}`;

    let prompt;
    if (messages.length === 0) {
      prompt = `TODO to convert:\nTitle: ${todoTitle}${todoHypothesis ? `\nHypothesis: ${todoHypothesis}` : ''}\n\nAsk your first clarifying question.`;
    } else {
      const history = messages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content || '').slice(0, 600)}`)
        .join('\n\n');
      prompt = `TODO:\nTitle: ${todoTitle}${todoHypothesis ? `\nHypothesis: ${todoHypothesis}` : ''}\n\nConversation so far:\n${history}\n\nAsk the next clarifying question, or respond {"done":true} if you have enough context.`;
    }

    const result = await llmService.generateWithFallback(systemContext, prompt);
    const rawText = String(result?.text || '').trim();

    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch (_) {}
    if (!parsed) {
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenceMatch) try { parsed = JSON.parse(fenceMatch[1].trim()); } catch (_) {}
    }
    if (!parsed) {
      const objMatch = rawText.match(/\{[\s\S]*\}/);
      if (objMatch) try { parsed = JSON.parse(objMatch[0]); } catch (_) {}
    }

    if (!parsed) return res.status(422).json({ error: 'Failed to parse clarification response', raw: rawText.slice(0, 300) });

    return res.json({
      done: parsed.done === true,
      question: parsed.done ? null : String(parsed.question || ''),
      options: Array.isArray(parsed.options) ? parsed.options.map(String) : [],
    });
  } catch (error) {
    console.error('[from-todo/clarify] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});
```

### Task 2: Backend — POST /:nodeId/run-clarify

**File:** `backend/src/routes/researchops/projects.js`

Add immediately before the `run-step` route (~line 5613):

```js
router.post('/projects/:projectId/tree/nodes/:nodeId/run-clarify', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const nodeId = String(req.params.nodeId || '').trim();
    if (!projectId || !nodeId) return res.status(400).json({ error: 'projectId and nodeId are required' });

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const { plan } = await resolveProjectAndTree(req, projectId);
    const node = (Array.isArray(plan?.nodes) ? plan.nodes : []).find(
      (n) => String(n?.id || '').trim() === nodeId,
    );
    if (!node) return res.status(404).json({ error: `Node not found: ${nodeId}` });

    const kind = String(node.kind || 'experiment');
    const isImplementation = kind === 'patch' || kind === 'setup' ||
      (kind === 'experiment' && (node.commands || []).some((c) => {
        const cmd = String(c?.cmd || c?.run || '').toLowerCase();
        return cmd.includes('implement') || cmd.includes('write') || cmd.includes('create') || cmd.includes('edit');
      }));

    const kindGuidance = isImplementation
      ? `This is an IMPLEMENTATION node. Focus questions on:
- Which design document or spec should be followed?
- Which existing code files or modules should be modified?
- What APIs, interfaces, or data structures must be respected?
- Are there style/architecture conventions to follow?`
      : kind === 'analysis'
      ? `This is an ANALYSIS node. Focus questions on:
- Which artifacts or result files should be analyzed?
- What metrics or comparisons are expected?
- What format should the output report take?`
      : kind === 'knowledge'
      ? `This is a KNOWLEDGE node. Focus questions on:
- Which specific papers or KB assets are referenced?
- What scope of literature should be covered?
- Are there known gaps to address?`
      : `This is an EXPERIMENT node. Focus questions on:
- What dataset, checkpoint, or baseline should be used?
- What hyperparameters or configurations are expected?
- What compute environment (GPU type, cluster, local) is available?
- Are there known failure modes to watch for?`;

    const commandSummary = (node.commands || [])
      .slice(0, 5)
      .map((c, i) => `  ${i + 1}. ${String(c?.cmd || c?.run || c || '')}`)
      .join('\n');

    const systemContext = `You are a research execution assistant preparing to run a tree node step.

Node: "${node.title}" (kind: ${kind})
Commands to be executed:
${commandSummary || '  (none listed)'}
Assumptions: ${(node.assumption || []).join('; ') || '(none)'}

${kindGuidance}

Ask ONE short clarifying question at a time. Offer 2–4 concrete options when possible.
When you have enough context (typically 2–3 questions), respond with ONLY: {"done": true}
Otherwise respond with ONLY valid JSON: {"question": "...", "options": ["A", "B"]}`;

    let prompt;
    if (messages.length === 0) {
      prompt = `Ask your first clarifying question before executing this node.`;
    } else {
      const history = messages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content || '').slice(0, 600)}`)
        .join('\n\n');
      prompt = `Conversation so far:\n${history}\n\nAsk the next question or respond {"done":true}.`;
    }

    const result = await llmService.generateWithFallback(systemContext, prompt);
    const rawText = String(result?.text || '').trim();

    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch (_) {}
    if (!parsed) {
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenceMatch) try { parsed = JSON.parse(fenceMatch[1].trim()); } catch (_) {}
    }
    if (!parsed) {
      const objMatch = rawText.match(/\{[\s\S]*\}/);
      if (objMatch) try { parsed = JSON.parse(objMatch[0]); } catch (_) {}
    }

    if (!parsed) return res.status(422).json({ error: 'Failed to parse clarification response', raw: rawText.slice(0, 300) });

    return res.json({
      done: parsed.done === true,
      question: parsed.done ? null : String(parsed.question || ''),
      options: Array.isArray(parsed.options) ? parsed.options.map(String) : [],
    });
  } catch (error) {
    console.error('[run-clarify] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});
```

### Task 3: Frontend — ClarificationChat component

**File:** `frontend/src/components/vibe/ClarificationChat.jsx`

```jsx
import { useState, useRef, useEffect } from 'react';

export default function ClarificationChat({
  messages,          // [{ role: 'assistant'|'user', content: string }]
  currentQuestion,   // string | null
  options,           // string[]
  done,              // boolean
  busy,              // boolean
  skipped,           // boolean
  onSend,            // (text: string) => void
  onSkip,            // () => void
  onUnskip,          // () => void
  onProceed,         // () => void  — called when done && user clicks proceed
  proceedLabel,      // string, e.g. "Generate Node" or "Run Step"
}) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentQuestion]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    onSend(text);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  if (skipped) {
    return (
      <div className="clarif-skipped">
        <span>Q&A skipped</span>
        <button className="clarif-unskip" onClick={onUnskip}>Enable Q&A</button>
      </div>
    );
  }

  return (
    <div className="clarif-chat">
      <div className="clarif-header">
        <span className="clarif-title">Context Q&A</span>
        <button className="clarif-skip-btn" onClick={onSkip} title="Skip clarification questions">
          Skip Q&A
        </button>
      </div>

      <div className="clarif-messages">
        {messages.map((m, i) => (
          <div key={i} className={`clarif-bubble clarif-bubble--${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="clarif-bubble clarif-bubble--assistant clarif-thinking">…</div>}
        {!busy && currentQuestion && (
          <div className="clarif-bubble clarif-bubble--assistant">{currentQuestion}</div>
        )}
        {!busy && done && (
          <div className="clarif-bubble clarif-bubble--assistant clarif-done">
            ✓ Got enough context. Ready to proceed.
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!done && options && options.length > 0 && !busy && (
        <div className="clarif-options">
          {options.map((opt, i) => (
            <button key={i} className="clarif-option-btn" onClick={() => { setInput(''); onSend(opt); }}>
              {opt}
            </button>
          ))}
        </div>
      )}

      {!done && (
        <div className="clarif-input-row">
          <textarea
            className="clarif-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type your answer…"
            rows={2}
            disabled={busy}
          />
          <button className="clarif-send-btn" onClick={handleSend} disabled={!input.trim() || busy}>
            Send
          </button>
        </div>
      )}

      {done && (
        <button className="clarif-proceed-btn" onClick={onProceed}>
          {proceedLabel || 'Proceed'}
        </button>
      )}
    </div>
  );
}
```

Add CSS to `frontend/src/index.css`:
```css
/* ---- ClarificationChat ---- */
.clarif-chat { display: flex; flex-direction: column; gap: 10px; }
.clarif-header { display: flex; justify-content: space-between; align-items: center; }
.clarif-title { font-size: 0.82rem; font-weight: 600; color: #1e3a4c; }
.clarif-skip-btn { background: none; border: none; font-size: 0.78rem; color: #94a3b8; cursor: pointer; text-decoration: underline; }
.clarif-skip-btn:hover { color: #64748b; }
.clarif-skipped { display: flex; align-items: center; gap: 10px; font-size: 0.82rem; color: #94a3b8; }
.clarif-unskip { background: none; border: none; font-size: 0.78rem; color: #155eef; cursor: pointer; text-decoration: underline; }
.clarif-messages { display: flex; flex-direction: column; gap: 7px; max-height: 240px; overflow-y: auto; padding: 4px 2px; }
.clarif-bubble { padding: 8px 11px; border-radius: 12px; font-size: 0.83rem; line-height: 1.45; max-width: 92%; }
.clarif-bubble--assistant { background: #f0f6ff; color: #1e3a4c; align-self: flex-start; }
.clarif-bubble--user { background: #155eef; color: #fff; align-self: flex-end; }
.clarif-thinking { opacity: 0.5; font-style: italic; }
.clarif-done { background: #f0fdf4; color: #065f46; }
.clarif-options { display: flex; flex-wrap: wrap; gap: 6px; }
.clarif-option-btn { padding: 5px 12px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 16px; font-size: 0.8rem; color: #334155; cursor: pointer; }
.clarif-option-btn:hover { border-color: #155eef; color: #155eef; background: #eff6ff; }
.clarif-input-row { display: flex; gap: 8px; align-items: flex-end; }
.clarif-input { flex: 1; padding: 8px 10px; border: 1px solid #d4deef; border-radius: 8px; font-size: 0.83rem; font-family: inherit; resize: none; }
.clarif-input:focus { outline: none; border-color: #155eef; }
.clarif-send-btn { padding: 8px 14px; background: #155eef; color: #fff; border: none; border-radius: 8px; font-size: 0.82rem; cursor: pointer; white-space: nowrap; }
.clarif-send-btn:disabled { opacity: 0.45; cursor: default; }
.clarif-proceed-btn { width: 100%; padding: 9px; background: #0f9d66; color: #fff; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
.clarif-proceed-btn:hover { background: #0a7a4f; }
```

### Task 4: Update TodoNodeModal with clarification phase

**File:** `frontend/src/components/vibe/TodoNodeModal.jsx`

Phase state machine: `'clarifying' | 'generating' | 'done' | 'error'`

Key changes:
1. Initial status = `'clarifying'` (not auto-generate)
2. On mount: call `/from-todo/clarify` with empty messages
3. Skip toggle: if skipped, set status = `'generating'` and auto-generate immediately
4. When `done: true` from clarify: show "Generate Node" proceed button
5. Pass accumulated clarification messages into the existing `generate(messages)` call

Add state:
```js
const [clarifyMessages, setClarifyMessages] = useState([]);
const [clarifyQuestion, setClarifyQuestion] = useState(null);
const [clarifyOptions, setClarifyOptions] = useState([]);
const [clarifyDone, setClarifyDone] = useState(false);
const [clarifyBusy, setClarifyBusy] = useState(false);
const [clarifySkipped, setClarifySkipped] = useState(false);
```

Add `fetchNextQuestion`:
```js
const fetchNextQuestion = useCallback(async (msgs) => {
  setClarifyBusy(true);
  try {
    const res = await axios.post(
      `${apiUrl}/researchops/projects/${projectId}/tree/nodes/from-todo/clarify`,
      { todo, messages: msgs },
      { headers },
    );
    if (res.data.done) {
      setClarifyDone(true);
      setClarifyQuestion(null);
    } else {
      setClarifyQuestion(res.data.question);
      setClarifyOptions(res.data.options || []);
    }
  } catch (e) {
    setClarifyQuestion('Could not load question — type your context or skip Q&A.');
    setClarifyOptions([]);
  } finally {
    setClarifyBusy(false);
  }
}, [apiUrl, headers, projectId, todo]);
```

Change auto-generate `useEffect` to instead call `fetchNextQuestion([])`.

Change `hasAutoGenerated` ref behavior: only auto-generate if `clarifySkipped`.

Render `ClarificationChat` when `status === 'idle'` or `status === 'clarifying'`, then transition to normal node-display UI after proceed.

### Task 5: Update VibeNodeWorkbench with Run Context Q&A

**File:** `frontend/src/components/vibe/VibeNodeWorkbench.jsx`

Add a new collapsible "Run Context" section at the top — above the existing tabs.

State:
```js
const [clarifyMessages, setClarifyMessages] = useState([]);
const [clarifyQuestion, setClarifyQuestion] = useState(null);
const [clarifyOptions, setClarifyOptions] = useState([]);
const [clarifyDone, setClarifyDone] = useState(false);
const [clarifyBusy, setClarifyBusy] = useState(false);
const [clarifySkipped, setClarifySkipped] = useState(false);
const [clarifyStarted, setClarifyStarted] = useState(false);
```

Add "Start Q&A / Run Step" button that:
- If `clarifySkipped` → calls `onRunStep()` directly
- If not started → starts Q&A (calls `/run-clarify` with empty messages), sets `clarifyStarted = true`
- If started and done → shows ClarificationChat in done state + "Run Step" button

Pass `onRunStep` as a new prop from VibeResearcherPanel (wraps `handleTreeNodeAction('run_step', node)`).

Reset clarify state when `node.id` changes.

### Task 6: Update skill files

**File:** `skills/todo-to-node/SKILL.md` — add Clarification Phase section.

**File:** `skills/node-run-clarify/SKILL.md` — new skill file describing the run-context Q&A.
