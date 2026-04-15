PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  repo_root TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  hash TEXT NOT NULL,
  last_modified INTEGER NOT NULL,
  language TEXT,
  summary TEXT,
  UNIQUE(project_id, relative_path)
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  chunk_index INTEGER,
  start_line INTEGER,
  end_line INTEGER,
  content TEXT,
  summary TEXT,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  name TEXT,
  type TEXT,
  signature TEXT,
  summary TEXT,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dependencies (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_file_id INTEGER,
  to_file_id INTEGER,
  relation_type TEXT,
  FOREIGN KEY(from_file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY(to_file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_files_relative_path ON files(project_id, relative_path);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_chunks_project_file ON chunks(project_id, file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_project ON symbols(project_id);
CREATE INDEX IF NOT EXISTS idx_symbols_project_name ON symbols(project_id, name);
CREATE INDEX IF NOT EXISTS idx_dependencies_project ON dependencies(project_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_from_file ON dependencies(from_file_id);
