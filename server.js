const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { db, brandDir, docsDir, hashPassword, verifyPassword, createUser, createProperty } = require('./db');
const mailer = require('./mailer');
const { STAGES, PHASES, STATUSES, PROPERTY_FIELDS, VENDOR_FIELDS, KINDS, label } = require('./kinds');

const app = express();
const PROD = process.env.NODE_ENV === 'production';
const BRAND = process.env.BRAND_NAME || 'Manuel Sanchez | SERHANT.';
const DEFAULT_COLOR = '#121275';
const TIME_ZONE = process.env.TIME_ZONE || 'America/Los_Angeles';
const SESSION_DAYS = 30;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1h' : 0 }));
app.use('/brand', express.static(brandDir, { maxAge: '1h' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

// ---------- site settings (branding) & uploads ----------
const getSettings = () => Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value || null);
const validColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : null);
// Dark or white text, whichever reads better on the given background color.
function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1c2a2e' : '#ffffff';
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const DOC_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt']);
const INLINE_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_DOC_MB = 25;
const extOf = (name) => path.extname(name || '').toLowerCase();
const uploader = (dir, exts, maxMB) =>
  multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + extOf(file.originalname)),
    }),
    limits: { fileSize: maxMB * 1048576, files: 10 },
    fileFilter: (req, file, cb) => cb(null, exts.has(extOf(file.originalname))),
  });
