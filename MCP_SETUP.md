# E3D Codebase Memory — MCP Setup

Local MCP server that gives Claude persistent, searchable context across sessions for the E3D stack.

## Install

```bash
cd /Users/cbloom/spacepacket/e3d-codebase-memory
npm install
```

If `better-sqlite3` fails after a Node upgrade or platform change, rebuild the native module:

```bash
npm rebuild better-sqlite3
```

## MCP registration

Both project roots have `.mcp.json` files that auto-register the server with Claude Code / Cowork:

- `/Users/cbloom/spacepacket/.mcp.json`
- `/Users/cbloom/e3d-agent-trading-floor/.mcp.json`

No manual registration needed — Claude picks these up automatically when either project is open.

## Run server manually (for debugging)

```bash
npm run mcp
```

## Rescan the index

The database is incremental. Run after sessions where files were created or modified:

```bash
cd /Users/cbloom/spacepacket/e3d-codebase-memory
npm run scan
```

Scan one project only:

```bash
node src/cli.js scan --project e3d-core
node src/cli.js scan --project e3d-agents
```

## Exposed tools

### `prep_context`
Retrieve ranked code chunks + a ready-to-use prompt string for a task. Use before editing unfamiliar code.

Inputs: `task` (required), `projectId`, `maxFiles`, `maxChunks`, `maxPromptChars`, `debug`

### `query_context`
Ranked file list only — no provider call. Fast lookup.

Inputs: `task` (required), `projectId`

### `ask_codebase`
Runs prep + Anthropic call, returns answer with context metadata.

Inputs: `task` (required), `projectId`, `provider`, `model`, `maxFiles`, `maxChunks`, `maxPromptChars`, `debug`

### `scan_projects`
Rescan all configured projects incrementally.

### `scan_project`
Rescan one project. Inputs: `projectId` (required)

## Environment

`e3d-codebase-memory/.env` — never commit:

```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
```

The server auto-loads this file. Do not put the key in `.mcp.json`.

## Quick smoke tests

```bash
node src/cli.js prep --for-agent "signup flow"
node src/cli.js query "pricing nav header"
```
