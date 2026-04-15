# e3d-codebase-memory

Local multi-project codebase memory engine with MCP tool support for Claude Code / Cowork.

Indexes both E3D repos into a single SQLite database and exposes them as MCP tools so Claude has persistent, searchable context across sessions.

## Indexed projects

| Project ID | Repo root |
|---|---|
| `e3d-core` | `/Users/cbloom/spacepacket` |
| `e3d-agents` | `/Users/cbloom/e3d-agent-trading-floor` |

## MCP registration

Both project roots already have `.mcp.json` files that register the server. Claude Code and Cowork pick these up automatically when you open either project.

The server loads its API key from `e3d-codebase-memory/.env` — do not put the key in `.mcp.json`.

## First-time setup / after dependency changes

```bash
cd /Users/cbloom/spacepacket/e3d-codebase-memory
npm install
```

If `better-sqlite3` fails (native module), rebuild it:

```bash
npm rebuild better-sqlite3
```

## Rescan (run this after significant file changes)

The database is incremental — only changed files are reindexed. Run after any session where files were created or modified:

```bash
cd /Users/cbloom/spacepacket/e3d-codebase-memory
npm run scan
```

Or to scan just one project:

```bash
node src/cli.js scan --project e3d-core
node src/cli.js scan --project e3d-agents
```

**Run a rescan now** — the database is from March 27 and is missing today's changes.

## Available MCP tools

| Tool | What it does |
|---|---|
| `prep_context` | Returns ranked code chunks + prompt text for a task. Use before editing unfamiliar files. |
| `query_context` | Returns ranked file list only (no provider call). Fast lookup. |
| `ask_codebase` | Runs prep + Anthropic call and returns an answer with context. |
| `scan_projects` | Rescans all projects incrementally. |
| `scan_project` | Rescans one project (`projectId` required). |

## Usage from Claude

Once the MCP server is running (auto-started by Claude Code from `.mcp.json`), Claude can call:

- `prep_context` with `{"task": "how does the signup flow work", "projectId": "e3d-core"}` before making changes to unfamiliar code
- `query_context` with `{"task": "pricing nav header"}` to find relevant files quickly
- `scan_project` with `{"projectId": "e3d-core"}` after a session with many file changes

## Environment

`e3d-codebase-memory/.env` (never commit this):

```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
```