// Runs an upload and, if it fails, sends the agent back with a readable message.
const withUpload = (mw, back) => (req, res, next) =>
  mw(req, res, (err) => {
    if (!err) return next();
    flash(req, err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large.' : 'The upload did not work. Please try again.');
    res.redirect(back(req));
  });
const removeFile = (dir, name) => { if (name) fs.rm(path.join(dir, path.basename(name)), { force: true }, () => {}); };

// ---------- formatting helpers (also available in every view) ----------
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
const toUTC = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
const helpers = {
  money: (n) => (n == null || n === '' ? '' : '$' + Math.round(Number(n)).toLocaleString('en-US')),
  fdate: (d) => {
    if (!d) return '';
    return new Date(toUTC(d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  },
  fday: (d) => (d ? new Date(toUTC(d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' }) : ''),
  ftime: (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  },
  daysBetween: (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000),
  label,
};

// ---------- email alerts ----------
const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const agents = () => db.prepare("SELECT name, email FROM users WHERE role = 'agent'").all();
const lastSent = new Map(); // throttle key -> time of last email
function throttled(key, minutes) {
  const now = Date.now();
  if ((lastSent.get(key) || 0) > now - minutes * 60000) return true;
  lastSent.set(key, now);
  return false;
}
// Sends in the background; a mail problem never breaks the page.
function sendMail(res, mail) {
  mailer
    .send({ fromName: res.locals.brand, color: res.locals.theme.primary || DEFAULT_COLOR, ...mail })
    .catch((err) => console.error('Email could not be sent:', err.message));
}
const logActivity = (propertyId, userId, kind) =>
  db.prepare('INSERT INTO activity (property_id, user_id, kind) VALUES (?,?,?)').run(propertyId, userId, kind);

// ---------- sessions ----------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?,?,?)').run(sha(token), userId, expires);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: SESSION_DAYS * 86400000 });
}

app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
  // Reject cross-site form posts.
  if (req.method === 'POST' && req.headers.origin) {
    let originHost = '';
    try { originHost = new URL(req.headers.origin).host; } catch { /* malformed */ }
    if (originHost !== req.headers.host) return res.status(403).send('Forbidden');
  }
  const token = readCookie(req, 'sid');
  if (token) {
    const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha(token));
    if (s && s.expires > Date.now()) {
      req.user = db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(s.user_id);
      req.sessionKey = s.token_hash;
      if (s.flash && req.method === 'GET') {
        res.locals.flash = s.flash;
        db.prepare('UPDATE sessions SET flash = NULL WHERE token_hash = ?').run(s.token_hash);
      }
    }
  }
  const site = getSettings();
  const primary = validColor(site.color_primary), accent = validColor(site.color_accent);
  Object.assign(res.locals, helpers, {
    user: req.user, site, brand: site.brand_name || BRAND, today: today(), error: null, STAGES, PHASES, STATUSES,
    theme: { primary, accent, ink: primary ? inkFor(primary) : null, defaultColor: DEFAULT_COLOR },
    hasVendors: !!req.user && !!db.prepare('SELECT 1 FROM vendors').get(),
  });
  next();
});

const flash = (req, msg) => {
  if (req.sessionKey) db.prepare('UPDATE sessions SET flash = ? WHERE token_hash = ?').run(msg, req.sessionKey);
};
const agentExists = () => !!db.prepare("SELECT 1 FROM users WHERE role = 'agent'").get();
const home = (user) => (user.role === 'agent' ? '/admin' : '/portal');
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function requireUser(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}
function requireAgent(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'agent') return res.status(403).render('message', { title: 'Not available', message: 'This page is for your agent only.' });
  next();
}

// ---------- sign in / first-time setup ----------
app.get('/', (req, res) => res.redirect(req.user ? home(req.user) : agentExists() ? '/login' : '/setup'));

app.get('/setup', (req, res) => {
  if (agentExists()) return res.redirect('/login');
  res.render('setup', { form: {} });
});

app.post('/setup', (req, res) => {
  if (agentExists()) return res.redirect('/login');
  const name = String(req.body.name || '').trim();
  const email = cleanEmail(req.body.email);
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  const fail = (error) => res.status(400).render('setup', { error, form: { name, email, phone } });
  if (!name || !validEmail(email)) return fail('Please enter your name and a valid email.');
  if (password.length < 8) return fail('Choose a password with at least 8 characters.');
  const id = createUser({ name, email, phone, password, role: 'agent' });
  startSession(res, id);
  res.redirect('/admin');
});

const attempts = new Map(); // key -> { count, resetAt }
function tooManyAttempts(key) {
  const a = attempts.get(key);
  if (!a || a.resetAt < Date.now()) return false;
  return a.count >= 8;
}
function recordFailure(key) {
  const a = attempts.get(key);
  if (!a || a.resetAt < Date.now()) attempts.set(key, { count: 1, resetAt: Date.now() + 15 * 60000 });
  else a.count++;
}

app.get('/login', (req, res) => {
  if (req.user) return res.redirect(home(req.user));
  if (!agentExists()) return res.redirect('/setup');
  res.render('login', { email: '' });
});

app.post('/login', (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  const key = `${req.ip}|${email}`;
  if (tooManyAttempts(key)) {
    return res.status(429).render('login', { email, error: 'Too many attempts. Please wait 15 minutes and try again.' });
  }
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !verifyPassword(password, u.password_hash)) {
    recordFailure(key);
    return res.status(401).render('login', { email, error: 'That email and password do not match. Please try again.' });
  }
  attempts.delete(key);
  startSession(res, u.id);
  res.redirect(home(u));
});

app.post('/logout', (req, res) => {
  if (req.sessionKey) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionKey);
  res.clearCookie('sid');
  res.redirect('/login');
});

// ---------- account ----------
app.get('/account', requireUser, (req, res) => res.render('account'));

