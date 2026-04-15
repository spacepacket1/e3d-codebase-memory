const { retrieveContext } = require("./retriever");
const { buildPrompt } = require("./promptBuilder");

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

function buildCompactContext(context, { maxFiles = 5, maxChunks = 5 } = {}) {
  const files = sortByScoreDesc(context.files || []).slice(0, maxFiles);
  const chunks = sortByScoreDesc(context.chunks || []).slice(0, maxChunks);
  return {
    ...context,
    files,
    chunks
  };
}

function buildPrepData({
  db,
  task,
  projectId,
  maxFiles = 5,
  maxChunks = 5,
  maxPromptChars = 20000,
  maxTokens
}) {
  const context = retrieveContext(db, task, { projectId });
  const compactContext = buildCompactContext(context, { maxFiles, maxChunks });
  const activeChunks = [...(compactContext.chunks || [])];

  const renderPrompt = () => {
    const scopedContext = {
      ...compactContext,
      chunks: [...activeChunks]
    };

    const resolvedMaxTokens = maxTokens || Math.max(300, Math.floor(maxPromptChars / 4));
    return buildPrompt(scopedContext, task, {
      mode: "prep",
      maxTokens: resolvedMaxTokens
    });
  };

  let promptPack = renderPrompt();
  const droppedChunkRefs = [];
  while (promptPack.prompt.length > maxPromptChars && activeChunks.length > 0) {
    const dropped = activeChunks.pop();
    droppedChunkRefs.push(
      `[${dropped.projectId}] ${dropped.relativePath}:${dropped.startLine}-${dropped.endLine}`
    );
    promptPack = renderPrompt();
  }

  const finalContext = {
    ...compactContext,
    chunks: [...activeChunks]
  };

  return {
    task,
    projectId: projectId || null,
    selectedFiles: finalContext.files || [],
    selectedChunks: finalContext.chunks || [],
    promptText: promptPack.prompt,
    estimatedPromptChars: promptPack.prompt.length,
    estimatedPromptTokens: promptPack.estimatedTokens,
    debug: {
      matchedFilesCount: (context.files || []).length,
      matchedChunksCount: (context.chunks || []).length,
      selectedFilesCount: (finalContext.files || []).length,
      selectedChunksCount: (finalContext.chunks || []).length,
      droppedChunks: droppedChunkRefs
    }
  };
}

module.exports = {
  buildPrepData,
  sortByScoreDesc
};
