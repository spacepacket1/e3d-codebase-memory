const { retrieveContext } = require("../../retriever");
const { sortByScoreDesc } = require("../../prep");

function runQueryContextTool({ db, args }) {
  const task = String(args.task || "").trim();
  if (!task) {
    throw new Error("task is required");
  }

  const projectId = args.projectId ? String(args.projectId) : undefined;
  const context = retrieveContext(db, task, { projectId });

  const files = sortByScoreDesc(context.files || []).slice(0, 5).map((file) => ({
    projectId: file.projectId,
    relativePath: file.relativePath,
    score: file.score,
    summary: file.summary || null
  }));

  const chunks = sortByScoreDesc(context.chunks || []).slice(0, 5).map((chunk) => ({
    projectId: chunk.projectId,
    relativePath: chunk.relativePath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    score: chunk.score,
    summary: chunk.summary || null
  }));

  return {
    task,
    projectScope: projectId || null,
    files,
    chunks
  };
}

module.exports = {
  runQueryContextTool
};
