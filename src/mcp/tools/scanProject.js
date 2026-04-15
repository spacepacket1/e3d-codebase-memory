const { runScanProjectsTool } = require("./scanProjects");

function runScanProjectTool({ db, config, args }) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) {
    throw new Error("projectId is required");
  }

  const result = runScanProjectsTool({ db, config, projectId });
  return {
    projectId,
    result: result.projects[0] || null
  };
}

module.exports = {
  runScanProjectTool
};
