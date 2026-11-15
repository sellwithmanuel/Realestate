const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { DEFAULT_MILESTONES, DEFAULT_MILESTONES_BUYER } = require('./kinds');

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
db.exec(`
CREATE TABLE IF NOT EXISTS followup_log (
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  emailed_at TEXT, done_at TEXT,
  PRIMARY KEY (property_id, key)
);
`);
const hasColumn = (name, table = 'properties') => !!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, name);
const addColumn = (name, type, table = 'properties') => { if (!hasColumn(name, table)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`); };
addColumn('value_url', 'TEXT');
if (!hasColumn('zip')) {
  db.exec('ALTER TABLE properties ADD COLUMN zip TEXT');
  // ZIP used to be typed into the city line; move it into its own field.
  for (const p of db.prepare('SELECT id, city FROM properties').all()) {
    const m = /^(.*?)[,\s]*\b(\d{5})(-\d{4})?\s*$/.exec(p.city || '');
    if (m) db.prepare('UPDATE properties SET city = ?, zip = ? WHERE id = ?').run(m[1].trim() || null, m[2], p.id);
  }
}
addColumn('side', "TEXT NOT NULL DEFAULT 'seller'");
addColumn('client_name', 'TEXT');
addColumn('client_phone', 'TEXT');
addColumn('client_email', 'TEXT');
addColumn('commission_pct', 'REAL');
addColumn('split_pct', 'REAL');
addColumn('referral_pct', 'REAL');
addColumn('commission_fees', 'REAL');

// Buyer portal
db.exec(`
CREATE TABLE IF NOT EXISTS offer_events (
  id INTEGER PRIMARY KEY,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, date TEXT, price REAL, terms TEXT
);
CREATE TABLE IF NOT EXISTS homes (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  address TEXT NOT NULL, city TEXT, price REAL, beds REAL, baths REAL, sqft INTEGER,
  url TEXT, photo TEXT, note TEXT,
  reaction TEXT, reacted_at TEXT, tour_requested_at TEXT, tour_date TEXT, tour_time TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  target TEXT NOT NULL, target_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addColumn('criteria', 'TEXT');
addColumn('emd_amount', 'REAL');
addColumn('preapproval_amount', 'REAL');
addColumn('company', 'TEXT', 'users');
addColumn('is_lender', 'INTEGER NOT NULL DEFAULT 0', 'users');
addColumn('access', "TEXT NOT NULL DEFAULT 'client'", 'property_clients');
addColumn('category', 'TEXT', 'documents');
addColumn('uploaded_by', 'INTEGER', 'documents');
addColumn('due_time', 'TEXT', 'milestones');
addColumn('vendor_contact', 'TEXT', 'milestones');
addColumn('alert', 'TEXT', 'milestones');
addColumn('reminded_for', 'TEXT', 'milestones');
addColumn('address', 'TEXT', 'offers');
addColumn('listing_agent', 'TEXT', 'offers');
addColumn('listing_agent_phone', 'TEXT', 'offers');
addColumn('listing_agent_email', 'TEXT', 'offers');

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

function createUser({ name, email, phone, password, role, company, isLender }) {
  const info = db
    .prepare('INSERT INTO users (name, email, phone, password_hash, role, company, is_lender) VALUES (?,?,?,?,?,?,?)')
    .run(name, email, phone || null, hashPassword(password), role, company || null, isLender ? 1 : 0);
  return info.lastInsertRowid;
}

const createProperty = db.transaction((address, city, zip, side) => {
  side = side === 'buyer' ? 'buyer' : 'seller';
  const id = db
    .prepare('INSERT INTO properties (address, city, zip, side) VALUES (?,?,?,?)')
    .run(address, city || null, zip || null, side).lastInsertRowid;
  const ins = db.prepare('INSERT INTO milestones (property_id, phase, title, paid_by, sort, alert, notes) VALUES (?,?,?,?,?,?,?)');
  (side === 'buyer' ? DEFAULT_MILESTONES_BUYER : DEFAULT_MILESTONES).forEach(([phase, title, paidBy, extra], i) =>
    ins.run(id, phase, title, paidBy, (i + 1) * 10, (extra && extra.alert) || '', (extra && extra.notes) || null)
  );
  return id;
});

module.exports = { db, brandDir, docsDir, hashPassword, verifyPassword, createUser, createProperty };