app.post('/account', requireUser, (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.password || '');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (next) {
    if (!verifyPassword(current, row.password_hash)) return res.status(400).render('account', { error: 'Your current password is not correct.' });
    if (next.length < 8) return res.status(400).render('account', { error: 'Choose a new password with at least 8 characters.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
    // Sign out every other device.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionKey);
  }
  flash(req, next ? 'Your password has been changed.' : 'Nothing was changed.');
  res.redirect('/account');
});

// ---------- client portal ----------
app.get('/portal', requireUser, (req, res) => {
  if (req.user.role === 'agent') return res.redirect('/admin');
  const props = db
    .prepare('SELECT p.* FROM properties p JOIN property_clients pc ON pc.property_id = p.id WHERE pc.user_id = ? ORDER BY p.id DESC')
    .all(req.user.id);
  if (props.length === 1) return res.redirect(`/p/${props[0].id}`);
  res.render('portal', { props });
});

// The sale in the URL, but only if this person is allowed to see it.
function accessibleProperty(req) {
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  const allowed =
    p && (req.user.role === 'agent' || db.prepare('SELECT 1 FROM property_clients WHERE property_id = ? AND user_id = ?').get(p.id, req.user.id));
  return allowed ? p : null;
}
const unreadCount = (propertyId, userId) =>
  db.prepare(
    `SELECT count(*) AS n FROM messages WHERE property_id = ? AND user_id != ?
     AND id > coalesce((SELECT last_id FROM message_reads WHERE property_id = ? AND user_id = ?), 0)`
  ).get(propertyId, userId, propertyId, userId).n;
const listDocuments = (propertyId) => db.prepare('SELECT * FROM documents WHERE property_id = ? ORDER BY id DESC').all(propertyId);

app.get('/p/:id', requireUser, (req, res) => {
  const p = accessibleProperty(req);
  if (!p) return res.status(404).render('message', { title: 'Not found', message: 'We could not find that page.' });

  // Remember client visits (once a day) and tell the agent when a past client comes back after closing.
  if (req.user.role === 'client') {
    const seenToday = db
      .prepare("SELECT 1 FROM activity WHERE property_id = ? AND user_id = ? AND kind = 'visit' AND created_at >= datetime('now', '-1 day')")
      .get(p.id, req.user.id);
    if (!seenToday) {
      logActivity(p.id, req.user.id, 'visit');
      if (p.stage === 'closed') {
        for (const a of agents()) {
          sendMail(res, {
            to: a.email, replyTo: req.user.email,
            subject: `${req.user.name} came back to their portal`,
            lines: [`${req.user.name} just opened their portal for ${p.address}, which has already closed.`, 'It may be a good moment to check in with them.'],
            link: `${baseUrl(req)}/admin/p/${p.id}`, linkLabel: 'Open this sale',
          });
        }
      }
    }
  }

  const rows = {};
  for (const [kind, def] of Object.entries(KINDS)) {
    rows[kind] = db.prepare(`SELECT * FROM ${def.table} WHERE property_id = ? ORDER BY ${def.order}`).all(p.id);
  }
  const t = today();
  const domEnd = p.escrow_opened || (p.stage === 'closed' && p.closing_date) || t;
  const stats = {
    daysOnMarket: p.list_date && p.list_date <= t ? Math.max(0, helpers.daysBetween(p.list_date, domEnd < t ? domEnd : t)) : null,
    showings: rows.showings.length,
    feedback: rows.showings.filter((s) => s.feedback).length,
    openHouses: rows.openhouses.filter((o) => o.date <= t).length,
    guests: rows.openhouses.reduce((n, o) => n + (o.guests || 0), 0),
    offers: rows.offers.length,
    daysToClose: p.closing_date && p.stage !== 'closed' ? helpers.daysBetween(t, p.closing_date) : null,
  };
  const done = rows.milestones.filter((m) => m.status === 'done').length;
  res.render('property', {
    p, rows, stats,
    progress: { done, total: rows.milestones.length },
    nextUp: rows.milestones.filter((m) => m.status !== 'done').slice(0, 3),
    agent: db.prepare("SELECT name, email, phone FROM users WHERE role = 'agent' ORDER BY id LIMIT 1").get(),
    stageIndex: Math.max(0, STAGES.findIndex((s) => s[0] === p.stage)),
    documents: listDocuments(p.id),
    unread: unreadCount(p.id, req.user.id),
  });
});

// Home value report: note that the client looked, alert the agent, then send them on to the report.
app.get('/p/:id/value', requireUser, (req, res) => {
  const p = accessibleProperty(req);
  if (!p || !p.value_url) return res.status(404).render('message', { title: 'Not found', message: 'We could not find that page.' });
  if (req.user.role === 'client') {
    logActivity(p.id, req.user.id, 'value');
    if (!throttled(`value|${p.id}|${req.user.id}`, 60)) {
      for (const a of agents()) {
        sendMail(res, {
          to: a.email, replyTo: req.user.email,
          subject: `${req.user.name} just checked their home value`,
          lines: [
            `${req.user.name} just opened the home value report for ${p.address}` +
              (p.stage === 'closed' ? `, which closed${p.closing_date ? ' on ' + helpers.fdate(p.closing_date) : ''}.` : ` (currently: ${label(STAGES, p.stage).toLowerCase()}).`),
            'They may be thinking about their next move — a good time to reach out.',
          ],
          link: `${baseUrl(req)}/admin/p/${p.id}`, linkLabel: 'Open this sale',
        });
      }
    }
  }
  res.redirect(p.value_url);
});

// Documents: only people with access to the sale can open them.
app.get('/p/:id/docs/:docId', requireUser, (req, res) => {
  const p = accessibleProperty(req);
  const d = p && db.prepare('SELECT * FROM documents WHERE id = ? AND property_id = ?').get(req.params.docId, p.id);
  if (!d) return res.status(404).render('message', { title: 'Not found', message: 'We could not find that document.' });
  const ext = extOf(d.filename);
  res.type(ext || 'application/octet-stream');
  res.set('Content-Disposition', `${INLINE_EXT.has(ext) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.original_name)}`);
  res.sendFile(path.join(docsDir, path.basename(d.filename)));
});

// Chat: one conversation per sale between the agent and the clients on it.
app.get('/p/:id/messages', requireUser, (req, res) => {
  const p = accessibleProperty(req);
  if (!p) return res.status(404).json({ error: 'not found' });
  const after = Number(req.query.after) || 0;
  const messages = db
    .prepare(
      `SELECT m.id, m.body, m.created_at, m.user_id, u.name FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.property_id = ? AND m.id > ? ORDER BY m.id`
    )
    .all(p.id, after)
    .map((m) => ({ id: m.id, body: m.body, name: m.name, mine: m.user_id === req.user.id, at: m.created_at.replace(' ', 'T') + 'Z' }));
  const newest = db.prepare('SELECT coalesce(max(id), 0) AS id FROM messages WHERE property_id = ?').get(p.id).id;
  db.prepare(
    'INSERT INTO message_reads (property_id, user_id, last_id) VALUES (?,?,?) ON CONFLICT(property_id, user_id) DO UPDATE SET last_id = excluded.last_id'
  ).run(p.id, req.user.id, newest);
  res.json({ messages });
});

app.post('/p/:id/messages', requireUser, (req, res) => {
  const p = accessibleProperty(req);
  if (!p) return res.status(404).json({ error: 'not found' });
  const body = String(req.body.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'empty' });
  db.prepare('INSERT INTO messages (property_id, user_id, body) VALUES (?,?,?)').run(p.id, req.user.id, body);

  // Email the other side. At most one email every 2 minutes per person, so a burst of messages is one alert.
  const fromClient = req.user.role === 'client';
  const recipients = fromClient
    ? agents()
    : db.prepare('SELECT u.name, u.email FROM users u JOIN property_clients pc ON pc.user_id = u.id WHERE pc.property_id = ?').all(p.id);
  for (const r of recipients) {
    if (throttled(`msg|${p.id}|${r.email}`, 2)) continue;
    sendMail(res, {
      to: r.email, replyTo: req.user.email,
      subject: `New message from ${req.user.name} about ${p.address}`,
      lines: [`${req.user.name} sent you a message about ${p.address}:`],
      quote: body,
      link: fromClient ? `${baseUrl(req)}/admin/p/${p.id}#messages` : `${baseUrl(req)}/p/${p.id}#chat`,
      linkLabel: 'Reply in the portal',
    });
  }
  res.json({ ok: true });
});

