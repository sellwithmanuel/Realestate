const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { DEFAULT_MILESTONES } = require('./kinds');

const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });

const db = new Database(path.join(dir, 'portal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('agent','client')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL,
  flash TEXT
);
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY,
  address TEXT NOT NULL,
  city TEXT,
  stage TEXT NOT NULL DEFAULT 'prep',
  list_price REAL,
  list_date TEXT,
  mls_number TEXT,
  listing_url TEXT,
  escrow_company TEXT,
  escrow_number TEXT,
  escrow_opened TEXT,
  closing_date TEXT,
  sale_price REAL,
  headline TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS property_clients (
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (property_id, user_id)
);
CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'escrow',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT, done_date TEXT,
  paid_by TEXT, cost REAL, vendor TEXT, notes TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS open_houses (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  date TEXT, start_time TEXT, end_time TEXT, guests INTEGER, notes TEXT
);
CREATE TABLE IF NOT EXISTS showings (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  date TEXT, buyer_agent TEXT, interest TEXT, feedback TEXT
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  received_date TEXT, buyer_name TEXT, buyer_agent TEXT, price REAL,
  status TEXT NOT NULL DEFAULT 'Received', financing TEXT, down_payment TEXT,
  deposit REAL, escrow_days INTEGER, credits TEXT, expires TEXT,
  contingencies TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  role TEXT, name TEXT, company TEXT, phone TEXT, email TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS updates (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  date TEXT, message TEXT
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY,
  category TEXT, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, website TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title TEXT NOT NULL, filename TEXT NOT NULL, original_name TEXT NOT NULL, size INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS message_reads (
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, user_id)
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// Columns added after the first release.
if (!db.prepare("SELECT 1 FROM pragma_table_info('properties') WHERE name = 'value_url'").get()) {
  db.exec('ALTER TABLE properties ADD COLUMN value_url TEXT');
}

const brandDir = path.join(dir, 'uploads', 'brand');
const docsDir = path.join(dir, 'uploads', 'docs');
fs.mkdirSync(brandDir, { recursive: true });
fs.mkdirSync(docsDir, { recursive: true });

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function createUser({ name, email, phone, password, role }) {
  const info = db
    .prepare('INSERT INTO users (name, email, phone, password_hash, role) VALUES (?,?,?,?,?)')
    .run(name, email, phone || null, hashPassword(password), role);
  return info.lastInsertRowid;
}

const createProperty = db.transaction((address, city) => {
  const id = db.prepare('INSERT INTO properties (address, city) VALUES (?,?)').run(address, city || null).lastInsertRowid;
  const ins = db.prepare('INSERT INTO milestones (property_id, phase, title, paid_by, sort) VALUES (?,?,?,?,?)');
  DEFAULT_MILESTONES.forEach(([phase, title, paidBy], i) => ins.run(id, phase, title, paidBy, (i + 1) * 10));
  return id;
});

module.exports = { db, brandDir, docsDir, hashPassword, verifyPassword, createUser, createProperty };
