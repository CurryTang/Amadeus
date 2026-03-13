# Remote KBCTL Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a real remote `kbctl` retrieval stack that indexes the SSH-hosted `resource/` corpus, exposes the broader CLI surface (`search-docs`, `search-sections`, `read-node`, `search-symbols`, `read-symbol`, `map-paper-code`, `build-pack`), and replaces the current metadata substring fallback in ResearchOps.

**Architecture:** Package a Python `kb/` module in this repo, deploy it to the SSH host on demand, build a persistent SQLite FTS5 index beside the remote corpus, and wrap that CLI from Node services/routes in `backend/src/services/researchops/`. Keep V1 lexical/structural only: corpus metadata, chunked paper text, code files, extracted symbols, relation edges, and evidence-pack assembly.

**Tech Stack:** Node.js backend (`node:test`), Python 3 stdlib (`sqlite3`, `ast`, `argparse`, `json`, `pathlib`), existing SSH transport service, `pdf-parse` only for local backend code if needed but prefer remote Python-side simple extraction strategy.

---

### Task 1: Add the Remote KB Package Skeleton and Corpus Fixture

**Files:**
- Create: `kb/__init__.py`
- Create: `kb/kbctl.py`
- Create: `kb/corpus.py`
- Create: `kb/index_builder.py`
- Create: `kb/code_symbols.py`
- Create: `kb/pack_builder.py`
- Create: `kb/tests/__init__.py`
- Create: `kb/tests/fixtures/resource/paper_assets_index.json`
- Create: `kb/tests/fixtures/resource/notes.md`
- Create: `kb/tests/fixtures/resource/research_questions.md`
- Create: `kb/tests/fixtures/resource/PluRel/README.md`
- Create: `kb/tests/fixtures/resource/PluRel/paper.txt`
- Create: `kb/tests/fixtures/resource/PluRel/code/snap-stanford__plurel/train.py`
- Create: `kb/tests/test_index_builder.py`

**Step 1: Write the failing Python test for corpus discovery and index build**

```python
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from kb.index_builder import build_index


class IndexBuilderTest(unittest.TestCase):
    def test_build_index_creates_documents_nodes_edges_and_fts_rows(self):
        fixture_root = Path(__file__).parent / "fixtures" / "resource"
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "kb.sqlite3"

            summary = build_index(resource_root=fixture_root, db_path=db_path, project_id="proj_demo")

            self.assertEqual(summary["documents"] > 0, True)
            self.assertEqual(summary["nodes"] > 0, True)

            conn = sqlite3.connect(db_path)
            try:
                doc_count = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
                node_count = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
                fts_count = conn.execute("SELECT COUNT(*) FROM node_text_fts").fetchone()[0]
            finally:
                conn.close()

            self.assertGreaterEqual(doc_count, 3)
            self.assertGreaterEqual(node_count, 4)
            self.assertGreaterEqual(fts_count, 4)
```

**Step 2: Run test to verify it fails**

Run:
```bash
python3 -m unittest kb.tests.test_index_builder -v
```

Expected: `FAIL` or `ERROR` because `kb.index_builder.build_index` does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- corpus discovery in `kb/corpus.py`
- schema creation in `kb/index_builder.py`
- fixture-aware text ingestion using:
  - top-level corpus helper docs
  - paper folder `README.md`
  - fallback plain-text paper fixture (`paper.txt`) for the test corpus
  - code file ingestion
- deterministic document/node IDs
- FTS5 row insertion

Minimal function shape:

```python
def build_index(resource_root, db_path, project_id):
    # create tables
    # scan resource root
    # write documents/nodes/edges/fts rows
    return {"documents": doc_count, "nodes": node_count, "edges": edge_count}
```

**Step 4: Run test to verify it passes**

Run:
```bash
python3 -m unittest kb.tests.test_index_builder -v
```

Expected: `OK`

**Step 5: Commit**

