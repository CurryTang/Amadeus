---
name: auto-review-loop
description: "Autonomous multi-round research review loop. Uses an external LLM reviewer (via review-adapter.py) to score work, then implements fixes and re-reviews until positive assessment or max rounds. Use when user says 'auto review loop', 'review until it passes', or wants iterative improvement with external review."
argument-hint: "[topic-or-scope] [--max-rounds N] [--reviewer-model MODEL]"
allowed-tools: Bash(*), Read, Grep, Glob, Write, Edit, Agent
---

# Auto Review Loop: Autonomous Research Improvement

Autonomously iterate: external review -> implement fixes -> re-review, until the external reviewer gives a positive assessment or MAX_ROUNDS is reached.

## Context: $ARGUMENTS

## Constants

- MAX_ROUNDS = `${ARIS_MAX_ROUNDS:-4}` (override via environment variable or CLI arg `--max-rounds N`)
- POSITIVE_THRESHOLD: score >= 6/10, or verdict contains "accept", "sufficient", "ready for submission"
- REVIEW_DOC: `AUTO_REVIEW.md` in project root (cumulative log)
- REVIEWER_MODEL = `${REVIEW_MODEL:-gpt-4o}` (override via env var or `--reviewer-model MODEL`)
- REVIEW_ADAPTER: `$HOME/.cache/auto-researcher/aris-skills/review-adapter.py` or `review-adapter.py` in project `.claude/` dir
- THREAD_FILE: `.aris-review-thread.json` in the run directory (for multi-round conversation continuity)

## State Persistence (Compact Recovery)

Long-running loops may hit the context window limit. Persist state to `REVIEW_STATE.json` after each round:

```json
{
  "round": 2,
  "status": "in_progress",
  "last_score": 5.0,
  "last_verdict": "not ready",
  "pending_experiments": [],
  "scores": [4.5, 5.0],
  "timestamp": "2026-03-15T10:00:00"
}
```

Write this file at the end of every Phase E. On completion, set `"status": "completed"`.

## Workflow

### Initialization

1. **Parse arguments**: Extract `--max-rounds N` and `--reviewer-model MODEL` from $ARGUMENTS if present. Remaining text is the research topic/scope.
2. **Check for `REVIEW_STATE.json`** in project root:
   - Does not exist: **fresh start**
   - Exists with `"status": "completed"`: **fresh start** (delete old state)
   - Exists with `"in_progress"` AND `timestamp` older than 24h: **fresh start**
   - Exists with `"in_progress"` AND within 24h: **resume** from `round + 1`
3. **Locate the review adapter**:
   ```bash
   ADAPTER=""
   for candidate in \
     ".claude/review-adapter.py" \
     "$HOME/.cache/auto-researcher/aris-skills/review-adapter.py" \
     "$(dirname "$(which claude 2>/dev/null)")/../share/aris/review-adapter.py"; do
     [ -f "$candidate" ] && ADAPTER="$candidate" && break
   done
   if [ -z "$ADAPTER" ]; then
     echo "ERROR: review-adapter.py not found. Cannot run external review loop."
     exit 1
   fi
   ```
4. **Verify Python and openai package**:
   ```bash
   python3 -c "import openai" 2>/dev/null || pip3 install --user openai
   ```
5. Read project narrative docs, memory files, prior review docs
6. Read recent experiment results (output dirs, logs)
7. Identify current weaknesses and open TODOs from prior reviews
8. Initialize round counter = 1 (unless resumed)
9. Create/update `AUTO_REVIEW.md` with header and timestamp

### Loop (repeat up to MAX_ROUNDS)

#### Phase A: External Review

Build the review context and call the adapter:

