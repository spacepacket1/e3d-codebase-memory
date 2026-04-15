const { scanRepo, createStoragePipeline } = require("../../scanner");
const { summarizeFile } = require("../../summarizer");
const { chunkFile } = require("../../chunker");

function getProjects(config, projectId) {
  if (!projectId) return config.projects || [];
  return (config.projects || []).filter((project) => project.projectId === projectId);
}

function pruneStaleFilesForProject(db, projectId, discoveredRelativePaths) {
  const existingRows = db
    .prepare("SELECT relative_path FROM files WHERE project_id = ?")
    .all(projectId);

  const keepSet = new Set(discoveredRelativePaths || []);
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

function runScanProjectsTool({ db, config, projectId }) {
  const projects = getProjects(config, projectId);
  if (projects.length === 0) {
    throw new Error(projectId ? `No projects matched '${projectId}'` : "No projects configured");
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

  return {
    scopedProjectId: projectId || null,
    projects: output
  };
}

module.exports = {
  runScanProjectsTool
};
