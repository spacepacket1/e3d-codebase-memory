const { buildPrepData } = require("./prep");
const { sendAnthropicPrompt } = require("./providers/anthropic");

async function runAskWorkflow({
  db,
  task,
  projectId,
  provider = "anthropic",
  model,
  maxFiles = 5,
  maxChunks = 5,
  maxPromptChars = 20000,
  maxTokens = 1200
}) {
  if (!task || !String(task).trim()) {
    throw new Error("task is required");
  }

  if (provider !== "anthropic") {
    throw new Error(`Unsupported provider '${provider}'`);
  }

  const prep = buildPrepData({
    db,
    task,
    projectId,
    maxFiles,
    maxChunks,
    maxPromptChars
  });

  const response = await sendAnthropicPrompt({
    model: model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
    promptText: prep.promptText,
    maxTokens,
    temperature: 0
  });

  return {
    provider,
    model: response.model,
    answer: response.text,
    usage: response.usage || null,
    context: {
      projectScope: prep.projectId,
      selectedFiles: prep.selectedFiles.length,
      selectedChunks: prep.selectedChunks.length,
      estimatedPromptChars: prep.estimatedPromptChars,
      estimatedPromptTokens: prep.estimatedPromptTokens
    },
    prep
  };
}

module.exports = {
  runAskWorkflow
};
