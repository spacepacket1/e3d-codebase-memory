# e3d-codebase-memory

A local, multi-project codebase memory engine for Claude Code. It indexes your repositories into one SQLite database and exposes the index as MCP tools, so Claude keeps searchable context across sessions instead of re-reading your code each time.

Everything runs on your machine. The only network call is the optional `ask_codebase` tool, which sends retrieved chunks to the Anthropic API.

## Install

Requires Node 18 or later.

```bash
git clone https://github.com/spacepacket1/e3d-codebase-memory.git
cd e3d-codebase-memory
npm install
```

If `better-sqlite3` fails after a Node upgrade or platform change, rebuild the native module:

```bash
npm rebuild better-sqlite3
```

## Configure your projects

Edit `src/config.json` to list the repositories to index:

```json
{
  "databasePath": "./data/codebase.db",
  "projects": [
    { "projectId": "my-app", "repoRoot": "/path/to/my-app" },
    { "projectId": "my-api", "repoRoot": "/path/to/my-api" }
  ],
  "ignore": ["node_modules", ".git", "dist", "build", ".next", "coverage", "*.log"]
}
```

The `projectId` values are what you pass to the tools below. The `config.json` in this repo is the author's own setup and points at paths on his machine, so replace it with yours.

For `ask_codebase`, create `.env` in this directory (never commit it):

```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
```

The server loads this file itself. Do not put the key in `.mcp.json`.

## Scan

The index is incremental: only changed files are re-read. Run a scan after a session that created or modified files.

```bash
npm run scan                              # all projects
node src/cli.js scan --project my-app     # one project
```

## Register with Claude Code

Add the server to the `.mcp.json` of each project you want Claude to search:

```json
{
  "mcpServers": {
    "codebase-memory": {
      "command": "node",
      "args": ["/path/to/e3d-codebase-memory/src/mcp/server.js"]
    }
  }
}
```

Claude Code starts it automatically when you open the project. To run it by hand for debugging, use `npm run mcp`.

## MCP tools

| Tool | What it does |
|---|---|
| `prep_context` | Ranked code chunks plus a ready-to-use prompt for a task. Use before editing unfamiliar code. Inputs: `task` (required), `projectId`, `maxFiles`, `maxChunks`, `maxPromptChars`, `debug` |
| `query_context` | Ranked file list only, with no provider call. Fast lookup. Inputs: `task` (required), `projectId` |
| `ask_codebase` | Runs prep plus an Anthropic call and returns an answer with context. Inputs: `task` (required), `projectId`, `provider`, `model`, `maxFiles`, `maxChunks`, `maxPromptChars`, `debug` |
| `scan_projects` | Rescan all configured projects incrementally |
| `scan_project` | Rescan one project. Input: `projectId` (required) |

Example calls from Claude:

- `prep_context` with `{"task": "how does the signup flow work", "projectId": "my-app"}` before changing unfamiliar code
- `query_context` with `{"task": "pricing nav header"}` to find relevant files quickly
- `scan_project` with `{"projectId": "my-app"}` after a session with many file changes

## Smoke test

```bash
node src/cli.js prep --for-agent "signup flow"
node src/cli.js query "pricing nav header"
```

## License

[MIT](LICENSE) © 2026 FutCo LLC. Part of the [FutCo](https://futco.ai/projects) open-source ecosystem.