// Trusted pros, visible to every signed-in client.
const listVendors = () => db.prepare('SELECT * FROM vendors ORDER BY category COLLATE NOCASE, name COLLATE NOCASE').all();
app.get('/vendors', requireUser, (req, res) => {
  const home = db.prepare('SELECT property_id AS id FROM property_clients WHERE user_id = ? LIMIT 1').get(req.user.id);
  res.render('vendors', { vendors: listVendors(), agent: db.prepare("SELECT name FROM users WHERE role = 'agent' ORDER BY id LIMIT 1").get(), back: home ? `/p/${home.id}` : '/' });
});

// ---------- agent admin ----------
app.get('/admin', requireAgent, (req, res) => {
  const props = db
    .prepare(
      `SELECT p.*,
        (SELECT group_concat(u.name, ', ') FROM property_clients pc JOIN users u ON u.id = pc.user_id WHERE pc.property_id = p.id) AS clients,
        (SELECT count(*) FROM milestones m WHERE m.property_id = p.id AND m.status = 'done') AS done,
        (SELECT count(*) FROM milestones m WHERE m.property_id = p.id) AS total,
        (SELECT count(*) FROM messages g WHERE g.property_id = p.id AND g.user_id != @me
           AND g.id > coalesce((SELECT last_id FROM message_reads r WHERE r.property_id = p.id AND r.user_id = @me), 0)) AS unread
       FROM properties p ORDER BY (p.stage = 'closed'), p.id DESC`
    )
    .all({ me: req.user.id });
  const clients = db
    .prepare(
      `SELECT u.id, u.name, u.email,
        (SELECT group_concat(p.address, '; ') FROM property_clients pc JOIN properties p ON p.id = pc.property_id WHERE pc.user_id = u.id) AS homes
       FROM users u WHERE u.role = 'client' ORDER BY u.name`
    )
    .all();
  res.render('admin/home', { props, clients });
});

