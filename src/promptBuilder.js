function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

function truncate(text, maxChars) {
  if (!text) return "";
  const value = String(text);
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...`;
}

function formatSummaryRows(summaries, maxItems) {
  return summaries.slice(0, maxItems).map((item) => {
    return `- [${item.projectId}] ${item.relativePath}: ${truncate(item.summary, 220)}`;
  });
}

function formatChunkRows(chunks, maxItems) {
  return chunks.slice(0, maxItems).map((chunk) => {
    const header = `- [${chunk.projectId}] ${chunk.relativePath}:${chunk.startLine}-${chunk.endLine}`;
    const body = `  ${truncate(chunk.summary || chunk.content, 360)}`;
    return `${header}\n${body}`;
  });
}

function formatFileTargets(files, maxItems) {
  return files.slice(0, maxItems).map((file) => {
    const score = typeof file.score === "number" ? file.score.toFixed(1) : "n/a";
    return `- [${file.projectId}] ${file.relativePath} (score ${score})`;
  });
}

function formatSignalRows(signals, key, formatter, maxItems) {
  const items = (signals && Array.isArray(signals[key]) ? signals[key] : []).slice(0, maxItems);
  return items.map(formatter);
}

function buildPrompt(context, query, options = {}) {
  const mode = options.mode || "query";
  const maxTokens = options.maxTokens || (mode === "prep" ? 1800 : 3000);
  const maxChars = maxTokens * 4;

  const lines = [];
  lines.push(mode === "prep" ? "Ready-to-Paste Context Pack:" : "Codebase Primer:");
  lines.push("- Multi-project local memory retrieval optimized for minimal tokens.");
  lines.push("- Paths are project-relative where possible.");
  lines.push(`Task: ${query}`);
  lines.push("");
  lines.push("Likely Edit Targets:");
  lines.push(...formatFileTargets(context.files || [], mode === "prep" ? 4 : 5));
  lines.push("");
  lines.push("Relevant Symbols:");
  lines.push(
    ...formatSignalRows(
      context.signals,
      "symbols",
      (item) => `- [${item.projectId}] ${item.relativePath} :: ${item.name}${item.type ? ` (${item.type})` : ""}`,
      mode === "prep" ? 5 : 8
    )
  );
  lines.push("");
  lines.push("Dependency Clues:");
  lines.push(
    ...formatSignalRows(
      context.signals,
      "dependencies",
      (item) => `- [${item.projectId}] ${item.relativePath} -> ${truncate(item.dependency, 100)}`,
      mode === "prep" ? 4 : 6
    )
  );
  lines.push("");
  lines.push("Top Summaries:");
  lines.push(...formatSummaryRows(context.summaries || [], mode === "prep" ? 6 : 8));
  lines.push("");
  lines.push("Top Chunks:");
  lines.push(...formatChunkRows(context.chunks || [], mode === "prep" ? 3 : 5));

  let prompt = lines.join("\n");
  if (prompt.length > maxChars) {
    const fallbackLines = [];
    fallbackLines.push(mode === "prep" ? "Ready-to-Paste Context Pack:" : "Codebase Primer:");
    fallbackLines.push("- Compact retrieval mode due to token budget.");
    fallbackLines.push(`Task: ${query}`);
    fallbackLines.push("");
    fallbackLines.push("Likely Edit Targets:");
    fallbackLines.push(...formatFileTargets(context.files || [], 3));
    fallbackLines.push("");
    fallbackLines.push("Top Summaries:");
    fallbackLines.push(...formatSummaryRows(context.summaries || [], mode === "prep" ? 4 : 6));
    fallbackLines.push("");
    fallbackLines.push("Top Chunks:");
    fallbackLines.push(...formatChunkRows(context.chunks || [], mode === "prep" ? 2 : 3));

    prompt = fallbackLines.join("\n");
  }

  if (prompt.length > maxChars) {
    prompt = truncate(prompt, maxChars);
  }

  return {
    prompt,
    estimatedTokens: estimateTokens(prompt)
  };
}

module.exports = {
  buildPrompt
};