```bash
git add kb/__init__.py kb/kbctl.py kb/corpus.py kb/index_builder.py kb/code_symbols.py kb/pack_builder.py kb/tests/__init__.py kb/tests/fixtures/resource/paper_assets_index.json kb/tests/fixtures/resource/notes.md kb/tests/fixtures/resource/research_questions.md kb/tests/fixtures/resource/PluRel/README.md kb/tests/fixtures/resource/PluRel/paper.txt kb/tests/fixtures/resource/PluRel/code/snap-stanford__plurel/train.py kb/tests/test_index_builder.py
git commit -m "feat: add remote kb index skeleton"
```

### Task 2: Implement `kbctl index build/status/search-docs`

**Files:**
- Modify: `kb/kbctl.py`
- Modify: `kb/corpus.py`
- Modify: `kb/index_builder.py`
- Create: `kb/tests/test_kbctl_search_docs.py`

**Step 1: Write the failing CLI test for `index build`, `index status`, and `search-docs`**

```python
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


class KbctlSearchDocsTest(unittest.TestCase):
    def test_cli_builds_index_and_returns_ranked_documents(self):
        fixture_root = Path(__file__).parent / "fixtures" / "resource"
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "kb.sqlite3"

            build_proc = subprocess.run(
                [
                    "python3", "-m", "kb.kbctl",
                    "index", "build",
                    "--project", "proj_demo",
                    "--resource-root", str(fixture_root),
                    "--db", str(db_path),
                    "--json",
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            build_payload = json.loads(build_proc.stdout)
            self.assertEqual(build_payload["ok"], True)

            search_proc = subprocess.run(
                [
                    "python3", "-m", "kb.kbctl",
                    "search-docs",
                    "--project", "proj_demo",
                    "--resource-root", str(fixture_root),
                    "--db", str(db_path),
                    "--query", "training setup",
                    "--json",
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            payload = json.loads(search_proc.stdout)
            self.assertEqual(payload["items"][0]["doc_id"], "paper:PluRel")
```

**Step 2: Run test to verify it fails**

Run:
```bash
python3 -m unittest kb.tests.test_kbctl_search_docs -v
```

Expected: `FAIL` because the CLI subcommands and ranking output do not exist yet.

**Step 3: Write minimal implementation**

Add to `kb/kbctl.py`:
- `index build`
- `index status`
- `search-docs`

Implementation requirements:
- parse arguments with `argparse`
- emit JSON only when `--json` is present
- use `sqlite3` + FTS query for ranked retrieval
- return top items with:
  - `doc_id`
  - `kind`
  - `title`
  - `path`
  - `score`
  - `source`

**Step 4: Run test to verify it passes**

Run:
```bash
python3 -m unittest kb.tests.test_kbctl_search_docs -v
```

Expected: `OK`

**Step 5: Commit**

```bash
git add kb/kbctl.py kb/corpus.py kb/index_builder.py kb/tests/test_kbctl_search_docs.py
git commit -m "feat: add kbctl index and doc search commands"
```

### Task 3: Implement Section, Node, Symbol, Mapping, and Pack Retrieval

**Files:**
- Modify: `kb/kbctl.py`
- Modify: `kb/index_builder.py`
- Modify: `kb/code_symbols.py`
- Modify: `kb/pack_builder.py`
- Create: `kb/tests/test_kbctl_detail_commands.py`

**Step 1: Write the failing test for detailed retrieval commands**

