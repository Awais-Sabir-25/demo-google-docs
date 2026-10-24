const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SEED_USERS = [
  { email: 'alice@ajaia.test', name: 'Alice Chen' },
  { email: 'bob@ajaia.test', name: 'Bob Okafor' },
  { email: 'carol@ajaia.test', name: 'Carol Diaz' },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS document_shares (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (document_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_shares_user ON document_shares(user_id);
`;

const WELCOME_DOC = `<h1>Welcome to Ajaia Docs</h1>
<p>This is a <strong>shared</strong> document owned by Alice. Try the toolbar: <em>italic</em>, <u>underline</u>, headings and lists.</p>
<ol><li data-list="bullet">Changes save automatically</li><li data-list="bullet">Owners can share with editors or viewers</li></ol>`;

function openDb(file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'ajaia.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

// Idempotent: creates the demo accounts, plus one sample shared doc on a fresh database.
function seed(db) {
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (email, name) VALUES (?, ?)');
  for (const u of SEED_USERS) insertUser.run(u.email, u.name);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM documents').get();
  if (n === 0) {
    const alice = db.prepare('SELECT id FROM users WHERE email = ?').get('alice@ajaia.test');
    const bob = db.prepare('SELECT id FROM users WHERE email = ?').get('bob@ajaia.test');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?)')
      .run(alice.id, 'Welcome to Ajaia Docs', WELCOME_DOC);
    db.prepare("INSERT INTO document_shares (document_id, user_id, role) VALUES (?, ?, 'editor')")
      .run(lastInsertRowid, bob.id);
  }
}

module.exports = { openDb, SEED_USERS };
