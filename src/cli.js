#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { createDb } = require("./db");
const { scanRepo, createStoragePipeline } = require("./scanner");
const { summarizeFile } = require("./summarizer");
const { chunkFile } = require("./chunker");
const { retrieveContext } = require("./retriever");
const { buildPrompt } = require("./promptBuilder");
const { watchRepo } = require("./watcher");
const { sendAnthropicPrompt } = require("./providers/anthropic");

function stripWrappingQuotes(value) {
  if (typeof value !== "string") return value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadDotEnvFromProjectRoot() {
  const envPath = path.resolve(__dirname, "..", ".env");
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
  const configPath = path.resolve(__dirname, "config.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const flags = {};
  const positionals = [];

  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--project") {
      flags.projectId = args[i + 1];
      i += 1;
      continue;
    }
    if (token === "--interval") {
      flags.intervalMs = Number(args[i + 1]) * 1000;
      i += 1;
      continue;
    }
    if (token === "--tokens") {
      flags.maxTokens = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--provider") {
      flags.provider = args[i + 1];
      i += 1;
      continue;
    }
    if (token === "--model") {
      flags.model = args[i + 1];
      i += 1;
      continue;
    }
    if (token === "--format") {
      flags.format = args[i + 1];
      i += 1;
      continue;
    }
    if (token === "--max-prompt-chars") {
      flags.maxPromptChars = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--for-agent") {
      flags.forAgent = true;
      continue;
    }
    positionals.push(token);
  }

  return { command, flags, positionals };
}

function getProjects(config, projectId) {
  if (!projectId) return config.projects;
  return config.projects.filter((project) => project.projectId === projectId);
}

function pruneStaleFilesForProject(db, projectId, discoveredRelativePaths) {
  const existingRows = db
    .prepare("SELECT relative_path FROM files WHERE project_id = ?")
    .all(projectId);

  const keepSet = new Set(discoveredRelativePaths);
  const deleteStmt = db.prepare(
    "DELETE FROM files WHERE project_id = ? AND relative_path = ?"
  );

  const removeMany = db.transaction((paths) => {
    for (const relativePath of paths) {
      deleteStmt.run(projectId, relativePath);
    }
  });

  const toDelete = [];
  for (const row of existingRows) {
    if (!keepSet.has(row.relative_path)) {
      toDelete.push(row.relative_path);
    }
  }

  if (toDelete.length > 0) {
    removeMany(toDelete);
  }

  return toDelete.length;
}

function runScan({ db, config, projectId }) {
  const projects = getProjects(config, projectId);
  if (projects.length === 0) {
    throw new Error(`No projects matched '${projectId}'`);
  }

  const getStoredHashStmt = db.prepare(
    "SELECT hash FROM files WHERE project_id = ? AND relative_path = ?"
  );
  const getStoredHash = (pid, relativePath) => {
    const row = getStoredHashStmt.get(pid, relativePath);
    return row ? row.hash : null;
  };

  const storage = createStoragePipeline(db, { summarizeFile, chunkFile });
  const output = [];

  for (const project of projects) {
    const result = scanRepo(project, {
      ignorePatterns: config.ignore || [],
      getStoredHash
    });

    const deleted = pruneStaleFilesForProject(
      db,
      project.projectId,
      result.discoveredRelativePaths || []
    );

    if (result.files.length > 0) {
      storage.processFiles(result.files);
    }

    output.push({
      projectId: project.projectId,
      scanned: result.scanned,
      changed: result.changed,
      skippedUnchanged: result.skippedUnchanged,
      deleted
    });
  }

  return output;
}

function printScanOutput(scanOutput) {
  for (const row of scanOutput) {
    console.log(
      `[scan] ${row.projectId} scanned=${row.scanned} changed=${row.changed} unchanged=${row.skippedUnchanged} deleted=${row.deleted}`
    );
  }
}

function runQuery({ db, query, projectId }) {
  const context = retrieveContext(db, query, { projectId });
  const promptPack = buildPrompt(context, query, { maxTokens: 3000 });

  console.log("=== Retrieval Results ===");
  if (context.files.length === 0 && context.chunks.length === 0) {
    console.log("No matches found.");
  } else {
    for (const file of context.files) {
      console.log(`FILE [${file.projectId}] ${file.relativePath} score=${file.score.toFixed(2)}`);
    }
    for (const chunk of context.chunks) {
      console.log(
        `CHUNK [${chunk.projectId}] ${chunk.relativePath}:${chunk.startLine}-${chunk.endLine} score=${chunk.score.toFixed(2)}`
      );
    }
  }

  console.log("\n=== Compact Prompt Pack ===");
  console.log(`Estimated tokens: ${promptPack.estimatedTokens}`);
  console.log(promptPack.prompt);
}