```python
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


class KbctlDetailCommandsTest(unittest.TestCase):
    def test_detail_commands_return_sections_symbols_and_pack(self):
        fixture_root = Path(__file__).parent / "fixtures" / "resource"
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "kb.sqlite3"

            subprocess.run(
                [
                    "python3", "-m", "kb.kbctl",
                    "index", "build",
                    "--project", "proj_demo",
                    "--resource-root", str(fixture_root),
                    "--db", str(db_path),
                    "--json",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

            sections = json.loads(subprocess.run(
                [
                    "python3", "-m", "kb.kbctl",
                    "search-sections",
                    "--doc", "paper:PluRel",
                    "--db", str(db_path),
                    "--query", "training setup",
                    "--json",
                ],
                capture_output=True, text=True, check=True
            ).stdout)
            self.assertGreaterEqual(len(sections["items"]), 1)

            symbols = json.loads(subprocess.run(
                [
                    "python3", "-m", "kb.kbctl",
                    "search-symbols",
                    "--repo", "repo:PluRel:snap-stanford__plurel",
                    "--db", str(db_path),
                    "--query", "Trainer",
                    "--json",
                ],
                capture_output=True, text=True, check=True
            ).stdout)
            self.assertGreaterEqual(len(symbols["items"]), 1)

            pack = json.loads(subprocess.run(
                [
                    "python3", "-m", "kb.kbctl",
                    "build-pack",
                    "--project", "proj_demo",
                    "--db", str(db_path),
                    "--query", "PluRel training setup",
                    "--context", "planning",
                    "--json",
                ],
                capture_output=True, text=True, check=True
            ).stdout)
            self.assertEqual(pack["coverage"]["paper"], True)
            self.assertEqual(pack["coverage"]["code"], True)
```

**Step 2: Run test to verify it fails**

Run:
```bash
python3 -m unittest kb.tests.test_kbctl_detail_commands -v
```

Expected: `FAIL` because the detailed commands are not implemented.

**Step 3: Write minimal implementation**

Implement:
- `search-sections`
- `read-node`
- `search-symbols`
- `read-symbol`
- `map-paper-code`
- `build-pack`

Minimal behavior:
- section search hits `nodes` scoped to a document
- `read-node` returns the node plus neighboring nodes by sort order
- symbol search ranks exact symbol names above file-level hits
- `map-paper-code` uses paper-to-repo edges plus query overlap against symbol/file names
- `build-pack` merges top paper and code evidence into:

```json
{
  "query": "PluRel training setup",
  "context": "planning",
  "resolved_assets": [],
  "evidence": [],
  "coverage": { "paper": true, "code": true, "config": false },
  "gaps": [],
  "next_actions": []
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
python3 -m unittest kb.tests.test_kbctl_detail_commands -v
```

Expected: `OK`

**Step 5: Commit**

```bash
git add kb/kbctl.py kb/index_builder.py kb/code_symbols.py kb/pack_builder.py kb/tests/test_kbctl_detail_commands.py
git commit -m "feat: add kbctl detail retrieval commands"
```

### Task 4: Add Node Services for Remote Deployment and Invocation

**Files:**
- Create: `backend/src/services/researchops/kb-remote.service.js`
- Create: `backend/src/services/researchops/__tests__/kb-remote.service.test.js`
- Modify: `backend/src/services/ssh-transport.service.js`
- Modify: `backend/src/services/__tests__/ssh-transport.service.test.js`
- Modify: `backend/src/services/researchops/kb-search-payload.service.js`
- Create: `backend/src/services/researchops/kb-pack-payload.service.js`
- Create: `backend/src/services/researchops/__tests__/kb-pack-payload.service.test.js`

**Step 1: Write the failing Node tests for remote package deployment and CLI execution**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

const kbRemoteService = require('../kb-remote.service');

test('ensureRemoteKbctl installs bundled kb package and returns remote command metadata', async () => {
  const calls = [];

  const result = await kbRemoteService.ensureRemoteKbctl({
    server: { host: 'compute.example.edu', user: 'testuser', port: 22 },
    projectPath: '/egr/research-dselab/testuser/AutoRDL',
    ssh: {
      script: async (...args) => {
        calls.push(args);
        return { stdout: JSON.stringify({ ok: true, installed: true }) };
      },
    },
  });

  assert.equal(result.remoteRoot.includes('.researchops/kbctl'), true);
  assert.equal(calls.length > 0, true);
});

