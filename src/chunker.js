function summarizeChunk(lines) {
  const meaningful = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("#"));

  if (meaningful.length === 0) {
    return "Mostly comments or whitespace.";
  }

  return meaningful.slice(0, 2).join(" ").slice(0, 220);
}

function chunkFile(content, options = {}) {
  const chunkSize = options.chunkSize || 300;
  const lines = content.split("\n");
  const chunks = [];

  let chunkIndex = 0;
  for (let start = 0; start < lines.length; start += chunkSize) {
    const endExclusive = Math.min(start + chunkSize, lines.length);
    const block = lines.slice(start, endExclusive);
    chunks.push({
      chunkIndex,
      startLine: start + 1,
      endLine: endExclusive,
      content: block.join("\n"),
      summary: summarizeChunk(block)
    });
    chunkIndex += 1;
  }

  return chunks;
}

module.exports = {
  chunkFile
};