app.post('/admin/properties', requireAgent, (req, res) => {
  const address = String(req.body.address || '').trim();
  if (!address) return res.redirect('/admin');
  const id = createProperty(address, String(req.body.city || '').trim());
  flash(req, 'Sale created with the standard milestone checklist. Fill in the details and give your client access below.');
  res.redirect(`/admin/p/${id}`);
});

// Validate and normalize submitted values against a field list.
function readFields(fields, body) {
  const out = {};
  for (const f of fields) {
    let v = String(body[f.name] ?? '').trim();
    if (f.type === 'number' || f.type === 'money') {
      v = v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
    } else if (f.type === 'date') {
      v = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    } else if (f.type === 'time') {
      v = /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : null;
    } else if (f.type === 'select') {
      const allowed = f.options.map((o) => (Array.isArray(o) ? o[0] : o));
      if (!allowed.includes(v)) v = allowed[0];
    } else if (f.type === 'url') {
      v = /^https?:\/\//i.test(v) ? v.slice(0, 500) : null;
    } else {
      v = v.slice(0, 4000) || null;
    }
    if (f.required && (v == null || v === '')) return null;
    out[f.name] = v;
  }
  return out;
}

function loadProperty(req, res, next) {
  req.property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.pid);
  if (!req.property) return res.status(404).render('message', { title: 'Not found', message: 'That sale no longer exists.' });
  next();
}

