const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function resolveDatabasePath(baseDir, databasePath) {
  if (path.isAbsolute(databasePath)) {
    return databasePath;
  }
  return path.resolve(baseDir, databasePath);
}

function ensureParentDir(filePath) {
  const parentDir = path.dirname(filePath);
  fs.mkdirSync(parentDir, { recursive: true });
}

function initializeDatabase(databasePath, schemaPath) {
  ensureParentDir(databasePath);

  const db = new Database(databasePath);

  // Keep WAL + FK enabled for safe local incremental updates.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  db.exec(schemaSql);

  return db;
}

function withTransaction(db, fn) {
  const tx = db.transaction(fn);
  return (...args) => tx(...args);
}

function createDb(config, options = {}) {
  const baseDir = options.baseDir || path.resolve(__dirname, "..");
  const schemaPath = options.schemaPath || path.resolve(__dirname, "schema.sql");
  const databasePath = resolveDatabasePath(baseDir, config.databasePath);
  const db = initializeDatabase(databasePath, schemaPath);

  return {
    db,
    databasePath,
    close: () => db.close(),
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    transaction: (fn) => withTransaction(db, fn)
  };
}

module.exports = {
  createDb,
  initializeDatabase,
  resolveDatabasePath,
  withTransaction
};