test('runRemoteKbCommand parses JSON stdout and throws on malformed output', async () => {
  const result = await kbRemoteService.runRemoteKbCommand({
    server: { host: 'compute.example.edu', user: 'testuser', port: 22 },
    projectPath: '/egr/research-dselab/testuser/AutoRDL',
    command: ['search-docs', '--query', 'training setup', '--json'],
    ssh: {
      script: async () => ({ stdout: JSON.stringify({ items: [{ doc_id: 'paper:PluRel' }] }) }),
    },
  });

  assert.equal(result.items[0].doc_id, 'paper:PluRel');
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
node --test backend/src/services/researchops/__tests__/kb-remote.service.test.js backend/src/services/__tests__/ssh-transport.service.test.js backend/src/services/researchops/__tests__/kb-pack-payload.service.test.js
```

Expected: `FAIL` because the service, payload, and any recursive/deploy transport helper do not exist yet.

**Step 3: Write minimal implementation**

Implement in `kb-remote.service.js`:
- project KB root resolution
- remote install root derivation, for example:
  - `<projectPath>/.researchops/kbctl/current`
- package deployment from local repo `kb/` directory to remote host
- `ensureRemoteKbctl`
- `runRemoteKbCommand`
- JSON parse + named error mapping

If `ssh-transport.service.js` cannot support deployment cleanly, add one minimal helper:

```javascript
async function script(server, scriptText, args = [], options = {}) { ... }
```

Reuse the existing script helper if it is sufficient; only add the smallest deployment primitive needed.

Also add `kb-pack-payload.service.js` for normalized `build-pack` responses.

**Step 4: Run tests to verify they pass**

Run:
```bash
node --test backend/src/services/researchops/__tests__/kb-remote.service.test.js backend/src/services/__tests__/ssh-transport.service.test.js backend/src/services/researchops/__tests__/kb-pack-payload.service.test.js
```

Expected: all tests `PASS`

**Step 5: Commit**

```bash
git add backend/src/services/researchops/kb-remote.service.js backend/src/services/researchops/__tests__/kb-remote.service.test.js backend/src/services/ssh-transport.service.js backend/src/services/__tests__/ssh-transport.service.test.js backend/src/services/researchops/kb-search-payload.service.js backend/src/services/researchops/kb-pack-payload.service.js backend/src/services/researchops/__tests__/kb-pack-payload.service.test.js
git commit -m "feat: add remote kbctl deployment and invocation service"
```

### Task 5: Replace the Route Fallback and Add Build-Pack Endpoints

**Files:**
- Modify: `backend/src/routes/researchops/dashboard.js`
- Create: `backend/src/routes/researchops/__tests__/dashboard.kb.route.test.js`
- Modify: `backend/src/services/researchops/project-location.service.js`
- Modify: `backend/src/services/researchops/__tests__/project-location.service.test.js`

**Step 1: Write the failing route-level helper test**

Export minimal helpers from `dashboard.js` so route behavior can be tested without spinning up the whole app.

Test shape:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

const dashboardRouter = require('../dashboard');

test('resolveKbSearchRequest rejects missing query and prefers remote kbctl over metadata fallback', async () => {
  await assert.rejects(
    () => dashboardRouter.resolveKbSearchRequest({
      body: {},
      userId: 'czk',
      kbRemoteService: {},
      store: {},
    }),
    /query is required/i
  );
});

test('resolveKbSearchRequest returns remote kbctl results for ssh projects', async () => {
  const result = await dashboardRouter.resolveKbSearchRequest({
    body: { query: 'PluRel training setup', projectId: 'proj_1', topK: 5 },
    userId: 'czk',
    projectResolver: async () => ({
      project: {
        id: 'proj_1',
        locationType: 'ssh',
        projectPath: '/egr/research-dselab/testuser/AutoRDL',
        serverId: 'srv_remote_1',
      },
      server: { id: 'srv_remote_1', host: 'compute.example.edu', user: 'testuser', port: 22 },
    }),
    kbRemoteService: {
      runRemoteKbCommand: async () => ({ items: [{ doc_id: 'paper:PluRel' }], source: 'remote-kbctl' }),
    },
  });

  assert.equal(result.source, 'remote-kbctl');
});
```

**Step 2: Run tests to verify they fail**

Run:
```bash
node --test backend/src/routes/researchops/__tests__/dashboard.kb.route.test.js backend/src/services/researchops/__tests__/project-location.service.test.js backend/src/services/researchops/__tests__/kb-search-payload.service.test.js
```

Expected: `FAIL` because the extracted helpers and project KB resolution behavior do not exist yet.

**Step 3: Write minimal implementation**

Implement in `dashboard.js`:
- shared project/server resolution for KB commands
- `resolveKbSearchRequest`
- `resolveKbBuildPackRequest`
- route handlers:
  - `POST /kb/search`
  - `POST /kb/build-pack`
- stop using idea/project substring fallback for SSH-backed KB searches

Implement in `project-location.service.js`:
- a helper that derives the default remote KB root:
  - `project.kbFolderPath` when set
  - otherwise `<projectPath>/resource`

Payload updates:
- `kb-search-payload.service.js` should preserve remote source metadata and normalized result items
- new pack payload should expose action metadata for `build-pack`

**Step 4: Run tests to verify they pass**

Run:
```bash
node --test backend/src/routes/researchops/__tests__/dashboard.kb.route.test.js backend/src/services/researchops/__tests__/project-location.service.test.js backend/src/services/researchops/__tests__/kb-search-payload.service.test.js
```

Expected: all tests `PASS`

**Step 5: Commit**

```bash
git add backend/src/routes/researchops/dashboard.js backend/src/routes/researchops/__tests__/dashboard.kb.route.test.js backend/src/services/researchops/project-location.service.js backend/src/services/researchops/__tests__/project-location.service.test.js backend/src/services/researchops/kb-search-payload.service.js
git commit -m "feat: route researchops kb requests through remote kbctl"
```

### Task 6: Verify the End-to-End Remote Flow Against the SSH Host

**Files:**
- Modify: `docs/plans/2026-03-10-remote-kbctl-design.md`
- Create: `docs/update/2026-03-10-remote-kbctl-smoke-checks.md`

**Step 1: Write the failing smoke-check list before claiming completion**

Document these exact commands in `docs/update/2026-03-10-remote-kbctl-smoke-checks.md`:

```bash
ssh -o ClearAllForwardings=yes compute.example.edu \
  'cd /egr/research-dselab/testuser/AutoRDL && python3 -m kb.kbctl index build --project openrfm --resource-root resource --db .researchops/kb/openrfm.sqlite3 --json'

ssh -o ClearAllForwardings=yes compute.example.edu \
  'cd /egr/research-dselab/testuser/AutoRDL && python3 -m kb.kbctl search-docs --project openrfm --resource-root resource --db .researchops/kb/openrfm.sqlite3 --query "PluRel training setup" --json'

ssh -o ClearAllForwardings=yes compute.example.edu \
  'cd /egr/research-dselab/testuser/AutoRDL && python3 -m kb.kbctl build-pack --project openrfm --db .researchops/kb/openrfm.sqlite3 --query "PluRel training setup" --context planning --json'
```

**Step 2: Run project-local verification commands**

Run:
```bash
python3 -m unittest kb.tests.test_index_builder kb.tests.test_kbctl_search_docs kb.tests.test_kbctl_detail_commands -v
node --test backend/src/services/researchops/__tests__/kb-remote.service.test.js backend/src/routes/researchops/__tests__/dashboard.kb.route.test.js backend/src/services/researchops/__tests__/kb-search-payload.service.test.js backend/src/services/researchops/__tests__/kb-pack-payload.service.test.js backend/src/services/researchops/__tests__/project-location.service.test.js
```

Expected:
- all Python tests `OK`
- all Node tests `PASS`

**Step 3: Run remote smoke checks**

Run the three SSH commands above and confirm:
- build succeeds and writes the remote DB
- `search-docs` returns PluRel/RT-style relevant docs
- `build-pack` returns mixed paper/code evidence with non-empty `resolved_assets`

**Step 4: Update docs with verified outcomes**

Record:
- remote corpus root used
- remote DB path used
- commands run
- observed output shape
- any known V1 limitations

**Step 5: Commit**

```bash
git add docs/plans/2026-03-10-remote-kbctl-design.md docs/update/2026-03-10-remote-kbctl-smoke-checks.md
git commit -m "docs: record remote kbctl verification"
```
