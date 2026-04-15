const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  ".next",
  "coverage",
  "logs"
]);

const DEFAULT_TEXT_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".sql",
  ".html",
  ".css",
  ".scss",
  ".sh",
  ".env",
  ".xml"
]);

const MAX_FILE_BYTES = 300 * 1024;

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return "text";
  return ext.slice(1);
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0) return true;
  }
  return false;
}

function shouldIgnorePath(name, ignorePatterns) {
  if (DEFAULT_IGNORE_DIRS.has(name)) {
    return true;
  }
  return ignorePatterns.some((pattern) => {
    if (pattern.endsWith("*")) {
      return name.startsWith(pattern.slice(0, -1));
    }
    if (pattern.startsWith("*")) {
      return name.endsWith(pattern.slice(1));
    }
    return name === pattern;
  });
}

function shouldIncludeFile(absolutePath, fileName, fileSizeBytes) {
  const ext = path.extname(fileName).toLowerCase();
  if (fileName.endsWith(".log")) return false;
  if (fileSizeBytes > MAX_FILE_BYTES) return false;
  if (!ext) return true;
  return DEFAULT_TEXT_EXTENSIONS.has(ext);
}

function collectFiles(rootDir, ignorePatterns) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const relativeDir = path.relative(rootDir, fullPath);
        const pathSegments = relativeDir.split(path.sep).filter(Boolean);
        const matchedBySegment = pathSegments.some((segment) =>
          shouldIgnorePath(segment, ignorePatterns)
        );

        if (matchedBySegment || shouldIgnorePath(entry.name, ignorePatterns)) {
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stat = fs.statSync(fullPath);
      if (!shouldIncludeFile(fullPath, entry.name, stat.size)) {
        continue;
      }

      files.push(fullPath);
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function scanRepo(project, options = {}) {
  const { projectId, repoRoot } = project;
  const ignorePatterns = options.ignorePatterns || [];
  const getStoredHash = options.getStoredHash;

  if (!projectId || !repoRoot) {
    throw new Error("scanRepo requires projectId and repoRoot");
  }

  if (!fs.existsSync(repoRoot)) {
    return {
      projectId,
      repoRoot,
      scanned: 0,
      changed: 0,
      skippedUnchanged: 0,
      discoveredRelativePaths: [],
      files: []
    };
  }

  const discoveredFiles = collectFiles(repoRoot, ignorePatterns);
  const discoveredRelativePaths = discoveredFiles.map((absolutePath) =>
    path.relative(repoRoot, absolutePath)
  );
  const changedFiles = [];
  let skippedUnchanged = 0;

  for (const absolutePath of discoveredFiles) {
    const stat = fs.statSync(absolutePath);
    const raw = fs.readFileSync(absolutePath);
    if (looksBinary(raw)) {
      continue;
    }

    const content = raw.toString("utf8");
    const relativePath = path.relative(repoRoot, absolutePath);
    const hash = hashContent(content);
    const existingHash = getStoredHash ? getStoredHash(projectId, relativePath) : null;

    if (existingHash && existingHash === hash) {
      skippedUnchanged += 1;
      continue;
    }

    changedFiles.push({
      projectId,
      repoRoot,
      absolutePath,
      relativePath,
      content,
      hash,
      lastModified: Math.floor(stat.mtimeMs),
      language: detectLanguage(relativePath)
    });
  }

  return {
    projectId,
    repoRoot,
    scanned: discoveredFiles.length,
    changed: changedFiles.length,
    skippedUnchanged,
    discoveredRelativePaths,
    files: changedFiles
  };
}

function createStoragePipeline(db, { summarizeFile, chunkFile }) {
  const selectFileByPath = db.prepare(
    `SELECT id FROM files WHERE project_id = ? AND relative_path = ?`
  );
  const upsertFile = db.prepare(
    `INSERT INTO files (project_id, repo_root, relative_path, absolute_path, hash, last_modified, language, summary)
     VALUES (@project_id, @repo_root, @relative_path, @absolute_path, @hash, @last_modified, @language, @summary)
     ON CONFLICT(project_id, relative_path) DO UPDATE SET
       repo_root = excluded.repo_root,
       absolute_path = excluded.absolute_path,
       hash = excluded.hash,
       last_modified = excluded.last_modified,
       language = excluded.language,
       summary = excluded.summary`
  );
  const deleteChunks = db.prepare(`DELETE FROM chunks WHERE file_id = ?`);
  const deleteSymbols = db.prepare(`DELETE FROM symbols WHERE file_id = ?`);
  const deleteDepsByFrom = db.prepare(`DELETE FROM dependencies WHERE from_file_id = ?`);
  const insertChunk = db.prepare(
    `INSERT INTO chunks (project_id, file_id, chunk_index, start_line, end_line, content, summary)
     VALUES (@project_id, @file_id, @chunk_index, @start_line, @end_line, @content, @summary)`
  );
  const insertSymbol = db.prepare(
    `INSERT INTO symbols (project_id, file_id, name, type, signature, summary)
     VALUES (@project_id, @file_id, @name, @type, @signature, @summary)`
  );
  const insertDependency = db.prepare(
    `INSERT INTO dependencies (project_id, from_file_id, to_file_id, relation_type)
     VALUES (?, ?, NULL, ?)`
  );

  const processFile = db.transaction((file) => {
    const fileSummary = summarizeFile(file.content);

    upsertFile.run({
      project_id: file.projectId,
      repo_root: file.repoRoot,
      relative_path: file.relativePath,
      absolute_path: file.absolutePath,
      hash: file.hash,
      last_modified: file.lastModified,
      language: file.language,
      summary: fileSummary.summary
    });

    const fileRow = selectFileByPath.get(file.projectId, file.relativePath);
    if (!fileRow) {
      throw new Error(`Failed to resolve file row for ${file.relativePath}`);
    }

    const fileId = fileRow.id;
    deleteChunks.run(fileId);
    deleteSymbols.run(fileId);
    deleteDepsByFrom.run(fileId);

    const chunks = chunkFile(file.content);
    for (const chunk of chunks) {
      insertChunk.run({
        project_id: file.projectId,
        file_id: fileId,
        chunk_index: chunk.chunkIndex,
        start_line: chunk.startLine,
        end_line: chunk.endLine,
        content: chunk.content,
        summary: chunk.summary
      });
    }

    for (const fnName of fileSummary.keyFunctions) {
      insertSymbol.run({
        project_id: file.projectId,
        file_id: fileId,
        name: fnName,
        type: "function",
        signature: null,
        summary: null
      });
    }

    for (const dep of fileSummary.dependencies) {
      insertDependency.run(file.projectId, fileId, dep);
    }

    return {
      fileId,
      relativePath: file.relativePath,
      chunks: chunks.length,
      symbols: fileSummary.keyFunctions.length,
      dependencies: fileSummary.dependencies.length
    };
  });

  return {
    processFiles(files) {
      const results = [];
      for (const file of files) {
        results.push(processFile(file));
      }
      return results;
    }
  };
}

module.exports = {
  createStoragePipeline,
  detectLanguage,
  hashContent,
  scanRepo
};
