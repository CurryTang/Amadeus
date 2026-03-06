# SSH Transport Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace duplicated SSH execution and SCP logic with one shared transport layer used across backend modules.

**Architecture:** Introduce `backend/src/services/ssh-transport.service.js` as the single low-level SSH/SCP implementation. Keep compatibility exports in `ssh-auth.service.js` during migration, then switch duplicated callers to the shared transport without changing their external behavior.

**Tech Stack:** Node.js, `child_process.spawn`, existing backend test runner (`node --test`)

---

### Task 1: Add failing transport tests

**Files:**
- Create: `backend/src/services/__tests__/ssh-transport.service.test.js`
- Reference: `backend/src/services/__tests__/ssh-auth.service.test.js`

**Step 1: Write the failing test**

Cover:

- key precedence prefers `ssh_key_path`
- `ProxyJump` is used when target and jump host share the configured key
- `exec(...)` shell-wraps SSH invocation consistently
- `script(...)` passes stdin and script args
- `copyTo(...)` / `copyFrom(...)` build SCP args consistently

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/__tests__/ssh-transport.service.test.js`

**Step 3: Write minimal implementation**

Create the transport service with only the exports needed by the tests.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/__tests__/ssh-transport.service.test.js`

### Task 2: Migrate auth service to compatibility wrapper

**Files:**
- Modify: `backend/src/services/ssh-auth.service.js`
- Test: `backend/src/services/__tests__/ssh-auth.service.test.js`

**Step 1: Write or update failing test**

Ensure the old public API still works through the new implementation.

**Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/__tests__/ssh-auth.service.test.js`

**Step 3: Write minimal implementation**

Re-export transport helpers from `ssh-auth.service.js`.

**Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/__tests__/ssh-auth.service.test.js`

### Task 3: Migrate duplicated SSH callers

**Files:**
- Modify: `backend/src/routes/ssh-servers.js`
- Modify: `backend/src/routes/researchops/projects.js`
- Modify: `backend/src/routes/documents.js`
- Modify: `backend/src/services/researchops/modules/bash-run.module.js`
- Modify: `backend/src/services/researchops/modules/agent-run.module.js`
- Modify: any remaining direct SSH helper call sites discovered by `rg`

**Step 1: Write failing caller tests where coverage is missing**

Prefer narrow tests proving the caller uses the shared transport behavior rather than re-testing transport internals.

**Step 2: Run tests to verify they fail**

Run the minimal affected test files.

**Step 3: Write minimal implementation**

Remove duplicate SSH exec/script logic and import the shared transport helpers.

**Step 4: Run tests to verify they pass**

Run affected tests plus transport/auth tests.

### Task 4: Verify load and behavior

**Files:**
- Reference only

**Step 1: Run route/module load checks**

Run:

- `node -e "require('./backend/src/routes/researchops')"`
- `node -e "require('./backend/src/routes/ssh-servers')"`

**Step 2: Run targeted tests**

Run:

- `node --test backend/src/services/__tests__/ssh-transport.service.test.js`
- `node --test backend/src/services/__tests__/ssh-auth.service.test.js`
- `node --test backend/src/routes/researchops/__tests__/projects.jumpstart.test.js`

**Step 3: Optional live smoke**

Run one real `exec(...)` or `script(...)` call against the `chatdse` config shape to verify the shared layer still works with ProxyJump.