function sortByScoreDesc(rows) {
  return [...(rows || [])].sort((a, b) => {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;

    const aProject = a.projectId || "";
    const bProject = b.projectId || "";
    if (aProject !== bProject) return aProject.localeCompare(bProject);

    const aPath = a.relativePath || "";
    const bPath = b.relativePath || "";
    if (aPath !== bPath) return aPath.localeCompare(bPath);

    return (a.startLine || 0) - (b.startLine || 0);
  });
}

function buildPrepData({ db, query, projectId, maxTokens, maxFiles = 5, maxChunks = 5 }) {
  const context = retrieveContext(db, query, { projectId });
  const files = sortByScoreDesc(context.files || []).slice(0, maxFiles);
  const chunks = sortByScoreDesc(context.chunks || []).slice(0, maxChunks);
  const compactContext = {
    ...context,
    files,
    chunks
  };

  const promptPack = buildPrompt(compactContext, query, {
    mode: "prep",
    maxTokens: maxTokens || 1800
  });

  return {
    query,
    projectId: projectId || null,
    context: compactContext,
    promptPack
  };
}

function buildAgentPrepPrompt({ query, projectId, files, chunks, maxPromptChars = 20000 }) {
  const selectedFiles = sortByScoreDesc(files || []).slice(0, 5);
  const selectedChunks = sortByScoreDesc(chunks || []).slice(0, 5);
  const activeChunks = [...selectedChunks];

  const render = () => {
    const lines = [];
    lines.push("=== TASK ===");
    lines.push(query);
    lines.push("");
    lines.push("=== CONTEXT RULES ===");
    lines.push("- Use only the supplied context first");
    lines.push("- Do not assume missing files");
    lines.push("- If needed, explicitly request additional files");
    lines.push("");
    lines.push("=== RELEVANT FILES ===");
    if (selectedFiles.length === 0) {
      lines.push("- (none)");
    } else {
      for (const file of selectedFiles) {
        lines.push(`- [${file.projectId}] ${file.relativePath}`);
      }
    }
    lines.push("");
    lines.push("=== RELEVANT CHUNKS ===");
    if (activeChunks.length === 0) {
      lines.push("(none)");
      lines.push("");
    } else {
      for (const chunk of activeChunks) {
        lines.push(`[${chunk.projectId}] ${chunk.relativePath}:${chunk.startLine}-${chunk.endLine}`);
        lines.push(`Summary: ${chunk.summary || "No summary."}`);
        lines.push("Code:");
        lines.push(chunk.content || "");
        lines.push("");
      }
    }
    lines.push("=== IMPLEMENTATION GUIDANCE ===");
    lines.push("- Preserve architecture");
    lines.push("- Make incremental changes");
    lines.push("");
    lines.push("=== META ===");
    lines.push(`project_scope: ${projectId || "all"}`);
    lines.push(`selected_files: ${selectedFiles.length}`);
    lines.push(`selected_chunks: ${activeChunks.length}`);
    lines.push("");
    lines.push("=== END CONTEXT ===");
    return lines.join("\n");
  };

  let promptText = render();
  while (promptText.length > maxPromptChars && activeChunks.length > 0) {
    activeChunks.pop();
    promptText = render();
  }

  return {
    promptText,
    selectedFiles,
    selectedChunks: activeChunks
  };
}

function runPrep({ db, query, projectId, maxTokens, forAgent, maxPromptChars }) {
  const prep = buildPrepData({ db, query, projectId, maxTokens });

  if (forAgent) {
    const agentPrompt = buildAgentPrepPrompt({
      query,
      projectId,
      files: prep.context.files,
      chunks: prep.context.chunks,
      maxPromptChars: maxPromptChars || 20000
    });
    console.log(agentPrompt.promptText);
    return;
  }

  console.log("=== Ready-to-Paste LLM Context Pack ===");
  console.log(`Estimated tokens: ${prep.promptPack.estimatedTokens}`);
  console.log("Paste the section below into your coding conversation:");
  console.log("-----BEGIN CONTEXT PACK-----");
  console.log(prep.promptPack.prompt);
  console.log("-----END CONTEXT PACK-----");
}

