const { buildPrepData } = require("../../prep");

function toInt(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function runPrepContextTool({ db, args }) {
  const task = String(args.task || "").trim();
  if (!task) {
    throw new Error("task is required");
  }

  const result = buildPrepData({
    db,
    task,
    projectId: args.projectId ? String(args.projectId) : undefined,
    maxFiles: toInt(args.maxFiles, 5),
    maxChunks: toInt(args.maxChunks, 5),
    maxPromptChars: toInt(args.maxPromptChars, 20000)
  });

  const response = {
    task: result.task,
    projectScope: result.projectId,
    selectedFiles: result.selectedFiles.map((file) => ({
      projectId: file.projectId,
      relativePath: file.relativePath,
      score: file.score,
      summary: file.summary || null
    })),
    selectedChunks: result.selectedChunks.map((chunk) => ({
      projectId: chunk.projectId,
      relativePath: chunk.relativePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score: chunk.score,
      summary: chunk.summary || null,
      content: chunk.content || ""
    })),
    promptText: result.promptText,
    estimatedPromptChars: result.estimatedPromptChars,
    estimatedPromptTokens: result.estimatedPromptTokens
  };

  if (args.debug === true) {
    response.debug = result.debug;
  }

  return response;
}

module.exports = {
  runPrepContextTool
};
