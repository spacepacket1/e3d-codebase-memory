const { runAskWorkflow } = require("../../ask");

function toInt(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

async function runAskCodebaseTool({ db, args }) {
  const task = String(args.task || "").trim();
  if (!task) {
    throw new Error("task is required");
  }

  const result = await runAskWorkflow({
    db,
    task,
    projectId: args.projectId ? String(args.projectId) : undefined,
    provider: args.provider ? String(args.provider) : undefined,
    model: args.model ? String(args.model) : undefined,
    maxFiles: toInt(args.maxFiles, 5),
    maxChunks: toInt(args.maxChunks, 5),
    maxPromptChars: toInt(args.maxPromptChars, 20000)
  });

  const response = {
    task,
    provider: result.provider,
    model: result.model,
    answer: result.answer,
    usage: result.usage,
    context: result.context
  };

  if (args.debug === true) {
    response.debug = result.prep.debug;
  }

  return response;
}

module.exports = {
  runAskCodebaseTool
};
