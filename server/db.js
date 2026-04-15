// SQLite connection for search-surface.
// Dedicated DB file (search.db), unrelated to prism-surface's surface.db.
// Seed from prism-surface for migration:
//   sqlite3 /path/to/surface.db ".dump search_%" | sqlite3 ./search.db

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'search.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = { db, DB_PATH };
