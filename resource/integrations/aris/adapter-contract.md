# ARIS MCP Adapter Contract

The Auto Researcher MCP server is the paper-library backend ARIS uses instead of Zotero.

Current tool contract:

- `search_library`
  - input: `query`, optional `userId`, optional `limit`
  - output: paper-centric search results with title, authors, year, venue, tags, and source URL

- `get_document`
  - input: `id`, optional `userId`
  - output: one saved paper with processed notes, personal notes, reading history, and citation summary

- `list_tags`
  - input: optional `userId`
  - output: available saved library tags

- `get_document_notes`
  - input: `id`, optional `userId`
  - output: processed paper/code notes

- `get_user_notes`
  - input: `id`, optional `userId`
  - output: manual notes attached to the paper

- `get_reading_history`
  - input: `id`, optional `userId`
  - output: read events and reading annotations

- `export_citation`
  - input: `id`, optional `userId`, optional `format`
  - output: citation text plus resolved metadata

The adapter is intentionally paper-centric and does not expose raw internal table shapes.
