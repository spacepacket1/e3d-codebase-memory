function unique(items) {
  return Array.from(new Set(items));
}

function extractDependencies(content) {
  const deps = [];
  const importRegex = /^\s*import\s+.+?from\s+["']([^"']+)["']/gm;
  const requireRegex = /require\(["']([^"']+)["']\)/gm;

  let match = importRegex.exec(content);
  while (match) {
    deps.push(match[1]);
    match = importRegex.exec(content);
  }

  match = requireRegex.exec(content);
  while (match) {
    deps.push(match[1]);
    match = requireRegex.exec(content);
  }

  return unique(deps).slice(0, 24);
}

function extractKeyFunctions(content) {
  const names = [];
  const patterns = [
    /function\s+([A-Za-z0-9_$]+)\s*\(/gm,
    /const\s+([A-Za-z0-9_$]+)\s*=\s*\([^)]*\)\s*=>/gm,
    /class\s+([A-Za-z0-9_$]+)\s+/gm,
    /([A-Za-z0-9_$]+)\s*:\s*function\s*\(/gm
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      names.push(match[1]);
      match = pattern.exec(content);
    }
  }

  return unique(names).slice(0, 40);
}

function summarizeFile(content) {
  const lineCount = content.split("\n").length;
  const keyFunctions = extractKeyFunctions(content);
  const dependencies = extractDependencies(content);

  const summaryParts = [
    `File with ${lineCount} lines.`,
    keyFunctions.length > 0 ? `Key functions: ${keyFunctions.slice(0, 6).join(", ")}.` : "",
    dependencies.length > 0 ? `Dependencies: ${dependencies.slice(0, 6).join(", ")}.` : ""
  ].filter(Boolean);

  return {
    summary: summaryParts.join(" "),
    keyFunctions,
    dependencies
  };
}

module.exports = {
  summarizeFile
};
