function normalizeQuery(query) {
  const STOP_TOKENS = new Set([
    "where",
    "does",
    "what",
    "which",
    "when",
    "with",
    "that",
    "this",
    "from",
    "into",
    "task",
    "logic"
  ]);

  return String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-./\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countTokenMatches(text, token) {
  if (!text) return 0;
  const source = String(text).toLowerCase();
  const queryToken = String(token).toLowerCase();
  const boundaryPattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(queryToken)}([^a-z0-9]|$)`, "g");

  let boundaryCount = 0;
  while (boundaryPattern.exec(source) !== null) {
    boundaryCount += 1;
    if (boundaryCount >= 6) {
      return 6;
    }
  }

  if (boundaryCount > 0) {
    return boundaryCount;
  }

  let fallbackCount = 0;
  let index = source.indexOf(queryToken);
  while (index !== -1) {
    fallbackCount += 1;
    if (fallbackCount >= 3) {
      return 3;
    }
    index = source.indexOf(queryToken, index + queryToken.length);
  }

  return fallbackCount;
}

function scoreText(text, tokens, weight = 1) {
  const lower = String(text || "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    score += countTokenMatches(lower, token) * weight;
  }
  return score;
}

function buildTokenLikeFilter(tokens, columns) {
  const activeTokens = tokens.slice(0, 6);
  if (activeTokens.length === 0) {
    return { clause: "", params: [] };
  }

  const groups = [];
  const params = [];
  for (const token of activeTokens) {
    const inner = columns.map((column) => `${column} LIKE ?`).join(" OR ");
    groups.push(`(${inner})`);
    const likeValue = `%${token}%`;
    for (let i = 0; i < columns.length; i += 1) {
      params.push(likeValue);
    }
  }

  return {
    clause: `(${groups.join(" OR ")})`,
    params
  };
}

function buildWhereClause(projectId, likeFilter) {
  const clauses = [];
  const params = [];

  if (projectId) {
    clauses.push("project_id = ?");
    params.push(projectId);
  }
  if (likeFilter.clause) {
    clauses.push(likeFilter.clause);
    params.push(...likeFilter.params);
  }

  return {
    clause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function buildInClauseValues(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { placeholders: "", params: [] };
  }

  const limited = values.slice(0, 500);
  return {
    placeholders: limited.map(() => "?").join(", "),
    params: limited
  };
}

function unique(items) {
  return Array.from(new Set(items));
}

function tokenizeIdentifier(value) {
  return unique(
    String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9_\-./\s]/g, " ")
      .split(/[\s_\-./]+/)
      .filter((token) => token.length >= 2)
  );
}

function pathHeuristic(relativePath) {
  const pathValue = String(relativePath || "").toLowerCase();
  let score = 0;

  if (pathValue.startsWith("e3d-codebase-memory/") || pathValue.includes("/e3d-codebase-memory/")) {
    score -= 2.6;
  }

  if (
    pathValue.includes("/__tests__/") ||
    pathValue.endsWith(".test.js") ||
    pathValue.endsWith(".test.ts") ||
    pathValue.endsWith(".spec.js") ||
    pathValue.endsWith(".spec.ts")
  ) {
    score -= 3.5;
  }

  if (pathValue.startsWith("docs/") || pathValue.includes("/docs/")) {
    score -= 1.8;
  }

  if (
    pathValue.includes("timeseries_output") ||
    pathValue.includes("newsletter/") ||
    pathValue.includes("coverage/") ||
    pathValue.includes("/.claude/")
  ) {
    score -= 5;
  }

  if (
    pathValue.includes("/src/") ||
    pathValue.startsWith("src/") ||
    pathValue.includes("server/") ||
    pathValue.includes("routes/") ||
    pathValue.includes("runtime/") ||
    pathValue.includes("skills/")
  ) {
    score += 1.5;
  }

  return score;
}

function moduleHeuristic(relativePath, tokens) {
  const segments = tokenizeIdentifier(relativePath);
  const tokenSet = new Set(tokens);
  let score = 0;

  for (const segment of segments) {
    if (tokenSet.has(segment)) {
      score += 0.6;
    }
  }

  return Math.min(score, 3);
}

function hasApiCallIntent(queryTokens) {
  const tokenSet = new Set(queryTokens);
  return tokenSet.has("api") || tokenSet.has("call") || tokenSet.has("calls") || tokenSet.has("endpoint");
}

function apiCallsiteHeuristic(textValue, queryTokens) {
  if (!hasApiCallIntent(queryTokens)) {
    return 0;
  }

  const text = String(textValue || "").toLowerCase();
  let score = 0;

  if (text.includes("axios")) score += 2.2;
  if (text.includes("fetch(")) score += 2.2;
  if (text.includes("request(")) score += 1.8;
  if (text.includes("/api/")) score += 2.5;
  if (text.includes("http://") || text.includes("https://")) score += 1.6;

  return score;
}

function projectHeuristic(projectId, queryTokens) {
  const projectValue = String(projectId || "").toLowerCase();
  const tokens = new Set(queryTokens);
  let score = 0;

  if (tokens.has("trading") && tokens.has("floor") && projectValue === "e3d-agents") {
    score += 1.8;
  }
  if ((tokens.has("core") || tokens.has("spacepacket")) && projectValue === "e3d-core") {
    score += 1.4;
  }

  const projectTokens = tokenizeIdentifier(projectValue);
  for (const token of projectTokens) {
    if (tokens.has(token)) {
      score += 0.7;
    }
  }

  return score;
}

function buildFileSignalMaps(symbolRows, dependencyRows, tokens) {
  const symbolScoreByFile = new Map();
  const depScoreByFile = new Map();
  const topSymbols = [];
  const topDependencies = [];

  for (const symbol of symbolRows) {
    const symbolText = `${symbol.name || ""} ${symbol.type || ""} ${symbol.signature || ""} ${symbol.summary || ""}`;
    const score = scoreText(symbolText, tokens, 2.0) + Math.max(pathHeuristic(symbol.relative_path), -1.5);
    if (score <= 0) {
      continue;
    }

    const key = `${symbol.project_id}:${symbol.file_id}`;
    symbolScoreByFile.set(key, (symbolScoreByFile.get(key) || 0) + score);
    topSymbols.push({
      projectId: symbol.project_id,
      fileId: symbol.file_id,
      relativePath: symbol.relative_path,
      name: symbol.name,
      type: symbol.type,
      score
    });
  }

  for (const dep of dependencyRows) {
    const score = scoreText(dep.relation_type, tokens, 1.7) + Math.max(pathHeuristic(dep.relative_path), -1.5);
    if (score <= 0) {
      continue;
    }

    const key = `${dep.project_id}:${dep.from_file_id}`;
    depScoreByFile.set(key, (depScoreByFile.get(key) || 0) + score);
    topDependencies.push({
      projectId: dep.project_id,
      fileId: dep.from_file_id,
      relativePath: dep.relative_path,
      dependency: dep.relation_type,
      score
    });
  }

  return {
    symbolScoreByFile,
    depScoreByFile,
    topSymbols: topSymbols.sort((a, b) => b.score - a.score).slice(0, 8),
    topDependencies: topDependencies.sort((a, b) => b.score - a.score).slice(0, 8)
  };
}

function rankFiles(files, tokens, signalMaps) {
  return files
    .map((row) => {
      const key = `${row.project_id}:${row.id}`;
      const symbolScore = signalMaps.symbolScoreByFile.get(key) || 0;
      const depScore = signalMaps.depScoreByFile.get(key) || 0;
      const score =
        scoreText(row.relative_path, tokens, 2.2) +
        scoreText(row.summary, tokens, 1.5) +
        scoreText(row.language, tokens, 0.5) +
        pathHeuristic(row.relative_path) +
        moduleHeuristic(row.relative_path, tokens) +
        apiCallsiteHeuristic(row.summary, tokens) +
        projectHeuristic(row.project_id, tokens) +
        Math.min(symbolScore, 10) * 1.3 +
        Math.min(depScore, 8) * 0.9;
      return { ...row, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}

function diversifyByProject(rows, projectKey) {
  const byProject = new Map();
  const remainder = [];

  for (const row of rows) {
    const projectId = row[projectKey];
    if (!byProject.has(projectId)) {
      byProject.set(projectId, row);
      continue;
    }
    remainder.push(row);
  }

  return [...byProject.values(), ...remainder];
}

function rankChunks(chunks, tokens, signalMaps) {
  return chunks
    .map((row) => {
      const key = `${row.project_id}:${row.file_id}`;
      const symbolScore = signalMaps.symbolScoreByFile.get(key) || 0;
      const depScore = signalMaps.depScoreByFile.get(key) || 0;
      const boundedContent = String(row.content || "").slice(0, 6000);
      const score =
        scoreText(row.relative_path, tokens, 2.0) +
        scoreText(row.summary, tokens, 1.7) +
        scoreText(boundedContent, tokens, 0.7) +
        pathHeuristic(row.relative_path) +
        moduleHeuristic(row.relative_path, tokens) +
        apiCallsiteHeuristic(`${row.summary || ""}\n${boundedContent}`, tokens) +
        projectHeuristic(row.project_id, tokens) +
        Math.min(symbolScore, 10) * 0.8 +
        Math.min(depScore, 8) * 0.7;
      return { ...row, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}

function retrieveContext(db, query, options = {}) {
  const tokens = normalizeQuery(query);
  if (tokens.length === 0) {
    return {
      files: [],
      chunks: [],
      summaries: []
    };
  }

  const fileLike = buildTokenLikeFilter(tokens, ["relative_path", "summary", "language"]);
  const fileWhere = buildWhereClause(options.projectId, fileLike);
  const fileRows = db
    .prepare(
      `SELECT id, project_id, relative_path, absolute_path, language, summary
       FROM files
       ${fileWhere.clause}
       LIMIT 500`
    )
    .all(...fileWhere.params);

  if (fileRows.length === 0) {
    return {
      files: [],
      chunks: [],
      summaries: [],
      signals: {
        symbols: [],
        dependencies: []
      }
    };
  }

  const fileIds = fileRows.map((row) => row.id);
  const inClause = buildInClauseValues(fileIds);

  const chunkLike = buildTokenLikeFilter(tokens, ["c.summary", "c.content", "f.relative_path"]);
  const chunkRows = db
    .prepare(
      `SELECT c.id, c.project_id, c.file_id, c.chunk_index, c.start_line, c.end_line, c.content, c.summary,
              f.relative_path
       FROM chunks c
       JOIN files f ON f.id = c.file_id
       WHERE c.file_id IN (${inClause.placeholders})
       ${chunkLike.clause ? `AND ${chunkLike.clause}` : ""}
       LIMIT 1200`
    )
    .all(...inClause.params, ...chunkLike.params);

  const symbolRows = db
    .prepare(
      `SELECT s.project_id, s.file_id, s.name, s.type, s.signature, s.summary, f.relative_path
       FROM symbols s
       JOIN files f ON f.id = s.file_id
       WHERE s.file_id IN (${inClause.placeholders})`
    )
    .all(...inClause.params);

  const dependencyRows = db
    .prepare(
      `SELECT d.project_id, d.from_file_id, d.relation_type, f.relative_path
       FROM dependencies d
       JOIN files f ON f.id = d.from_file_id
       WHERE d.from_file_id IN (${inClause.placeholders})`
    )
    .all(...inClause.params);

  const signalMaps = buildFileSignalMaps(symbolRows, dependencyRows, tokens);

  let topFiles = rankFiles(fileRows, tokens, signalMaps);
  let topChunks = rankChunks(chunkRows, tokens, signalMaps);

  if (!options.projectId) {
    topFiles = diversifyByProject(topFiles, "project_id").slice(0, 5);
    topChunks = diversifyByProject(topChunks, "project_id").slice(0, 5);
  } else {
    topFiles = topFiles.slice(0, 5);
    topChunks = topChunks.slice(0, 5);
  }

  const summaries = [];
  for (const file of topFiles) {
    if (file.summary) {
      summaries.push({
        projectId: file.project_id,
        relativePath: file.relative_path,
        summary: file.summary,
        score: file.score
      });
    }
  }

  for (const chunk of topChunks) {
    if (chunk.summary) {
      summaries.push({
        projectId: chunk.project_id,
        relativePath: chunk.relative_path,
        summary: chunk.summary,
        score: chunk.score
      });
    }
  }

  const selectedFileIds = new Set([
    ...topFiles.map((row) => `${row.project_id}:${row.id}`),
    ...topChunks.map((row) => `${row.project_id}:${row.file_id}`)
  ]);

  const compactSignals = {
    symbols: signalMaps.topSymbols
      .filter((item) => selectedFileIds.has(`${item.projectId}:${item.fileId}`))
      .slice(0, 6)
      .map(({ projectId, relativePath, name, type }) => ({ projectId, relativePath, name, type })),
    dependencies: signalMaps.topDependencies
      .filter((item) => selectedFileIds.has(`${item.projectId}:${item.fileId}`))
      .slice(0, 6)
      .map(({ projectId, relativePath, dependency }) => ({ projectId, relativePath, dependency }))
  };

  return {
    files: topFiles.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      relativePath: row.relative_path,
      absolutePath: row.absolute_path,
      language: row.language,
      summary: row.summary,
      score: row.score
    })),
    chunks: topChunks.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      fileId: row.file_id,
      relativePath: row.relative_path,
      chunkIndex: row.chunk_index,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      summary: row.summary,
      score: row.score
    })),
    summaries: summaries
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ projectId, relativePath, summary }) => ({ projectId, relativePath, summary })),
    signals: compactSignals
  };
}

module.exports = {
  retrieveContext
};