app.get('/admin/p/:pid', requireAgent, loadProperty, (req, res) => {
  const p = req.property;
  const rows = {};
  for (const [kind, def] of Object.entries(KINDS)) {
    rows[kind] = db.prepare(`SELECT * FROM ${def.table} WHERE property_id = ? ORDER BY ${def.order}`).all(p.id);
  }
  const linked = db
    .prepare('SELECT u.id, u.name, u.email FROM users u JOIN property_clients pc ON pc.user_id = u.id WHERE pc.property_id = ? ORDER BY u.name')
    .all(p.id);
  const others = db
    .prepare("SELECT id, name, email FROM users WHERE role = 'client' AND id NOT IN (SELECT user_id FROM property_clients WHERE property_id = ?) ORDER BY name")
    .all(p.id);
  const activity = db
    .prepare('SELECT a.kind, a.created_at, u.name FROM activity a JOIN users u ON u.id = a.user_id WHERE a.property_id = ? ORDER BY a.id DESC LIMIT 8')
    .all(p.id);
  res.render('admin/property', { p, rows, linked, others, activity, KINDS, PROPERTY_FIELDS, helpers, documents: listDocuments(p.id), maxDocMB: MAX_DOC_MB });
});

app.post('/admin/p/:pid', requireAgent, loadProperty, (req, res) => {
  const v = readFields(PROPERTY_FIELDS, req.body);
  if (!v) { flash(req, 'The street address is required.'); return res.redirect(`/admin/p/${req.property.id}`); }
  const cols = Object.keys(v);
  db.prepare(`UPDATE properties SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => v[c]), req.property.id);
  flash(req, 'Sale details saved.');
  res.redirect(`/admin/p/${req.property.id}`);
});

app.post('/admin/p/:pid/delete', requireAgent, loadProperty, (req, res) => {
  listDocuments(req.property.id).forEach((d) => removeFile(docsDir, d.filename));
  db.prepare('DELETE FROM properties WHERE id = ?').run(req.property.id);
  flash(req, `Deleted ${req.property.address}.`);
  res.redirect('/admin');
});

// Give a client access: either link an existing login or create a new one.
app.post('/admin/p/:pid/clients', requireAgent, loadProperty, (req, res) => {
  const back = `/admin/p/${req.property.id}#access`;
  let userId = Number(req.body.user_id) || null;
  if (userId) {
    if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'client'").get(userId)) return res.redirect(back);
  } else {
    const name = String(req.body.name || '').trim();
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!name || !validEmail(email)) { flash(req, 'Enter the client’s name and a valid email.'); return res.redirect(back); }
    if (password.length < 8) { flash(req, 'The password needs at least 8 characters.'); return res.redirect(back); }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      flash(req, `${email} already has a login. Pick them from the “existing client” list instead.`);
      return res.redirect(back);
    }
    userId = createUser({ name, email, password, role: 'client' });
    flash(req, `Login created for ${name}. Send them this page’s web address, their email (${email}) and the password you just set. It is not shown again.`);
  }
  db.prepare('INSERT OR IGNORE INTO property_clients (property_id, user_id) VALUES (?,?)').run(req.property.id, userId);
  res.redirect(back);
});

app.post('/admin/p/:pid/clients/:uid/remove', requireAgent, loadProperty, (req, res) => {
  db.prepare('DELETE FROM property_clients WHERE property_id = ? AND user_id = ?').run(req.property.id, req.params.uid);
  res.redirect(`/admin/p/${req.property.id}#access`);
});

app.post('/admin/p/:pid/milestones/:id/toggle', requireAgent, loadProperty, (req, res) => {
  const m = db.prepare('SELECT * FROM milestones WHERE id = ? AND property_id = ?').get(req.params.id, req.property.id);
  if (m) {
    if (m.status === 'done') db.prepare("UPDATE milestones SET status = 'pending', done_date = NULL WHERE id = ?").run(m.id);
    else db.prepare("UPDATE milestones SET status = 'done', done_date = ? WHERE id = ?").run(today(), m.id);
  }
  res.redirect(`/admin/p/${req.property.id}#m${req.params.id}`);
});

