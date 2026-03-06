# Skill Object Schema (Claude Code / Codex Standard)

This project stores synced skills in object storage using a `SKILL.md`-first format compatible with Claude Code / Codex style skills.

## Standard

- Skill entrypoint must be `SKILL.md`
- Optional folders inside each skill:
- `scripts/`
- `assets/`
- `references/`

## Skill Object (Manifest)

```json
{
  "schemaVersion": "1.0",
  "standard": "claude-code-codex-skill",
  "id": "skill_frp-heavy-offload",
  "name": "frp-heavy-offload",
  "version": "d41d8cd98f00",
  "description": "Offload heavy tasks from DO to local executor via FRP.",
  "entrypoint": "SKILL.md",
  "compatibility": {
    "agents": ["claude-code", "codex"],
    "format": "SKILL.md"
  },
  "source": "object-storage",
  "updatedAt": "2026-02-23T12:34:56.000Z",
  "tags": [],
  "fileCount": 4,
  "files": [
    {
      "path": "SKILL.md",
      "sizeBytes": 1234,
      "sha256": "…",
      "contentType": "text/markdown",
      "storageKey": "skills/objects/skill_frp-heavy-offload/d41d8cd98f00/files/SKILL.md"
    }
  ],
  "objectStorage": {
    "manifestKey": "skills/objects/skill_frp-heavy-offload/d41d8cd98f00/skill.json",
    "filesPrefix": "skills/objects/skill_frp-heavy-offload/d41d8cd98f00/files"
  }
}
```

## Catalog Object

Per-user catalog index key:

- `skills/catalog/<userId>/index.json`

Catalog payload:

```json
{
  "schemaVersion": "1.0",
  "standard": "claude-code-codex-skill-catalog",
  "ownerUserId": "czk",
  "updatedAt": "2026-02-23T12:34:56.000Z",
  "skills": [
    {
      "id": "skill_frp-heavy-offload",
      "name": "frp-heavy-offload",
      "version": "d41d8cd98f00",
      "description": "Offload heavy tasks from DO to local executor via FRP.",
      "standard": "claude-code-codex-skill",
      "schemaVersion": "1.0",
      "entrypoint": "SKILL.md",
      "manifestKey": "skills/objects/skill_frp-heavy-offload/d41d8cd98f00/skill.json",
      "tags": [],
      "updatedAt": "2026-02-23T12:34:56.000Z",
      "source": "object-storage"
    }
  ]
}
```
