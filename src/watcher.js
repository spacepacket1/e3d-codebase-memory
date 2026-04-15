const { scanRepo, createStoragePipeline } = require("./scanner");
const { summarizeFile } = require("./summarizer");
const { chunkFile } = require("./chunker");

function pruneStaleFilesForProject(db, projectId, discoveredRelativePaths) {
  const existingRows = db
    .prepare("SELECT relative_path FROM files WHERE project_id = ?")
    .all(projectId);
  const keepSet = new Set(discoveredRelativePaths || []);
  const deleteStmt = db.prepare(
    "DELETE FROM files WHERE project_id = ? AND relative_path = ?"
  );

  const tx = db.transaction((paths) => {
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
    tx(toDelete);
  }

  return toDelete.length;
}

function watchRepo(options) {
  const {
    db,
    config,
    projectId,
    intervalMs = 5000,
    logger = console
  } = options;

  const getStoredHashStmt = db.prepare(
    "SELECT hash FROM files WHERE project_id = ? AND relative_path = ?"
  );
  const getStoredHash = (pid, relativePath) => {
    const row = getStoredHashStmt.get(pid, relativePath);
    return row ? row.hash : null;
  };

  const storage = createStoragePipeline(db, { summarizeFile, chunkFile });
  const selectedProjects = projectId
    ? config.projects.filter((project) => project.projectId === projectId)
    : config.projects;

  if (selectedProjects.length === 0) {
    throw new Error(`No projects matched '${projectId}'`);
  }

  const tick = () => {
    for (const project of selectedProjects) {
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

      logger.log(
        `[watch] ${project.projectId}: scanned=${result.scanned} changed=${result.changed} unchanged=${result.skippedUnchanged} deleted=${deleted}`
      );
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

module.exports = {
  watchRepo
};