// Documents for the client (contracts, reports, closing statement, ...).
app.post(
  '/admin/p/:pid/documents', requireAgent, loadProperty,
  withUpload(uploader(docsDir, DOC_EXT, MAX_DOC_MB).array('files', 10), (req) => `/admin/p/${req.params.pid}#documents`),
  (req, res) => {
    const files = req.files || [];
    const title = String(req.body.title || '').trim().slice(0, 200);
    const ins = db.prepare('INSERT INTO documents (property_id, title, filename, original_name, size) VALUES (?,?,?,?,?)');
    for (const f of files) {
      const original = Buffer.from(f.originalname, 'latin1').toString('utf8');
      ins.run(req.property.id, files.length === 1 && title ? title : path.parse(original).name, f.filename, original, f.size);
    }
    flash(req, files.length ? `${files.length} document${files.length === 1 ? '' : 's'} uploaded.` : 'Nothing was uploaded. Use PDF, image, Word or Excel files.');
    res.redirect(`/admin/p/${req.property.id}#documents`);
  }
);

app.post('/admin/p/:pid/documents/:id/delete', requireAgent, loadProperty, (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id = ? AND property_id = ?').get(req.params.id, req.property.id);
  if (d) {
    db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
    removeFile(docsDir, d.filename);
  }
  res.redirect(`/admin/p/${req.property.id}#documents`);
});

// Generic add / edit / delete for everything that hangs off a sale.
function loadKind(req, res, next) {
  req.kind = Object.hasOwn(KINDS, req.params.kind) ? KINDS[req.params.kind] : null;
  if (!req.kind) return res.status(404).send('Not found');
  next();
}

app.post('/admin/p/:pid/:kind', requireAgent, loadProperty, loadKind, (req, res) => {
  const back = `/admin/p/${req.property.id}#${req.params.kind}`;
  const v = readFields(req.kind.fields, req.body);
  if (!v) { flash(req, 'Please fill in the required fields.'); return res.redirect(back); }
  if (req.params.kind === 'milestones' && v.sort == null) {
    v.sort = db.prepare('SELECT coalesce(max(sort), 0) + 10 AS s FROM milestones WHERE property_id = ? AND phase = ?').get(req.property.id, v.phase).s;
  }
  if ('sort' in v && v.sort == null) v.sort = 0;
  const cols = Object.keys(v);
  db.prepare(`INSERT INTO ${req.kind.table} (property_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(
    req.property.id, ...cols.map((c) => v[c])
  );
  res.redirect(back);
});

app.post('/admin/p/:pid/:kind/:id', requireAgent, loadProperty, loadKind, (req, res) => {
  const back = `/admin/p/${req.property.id}#${req.params.kind}`;
  const v = readFields(req.kind.fields, req.body);
  if (!v) { flash(req, 'Please fill in the required fields.'); return res.redirect(back); }
  if ('sort' in v && v.sort == null) v.sort = 0;
  if (req.params.kind === 'milestones' && v.status === 'done' && !v.done_date) v.done_date = today();
  const cols = Object.keys(v);
  db.prepare(`UPDATE ${req.kind.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND property_id = ?`).run(
    ...cols.map((c) => v[c]), req.params.id, req.property.id
  );
  res.redirect(back);
});

app.post('/admin/p/:pid/:kind/:id/delete', requireAgent, loadProperty, loadKind, (req, res) => {
  db.prepare(`DELETE FROM ${req.kind.table} WHERE id = ? AND property_id = ?`).run(req.params.id, req.property.id);
  res.redirect(`/admin/p/${req.property.id}#${req.params.kind}`);
});

// Trusted pros
app.get('/admin/vendors', requireAgent, (req, res) => res.render('admin/vendors', { vendors: listVendors(), VENDOR_FIELDS }));

app.post('/admin/vendors', requireAgent, (req, res) => {
  const v = readFields(VENDOR_FIELDS, req.body);
  if (!v) flash(req, 'Please fill in the type of service and the name.');
  else {
    const cols = Object.keys(v);
    db.prepare(`INSERT INTO vendors (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => v[c]));
  }
  res.redirect('/admin/vendors');
});

app.post('/admin/vendors/:id', requireAgent, (req, res) => {
  const v = readFields(VENDOR_FIELDS, req.body);
  if (!v) flash(req, 'Please fill in the type of service and the name.');
  else {
    const cols = Object.keys(v);
    db.prepare(`UPDATE vendors SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => v[c]), req.params.id);
  }
  res.redirect('/admin/vendors');
});

