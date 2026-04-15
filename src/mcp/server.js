#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { createDb } = require("../db");
const { runPrepContextTool } = require("./tools/prepContext");
const { runAskCodebaseTool } = require("./tools/askCodebase");
const { runQueryContextTool } = require("./tools/queryContext");
const { runScanProjectsTool } = require("./tools/scanProjects");
const { runScanProjectTool } = require("./tools/scanProject");

function stripWrappingQuotes(value) {
  if (typeof value !== "string") return value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadDotEnvFromProjectRoot() {
  const envPath = path.resolve(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = stripWrappingQuotes(trimmed.slice(eqIndex + 1).trim());
    if (!key) continue;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadConfig() {
  const configPath = path.resolve(__dirname, "..", "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("Missing config.json");
  }
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

function textResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload)
      }
    ]
  };
}

function errorResult(message) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `ERROR: ${message}`
      }
    ]
  };
}

async function start() {
  loadDotEnvFromProjectRoot();
  const config = loadConfig();
  const dbHandle = createDb(config, { baseDir: path.resolve(__dirname, "..", "..") });
  const db = dbHandle.db;

  const server = new Server(
    {
      name: "e3d-codebase-memory",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "prep_context",
          description: "Retrieve compact ranked code context and prompt text for a coding task.",
          inputSchema: {
            type: "object",
            properties: {
              task: { type: "string" },
              projectId: { type: "string" },
              maxFiles: { type: "number" },
              maxChunks: { type: "number" },
              maxPromptChars: { type: "number" },
              debug: { type: "boolean" }
            },
            required: ["task"],
            additionalProperties: false
          }
        },
        {
          name: "ask_codebase",
          description: "Run prep workflow and ask a provider-backed model, returning answer with context metadata.",
          inputSchema: {
            type: "object",
            properties: {
              task: { type: "string" },
              projectId: { type: "string" },
              provider: { type: "string" },
              model: { type: "string" },
              maxFiles: { type: "number" },
              maxChunks: { type: "number" },
              maxPromptChars: { type: "number" },
              debug: { type: "boolean" }
            },
            required: ["task"],
            additionalProperties: false
          }
        },
        {
          name: "query_context",
          description: "Retrieve ranked files and chunks only (no provider call).",
          inputSchema: {
            type: "object",
            properties: {
              task: { type: "string" },
              projectId: { type: "string" }
            },
            required: ["task"],
            additionalProperties: false
          }
        },
        {
          name: "scan_projects",
          description: "Scan all configured projects and update index incrementally.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        },
        {
          name: "scan_project",
          description: "Scan one configured project and update index incrementally.",
          inputSchema: {
            type: "object",
            properties: {
              projectId: { type: "string" }
            },
            required: ["projectId"],
            additionalProperties: false
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params && request.params.name ? request.params.name : "";
    const args = (request.params && request.params.arguments) || {};

    try {
      if (name === "prep_context") {
        const payload = runPrepContextTool({ db, args });
        return textResult(payload);
      }

      if (name === "ask_codebase") {
        const payload = await runAskCodebaseTool({ db, args });
        return textResult(payload);
      }

      if (name === "query_context") {
        const payload = runQueryContextTool({ db, args });
        return textResult(payload);
      }

      if (name === "scan_projects") {
        const payload = runScanProjectsTool({ db, config });
        return textResult(payload);
      }

      if (name === "scan_project") {
        const payload = runScanProjectTool({ db, config, args });
        return textResult(payload);
      }

      return errorResult(`Unknown tool '${name}'`);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      return errorResult(message);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", () => {
    dbHandle.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    dbHandle.close();
    process.exit(0);
  });
}

start().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
});