```bash
# Write review prompt to temp file
cat > /tmp/aris_review_prompt.txt << 'REVIEW_EOF'
[Round N/MAX_ROUNDS of autonomous review loop]

PROJECT CONTEXT:
[Summarize: claims, methods, current results, known weaknesses]

CHANGES SINCE LAST ROUND:
[List what was implemented/fixed since previous review, or "Initial submission" for round 1]

CURRENT RESULTS:
[Paste key metrics, tables, or findings]

Please act as a senior ML reviewer (NeurIPS/ICML level).
1. Score this work 1-10 for a top venue
2. List remaining critical weaknesses (ranked by severity)
3. For each weakness, specify the MINIMUM fix (experiment, analysis, or reframing)
4. State clearly: is this READY for submission? Yes/No/Almost

Be brutally honest. If the work is ready, say so clearly.
REVIEW_EOF

# Call the review adapter
python3 "$ADAPTER" \
  --prompt-file /tmp/aris_review_prompt.txt \
  --model "${REVIEW_MODEL:-gpt-4o}" \
  --thread-file ".aris-review-thread.json" \
  --round N \
  --max-rounds MAX_ROUNDS \
  > /tmp/aris_review_result.json 2>&1
```

#### Phase B: Parse Assessment

Read `/tmp/aris_review_result.json` and extract:
- **score** (numeric 1-10)
- **verdict** ("ready" / "almost" / "not ready")
- **action_items** (ranked list of fixes)
- **raw_response** (full reviewer text — **save verbatim**)

**STOP CONDITION**: If score >= 6 AND verdict is "ready" or "almost" -> stop loop, document final state.

If `"error"` field is present in the JSON, log the error and either retry once or proceed with self-review as fallback.

#### Phase C: Implement Fixes (if not stopping)

For each action item (highest priority first):

1. **Code changes**: Write/modify experiment scripts, model code, analysis
2. **Run experiments**: Launch via SSH + screen/tmux if on remote server
3. **Analysis**: Run evaluation, collect results, update figures/tables
4. **Documentation**: Update project notes and review document

Prioritization rules:
- Skip fixes requiring excessive compute (> 4 GPU hours) — flag for manual follow-up
- Prefer analysis/reframing over new experiments when both address the concern
- Always implement metric additions (cheap, high impact)
- Implement fixes BEFORE re-reviewing (don't just promise to fix)

#### Phase D: Wait for Results

If experiments were launched:
- Monitor remote sessions for completion
- Collect results from output files and logs
- If an experiment takes > 30 minutes, continue with other fixes while waiting

#### Phase E: Document Round

Append to `AUTO_REVIEW.md`:

```markdown
## Round N (timestamp)

### Assessment Summary
- Score: X/10
- Verdict: [ready/almost/not ready]
- Key criticisms: [bullet list]

### Reviewer Raw Response

<details>
<summary>Click to expand full reviewer response (Round N)</summary>

[Paste COMPLETE raw response verbatim — this is the authoritative record]

</details>

### Actions Taken
- [what was implemented/changed]

### Results
- [experiment outcomes, if any]

### Status
- [continuing to round N+1 / stopping — score threshold met / stopping — max rounds]
```

**Write `REVIEW_STATE.json`** with current state (round, score, verdict, pending experiments, cumulative scores array).

Increment round counter -> back to Phase A.

### Termination

When loop ends (positive assessment or max rounds):

1. Set `REVIEW_STATE.json` -> `"status": "completed"`
2. Write final summary to `AUTO_REVIEW.md` including score progression table:
   ```
   | Round | Score | Verdict    |
   |-------|-------|------------|
   | 1     | 4.5   | not ready  |
   | 2     | 5.5   | not ready  |
   | 3     | 6.5   | almost     |
   | 4     | 7.5   | ready      |
   ```
3. If stopped at max rounds without positive assessment:
   - List remaining blockers
   - Estimate effort needed for each
   - Suggest whether to continue manually or pivot

## Key Rules

- Use the review adapter for ALL external reviews (never self-review as primary — that defeats the purpose)
- If the adapter fails (API error), fall back to self-review but LOG that it was a fallback
- Be honest — include negative results and failed experiments
- Do NOT hide weaknesses to inflate scores
- Implement fixes BEFORE re-reviewing
- Document EVERYTHING — the review log should be self-contained
- The raw reviewer response is the primary record — always save it verbatim