app.post('/admin/vendors/:id/delete', requireAgent, (req, res) => {
  db.prepare('DELETE FROM vendors WHERE id = ?').run(req.params.id);
  res.redirect('/admin/vendors');
});

// Branding & agent profile
app.get('/admin/settings', requireAgent, (req, res) => res.render('admin/settings', { mailReady: mailer.ready() }));

app.post('/admin/settings/test-email', requireAgent, async (req, res) => {
  try {
    const sent = await mailer.send({
      fromName: res.locals.brand, color: res.locals.theme.primary || DEFAULT_COLOR,
      to: req.user.email, subject: 'Test email from your client portal',
      lines: ['This is a test. Email alerts from your client portal are working.'],
      link: `${baseUrl(req)}/admin`, linkLabel: 'Open the portal',
    });
    flash(req, sent ? `Test email sent to ${req.user.email}. Check your inbox (and spam folder).` : 'Email is not set up yet.');
  } catch (err) {
    flash(req, `The test email could not be sent: ${err.message}`);
  }
  res.redirect('/admin/settings#email');
});

app.post(
  '/admin/settings', requireAgent,
  withUpload(uploader(brandDir, IMAGE_EXT, 5).fields([{ name: 'logo', maxCount: 1 }, { name: 'headshot', maxCount: 1 }]), () => '/admin/settings'),
  (req, res) => {
    const b = req.body, old = getSettings();
    const text = (k, max) => String(b[k] || '').trim().slice(0, max);
    setSetting('brand_name', text('brand_name', 80));
    setSetting('color_primary', validColor(b.color_primary));
    setSetting('color_accent', validColor(b.color_accent));
    setSetting('title', text('title', 120));
    setSetting('license', text('license', 60));
    setSetting('website', /^https?:\/\//i.test(text('website', 300)) ? text('website', 300) : '');
    setSetting('about', text('about', 3000));
    for (const key of ['logo', 'headshot']) {
      const file = req.files && req.files[key] && req.files[key][0];
      if (file || b[`remove_${key}`]) {
        removeFile(brandDir, old[key]);
        setSetting(key, file ? file.filename : '');
      }
    }
    const name = text('name', 120);
    if (name) db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, text('phone', 40), req.user.id);
    flash(req, 'Branding saved.');
    res.redirect('/admin/settings');
  }
);

// Client logins
app.get('/admin/clients/:uid', requireAgent, (req, res) => {
  const c = db.prepare("SELECT id, name, email FROM users WHERE id = ? AND role = 'client'").get(req.params.uid);
  if (!c) return res.redirect('/admin');
  res.render('admin/client', { c });
});

app.post('/admin/clients/:uid', requireAgent, (req, res) => {
  const c = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'client'").get(req.params.uid);
  if (!c) return res.redirect('/admin');
  const back = `/admin/clients/${c.id}`;
  const name = String(req.body.name || '').trim();
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!name || !validEmail(email)) { flash(req, 'Enter a name and a valid email.'); return res.redirect(back); }
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, c.id)) { flash(req, 'Another login already uses that email.'); return res.redirect(back); }
  if (password && password.length < 8) { flash(req, 'The password needs at least 8 characters.'); return res.redirect(back); }
  db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email, c.id);
  if (password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), c.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(c.id);
  }
  flash(req, password ? 'Saved. Share the new password with your client.' : 'Saved.');
  res.redirect(back);
});

app.post('/admin/clients/:uid/delete', requireAgent, (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ? AND role = 'client'").run(req.params.uid);
  flash(req, 'Client login deleted.');
  res.redirect('/admin');
});

app.use((req, res) => res.status(404).render('message', { title: 'Not found', message: 'We could not find that page.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).send('Something went wrong. Please try again.');
});

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600000).unref();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`${BRAND} client portal running on port ${port}`));