async function runAsk({
  db,
  query,
  projectId,
  forAgent,
  format,
  provider,
  model,
  maxTokens,
  maxPromptChars
}) {
  const prep = buildPrepData({ db, query, projectId, maxTokens });
  const providerName = provider || "anthropic";

  if (providerName !== "anthropic") {
    throw new Error(`Unsupported provider '${providerName}'`);
  }

  const modelName = model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

  let promptText = prep.promptPack.prompt;
  let selectedFiles = prep.context.files || [];
  let selectedChunks = prep.context.chunks || [];

  if (forAgent) {
    const agentPrompt = buildAgentPrepPrompt({
      query,
      projectId,
      files: prep.context.files,
      chunks: prep.context.chunks,
      maxPromptChars: maxPromptChars || 20000
    });
    promptText = agentPrompt.promptText;
    selectedFiles = agentPrompt.selectedFiles;
    selectedChunks = agentPrompt.selectedChunks;
  }

  if (forAgent && format === "patch") {
    promptText = `${promptText}\n\nReturn only a unified diff patch. Do not include commentary.`;
  }

  const response = await sendAnthropicPrompt({
    model: modelName,
    promptText,
    maxTokens: maxTokens || 1200,
    temperature: 0
  });

  if (forAgent && format === "patch") {
    console.log(response.text.trim());
    return;
  }

  if (forAgent) {
    console.log("=== ANSWER ===");
    console.log(response.text.trim());
    console.log("");
    console.log("=== CONTEXT USED ===");
    console.log(`files: ${selectedFiles.length}`);
    console.log(`chunks: ${selectedChunks.length}`);
    console.log("");
    console.log("=== END ANSWER ===");
    return;
  }

  console.log(`Provider: ${providerName}`);
  console.log(`Model: ${response.model}`);
  console.log("");
  console.log("Answer:");
  console.log(response.text.trim());
}

function printUsage() {
  console.log("Usage:");
  console.log("  node src/cli.js scan");
  console.log("  node src/cli.js scan --project e3d-core");
  console.log('  node src/cli.js query "How does agent call E3D API?"');
  console.log('  node src/cli.js query --project e3d-core "heartbeat logic"');
  console.log('  node src/cli.js prep "implement heartbeat retry logic"');
  console.log('  node src/cli.js prep --project e3d-core --tokens 1400 "heartbeat logic"');
  console.log('  node src/cli.js prep --for-agent "implement heartbeat retry logic"');
  console.log('  node src/cli.js ask "Where does trading floor call E3D API?"');
  console.log('  node src/cli.js ask --for-agent "implement heartbeat retry logic"');
  console.log('  node src/cli.js ask --for-agent --format patch "add retry guard"');
  console.log("  node src/cli.js watch");
  console.log("  node src/cli.js watch --project e3d-core --interval 5");
}

async function main() {
  loadDotEnvFromProjectRoot();

  const { command, flags, positionals } = parseArgs(process.argv);
  const config = loadConfig();
  const dbHandle = createDb(config, { baseDir: path.resolve(__dirname, "..") });
  const db = dbHandle.db;

  try {
    if (command === "scan") {
      const output = runScan({ db, config, projectId: flags.projectId });
      printScanOutput(output);
      return;
    }

    if (command === "query") {
      const query = positionals.join(" ").trim();
      if (!query) {
        throw new Error("Query text is required.");
      }
      runQuery({ db, query, projectId: flags.projectId });
      return;
    }

    if (command === "prep") {
      const query = positionals.join(" ").trim();
      if (!query) {
        throw new Error("Task description is required for prep.");
      }
      runPrep({
        db,
        query,
        projectId: flags.projectId,
        maxTokens: flags.maxTokens,
        forAgent: Boolean(flags.forAgent),
        maxPromptChars: flags.maxPromptChars
      });
      return;
    }

    if (command === "ask") {
      const query = positionals.join(" ").trim();
      if (!query) {
        throw new Error("Task description is required for ask.");
      }

      await runAsk({
        db,
        query,
        projectId: flags.projectId,
        forAgent: Boolean(flags.forAgent),
        format: flags.format,
        provider: flags.provider,
        model: flags.model,
        maxTokens: flags.maxTokens,
        maxPromptChars: flags.maxPromptChars
      });
      return;
    }

    if (command === "watch") {
      const watcher = watchRepo({
        db,
        config,
        projectId: flags.projectId,
        intervalMs: flags.intervalMs || 5000,
        logger: console
      });

      console.log("Watcher running. Press Ctrl+C to stop.");
      process.on("SIGINT", () => {
        watcher.stop();
        dbHandle.close();
        process.exit(0);
      });
      return;
    }

    printUsage();
  } finally {
    if (command !== "watch") {
      dbHandle.close();
    }
  }
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
});
