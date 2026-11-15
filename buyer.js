// Buyer portal: lender access, search criteria, shared homes, offers with
// counters, comments, and the reminders that go with them.
const path = require('path');
const { OFFER_EVENTS, label } = require('./kinds');

const HOME_FIELDS = [
  { name: 'address', label: 'Address', type: 'text', required: true, wide: true },
  { name: 'city', label: 'City / neighborhood', type: 'text' },
  { name: 'price', label: 'Price', type: 'money' },
  { name: 'beds', label: 'Beds', type: 'number' },
  { name: 'baths', label: 'Baths', type: 'number' },
  { name: 'sqft', label: 'Sq ft', type: 'number' },
  { name: 'url', label: 'Link to the listing', type: 'url', wide: true },
  { name: 'note', label: 'Your note about this home', type: 'textarea', wide: true },
];
const TOUR_FIELDS = [
  { name: 'tour_date', label: 'Tour date', type: 'date' },
  { name: 'tour_time', label: 'Tour time', type: 'time' },
];
const CRITERIA_TEXT = ['price_min', 'price_max', 'beds', 'baths', 'types', 'areas', 'zips', 'must', 'notes'];

module.exports = function buyerPortal(ctx) {
  const {
    app, db, helpers, today, addDays, flash, requireUser, requireAgent, loadProperty, accessibleProperty, readFields,
    agents, clientsOf, lendersOf, firstName, baseUrl, savedBase, sendMail, mailTo, throttled, mailer,
    uploader, withUpload, saveDocuments, removeFile, docsDir, extOf, IMAGE_EXT, DOC_EXT, MAX_DOC_MB,
    createUser, cleanEmail, validEmail,
  } = ctx;

  const notFound = (res) => res.status(404).render('message', { title: 'Not found', message: 'We could not find that page.' });
  const when = (date, time) => `${helpers.fday(date)}, ${helpers.fdate(date)}${time ? ' at ' + helpers.ftime(time) : ''}`;
  const buyerName = (p) => p.client_name || clientsOf(p.id).map((u) => u.name).join(' & ') || 'your buyer';
  const agentMail = (req, mail) => mailTo(agents(), { replyTo: req.user.email, ...mail });

  // ---------- data for the pages ----------
  const parseCriteria = (p) => { try { return JSON.parse(p.criteria) || {}; } catch { return {}; } };
  function commentsFor(propertyId) {
    const map = {};
    db.prepare(
      'SELECT c.*, u.name, u.role FROM comments c JOIN users u ON u.id = c.user_id WHERE c.property_id = ? ORDER BY c.id'
    ).all(propertyId).forEach((c) => (map[`${c.target}:${c.target_id}`] = map[`${c.target}:${c.target_id}`] || []).push(c));
    return map;
  }
  function eventsFor(propertyId) {
    const map = {};
    db.prepare(
      'SELECT e.* FROM offer_events e JOIN offers o ON o.id = e.offer_id WHERE o.property_id = ? ORDER BY e.date, e.id'
    ).all(propertyId).forEach((e) => (map[e.offer_id] = map[e.offer_id] || []).push({ ...e, label: label(OFFER_EVENTS, e.kind) }));
    return map;
  }
  function homesFor(propertyId, forBuyer) {
    const now = Date.now();
    return db
      .prepare("SELECT * FROM homes WHERE property_id = ? ORDER BY (reaction = 'like') DESC, id DESC")
      .all(propertyId)
      .map((h) => {
        const hoursLeft = h.reaction === 'dislike' ? 24 - (now - Date.parse(h.reacted_at.replace(' ', 'T') + 'Z')) / 3600000 : null;
        return { ...h, hoursLeft: hoursLeft == null ? null : Math.max(0, Math.ceil(hoursLeft)), gone: hoursLeft != null && hoursLeft <= 0 };
      })
      .filter((h) => !forBuyer || !h.gone);
  }
  const shared = (p) => ({
    criteria: parseCriteria(p),
    lenders: lendersOf(p.id),
    comments: commentsFor(p.id),
    eventsByOffer: eventsFor(p.id),
    preapprovals: db.prepare("SELECT * FROM documents WHERE property_id = ? AND category = 'preapproval' ORDER BY id DESC").all(p.id),
    emdDue: (db.prepare("SELECT due_date FROM milestones WHERE property_id = ? AND title LIKE 'Earnest money%' ORDER BY id LIMIT 1").get(p.id) || {}).due_date,
  });

  const pageData = (req, p) => ({ ...shared(p), homes: homesFor(p.id, p.access === 'client') });
  const adminData = (req, p) => ({
    ...shared(p), homes: homesFor(p.id, false), HOME_FIELDS, TOUR_FIELDS, OFFER_EVENTS,
    otherLenders: db
      .prepare("SELECT id, name, company FROM users WHERE is_lender = 1 AND id NOT IN (SELECT user_id FROM property_clients WHERE property_id = ?) ORDER BY name")
      .all(p.id),
  });

  // ---------- lender: a small page with only what they need ----------
  function lenderPage(req, res, p) {
    const s = shared(p);
    res.render('lender', {
      p, preapprovals: s.preapprovals, maxDocMB: MAX_DOC_MB,
      buyer: { name: buyerName(p), phone: p.client_phone || (clientsOf(p.id).find((u) => u.phone) || {}).phone, email: p.client_email || (clientsOf(p.id)[0] || {}).email },
      agent: db.prepare("SELECT name, email, phone FROM users WHERE role = 'agent' ORDER BY id LIMIT 1").get(),
      dates: db.prepare("SELECT title, due_date, status FROM milestones WHERE property_id = ? AND alert = 'both' AND due_date IS NOT NULL ORDER BY due_date").all(p.id),
      offers: db.prepare("SELECT * FROM offers WHERE property_id = ? AND status NOT IN ('Declined', 'Withdrawn', 'Expired') ORDER BY id DESC").all(p.id),
      stageLabel: label(ctx.stagesFor(p), p.stage),
    });
  }

  app.post(
    '/p/:id/preapproval', requireUser,
    (req, res, next) => {
      req.deal = accessibleProperty(req, true);
      if (!req.deal || !['lender', 'agent'].includes(req.deal.access)) return notFound(res);
      next();
    },
    withUpload(uploader(docsDir, DOC_EXT, MAX_DOC_MB).array('files', 10), (req) => `/p/${req.params.id}`),
    (req, res) => {
      const p = req.deal;
      const names = saveDocuments(req, p.id, 'preapproval');
      if (names.length && p.access === 'lender') {
        const mail = {
          subject: `Pre-approval uploaded for ${buyerName(p)}`,
          lines: [`${req.user.name} uploaded ${names.join(', ')} to the portal.`], replyTo: req.user.email,
        };
        agentMail(req, { ...mail, link: `${baseUrl(req)}/admin/p/${p.id}#lender`, linkLabel: 'Open this deal' });
        mailTo(clientsOf(p.id), { ...mail, link: `${baseUrl(req)}/p/${p.id}`, linkLabel: 'Open your portal' });
      }
      flash(req, names.length ? 'Uploaded. Thank you!' : 'Nothing was uploaded. Use PDF, image, Word or Excel files.');
      res.redirect(p.access === 'agent' ? `/admin/p/${p.id}#lender` : `/p/${p.id}`);
    }
  );

  app.post('/admin/p/:pid/lender', requireAgent, loadProperty, (req, res) => {
    const p = req.property, back = `/admin/p/${p.id}#lender`;
    let userId = Number(req.body.user_id) || null;
    if (userId) {
      if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND is_lender = 1').get(userId)) return res.redirect(back);
    } else {
      const name = String(req.body.name || '').trim(), email = cleanEmail(req.body.email), password = String(req.body.password || '');
      if (!name || !validEmail(email)) { flash(req, 'Enter the lender’s name and a valid email.'); return res.redirect(back); }
      if (password.length < 8) { flash(req, 'The password needs at least 8 characters.'); return res.redirect(back); }
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) { flash(req, `${email} already has a login. Pick them from the existing lenders list.`); return res.redirect(back); }
      userId = createUser({
        name, email, password, role: 'client', isLender: true,
        phone: String(req.body.phone || '').trim().slice(0, 40), company: String(req.body.company || '').trim().slice(0, 120),
      });
      flash(req, `Lender login created for ${name}. Send them the portal address, their email (${email}) and the password you just set.`);
    }
    db.prepare("INSERT OR IGNORE INTO property_clients (property_id, user_id, access) VALUES (?,?,'lender')").run(p.id, userId);
    res.redirect(back);
  });

  // ---------- search criteria: either side can change it, the other is told ----------
  app.post('/p/:id/criteria', requireUser, (req, res) => {
    const p = accessibleProperty(req);
    if (!p || p.side !== 'buyer') return notFound(res);
    const c = {};
    for (const k of CRITERIA_TEXT) c[k] = String(req.body[k] || '').trim().slice(0, k === 'notes' || k === 'must' ? 1500 : 300);
    c.zips = (c.zips.match(/\d{5}/g) || []).filter((z, i, a) => a.indexOf(z) === i).join(', ');
    c.shapes = null;
    try {
      const g = JSON.parse(String(req.body.shapes || 'null'));
      if (g && g.type === 'FeatureCollection' && Array.isArray(g.features) && JSON.stringify(g).length < 60000) c.shapes = g;
    } catch { /* ignore a malformed drawing */ }
    const changed = JSON.stringify(c) !== JSON.stringify(parseCriteria(p));
    db.prepare('UPDATE properties SET criteria = ? WHERE id = ?').run(JSON.stringify(c), p.id);
    if (changed) {
      const mail = { subject: `${firstName(req.user.name)} updated ${p.access === 'agent' ? 'your' : 'their'} search criteria`, replyTo: req.user.email };
      const summary = [
        (c.price_min || c.price_max) && `Price: ${helpers.money(c.price_min) || 'any'} – ${helpers.money(c.price_max) || 'any'}`,
        c.beds && `${c.beds}+ beds`, c.baths && `${c.baths}+ baths`, c.zips && `ZIP codes: ${c.zips}`, c.areas && `Areas: ${c.areas}`,
      ].filter(Boolean).join(' · ');
      if (p.access === 'agent') {
        mailTo(clientsOf(p.id), { ...mail, lines: [`${firstName(req.user.name)} updated your home search criteria.`, summary], link: `${baseUrl(req)}/p/${p.id}#criteria`, linkLabel: 'See your criteria' });
      } else {
        agentMail(req, { ...mail, lines: [`${req.user.name} updated their home search criteria.`, summary], link: `${baseUrl(req)}/admin/p/${p.id}#criteria`, linkLabel: 'Open this deal' });
      }
    }
    flash(req, 'Search criteria saved.');
    res.redirect(p.access === 'agent' && req.body.from === 'admin' ? `/admin/p/${p.id}#criteria` : `/p/${p.id}#criteria`);
  });

  // ---------- homes the agent shares ----------
  const homeOf = (p, id) => p && db.prepare('SELECT * FROM homes WHERE id = ? AND property_id = ?').get(id, p.id);
  const photoUpload = withUpload(uploader(docsDir, IMAGE_EXT, 10).single('photo'), (req) => `/admin/p/${req.params.pid}#homes`);

  app.post('/admin/p/:pid/homes', requireAgent, loadProperty, photoUpload, (req, res) => {
    const p = req.property, back = `/admin/p/${p.id}#homes`;
    const v = readFields(HOME_FIELDS, req.body);
    if (!v) { flash(req, 'The address is required.'); return res.redirect(back); }
    if (req.file) v.photo = req.file.filename;
    const cols = Object.keys(v);
    db.prepare(`INSERT INTO homes (property_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(p.id, ...cols.map((c) => v[c]));
    if (!throttled(`home|${p.id}`, 10)) {
      mailTo(clientsOf(p.id), {
        subject: `${firstName(req.user.name)} shared a home with you`, replyTo: req.user.email,
        lines: [`${v.address}${v.price ? ' — ' + helpers.money(v.price) : ''}`, 'Take a look and tell me what you think: like it, pass on it, or ask for a tour.'],
        link: `${baseUrl(req)}/p/${p.id}#homes`, linkLabel: 'See the home',
      });
    }
    res.redirect(back);
  });

  app.post('/admin/p/:pid/homes/:hid', requireAgent, loadProperty, photoUpload, (req, res) => {
    const p = req.property, h = homeOf(p, req.params.hid), back = `/admin/p/${p.id}#homes`;
    const v = h && readFields([...HOME_FIELDS, ...TOUR_FIELDS], req.body);
    if (!v) return res.redirect(back);
    if (req.file) { removeFile(docsDir, h.photo); v.photo = req.file.filename; }
    const cols = Object.keys(v);
    db.prepare(`UPDATE homes SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => v[c]), h.id);
    if (v.tour_date && (v.tour_date !== h.tour_date || v.tour_time !== h.tour_time)) {
      mailTo(clientsOf(p.id), {
        subject: `Tour scheduled: ${v.address}`, replyTo: req.user.email,
        lines: [`Your tour of ${v.address} is set for ${when(v.tour_date, v.tour_time)}.`],
        link: `${baseUrl(req)}/p/${p.id}#homes`, linkLabel: 'Open your portal',
      });
    }
    res.redirect(back);
  });

  app.post('/admin/p/:pid/homes/:hid/delete', requireAgent, loadProperty, (req, res) => {
    const h = homeOf(req.property, req.params.hid);
    if (h) {
      db.prepare('DELETE FROM homes WHERE id = ?').run(h.id);
      db.prepare("DELETE FROM comments WHERE target = 'home' AND target_id = ?").run(h.id);
      removeFile(docsDir, h.photo);
    }
    res.redirect(`/admin/p/${req.property.id}#homes`);
  });

  app.get('/p/:id/homes/:hid/photo', requireUser, (req, res) => {
    const h = homeOf(accessibleProperty(req), req.params.hid);
    if (!h || !h.photo) return res.status(404).end();
    res.type(extOf(h.photo));
    res.sendFile(path.join(docsDir, path.basename(h.photo)));
  });

  app.post('/p/:id/homes/:hid/react', requireUser, (req, res) => {
    const p = accessibleProperty(req), h = homeOf(p, req.params.hid);
    if (!h || p.access !== 'client') return notFound(res);
    const reaction = ['like', 'dislike'].includes(req.body.reaction) ? req.body.reaction : null;
    db.prepare("UPDATE homes SET reaction = ?, reacted_at = datetime('now') WHERE id = ?").run(reaction, h.id);
    if (reaction && reaction !== h.reaction && !throttled(`react|${h.id}|${reaction}`, 5)) {
      agentMail(req, {
        subject: `${req.user.name} ${reaction === 'like' ? 'liked' : 'passed on'} ${h.address}`,
        lines: [reaction === 'like' ? `${req.user.name} likes ${h.address}.` : `${req.user.name} is not interested in ${h.address}. It comes off their portal in 24 hours.`],
        link: `${baseUrl(req)}/admin/p/${p.id}#homes`, linkLabel: 'Open this deal',
      });
    }
    res.redirect(`/p/${p.id}#home${h.id}`);
  });

  app.post('/p/:id/homes/:hid/tour', requireUser, (req, res) => {
    const p = accessibleProperty(req), h = homeOf(p, req.params.hid);
    if (!h || p.access !== 'client') return notFound(res);
    if (!h.tour_requested_at) {
      db.prepare("UPDATE homes SET tour_requested_at = datetime('now'), reaction = coalesce(nullif(reaction, 'dislike'), 'like') WHERE id = ?").run(h.id);
      agentMail(req, {
        subject: `Tour request: ${h.address}`,
        lines: [`${req.user.name} wants to tour ${h.address}.`, [req.user.phone, req.user.email].filter(Boolean).join(' · ')],
        link: `${baseUrl(req)}/admin/p/${p.id}#homes`, linkLabel: 'Schedule the tour',
      });
    }
    flash(req, `Tour requested. ${firstName((agents()[0] || {}).name) || 'Your agent'} will confirm a time with you.`);
    res.redirect(`/p/${p.id}#home${h.id}`);
  });

  // ---------- comments on a home or a document ----------
  app.post('/p/:id/comments', requireUser, (req, res) => {
    const p = accessibleProperty(req);
    const target = req.body.target === 'doc' ? 'doc' : 'home';
    const item = p && (target === 'doc'
      ? db.prepare('SELECT id, title AS name FROM documents WHERE id = ? AND property_id = ?').get(req.body.target_id, p.id)
      : db.prepare('SELECT id, address AS name FROM homes WHERE id = ? AND property_id = ?').get(req.body.target_id, p.id));
    const body = String(req.body.body || '').trim().slice(0, 2000);
    if (!item) return notFound(res);
    const anchor = target === 'doc' ? `doc${item.id}` : `home${item.id}`;
    if (body) {
      db.prepare('INSERT INTO comments (property_id, target, target_id, user_id, body) VALUES (?,?,?,?,?)').run(p.id, target, item.id, req.user.id, body);
      const fromAgent = p.access === 'agent';
      const mail = { subject: `${firstName(req.user.name)} commented on ${item.name}`, lines: [`${req.user.name} commented on ${item.name}:`], quote: body, replyTo: req.user.email };
      if (!throttled(`comment|${p.id}|${target}|${item.id}|${fromAgent}`, 2)) {
        if (fromAgent) mailTo(clientsOf(p.id), { ...mail, link: `${baseUrl(req)}/p/${p.id}#${anchor}`, linkLabel: 'Reply in your portal' });
        else agentMail(req, { ...mail, link: `${baseUrl(req)}/admin/p/${p.id}#${target === 'doc' ? 'documents' : 'homes'}`, linkLabel: 'Open this deal' });
      }
    }
    res.redirect(p.access === 'agent' && req.body.from === 'admin' ? `/admin/p/${p.id}#${target === 'doc' ? 'documents' : 'homes'}` : `/p/${p.id}#${anchor}`);
  });

  // ---------- offers: lender hears about each new one, buyer about each counter or decision ----------
  function offerSubmitted(req, p, v) {
    const listing = [v.listing_agent, v.listing_agent_phone, v.listing_agent_email].filter(Boolean).join(' · ');
    mailTo(lendersOf(p.id), {
      subject: `Offer submitted for ${buyerName(p)} — ${v.address}`, replyTo: req.user.email,
      lines: [
        `${req.user.name} just submitted an offer for ${buyerName(p)} on ${v.address} at ${helpers.money(v.price)}.`,
        'Please call the listing agent today to introduce yourself and speak to the strength of the buyer’s financing.',
        listing ? `Listing agent: ${listing}` : `Ask ${firstName(req.user.name)} for the listing agent’s contact details.`,
      ],
      link: `${baseUrl(req)}/p/${p.id}`, linkLabel: 'Open the portal',
    });
  }

  app.post('/admin/p/:pid/offers/:oid/events', requireAgent, loadProperty, (req, res) => {
    const p = req.property, back = `/admin/p/${p.id}#buyoffers`;
    const o = db.prepare('SELECT * FROM offers WHERE id = ? AND property_id = ?').get(req.params.oid, p.id);
    const def = OFFER_EVENTS.find((e) => e[0] === req.body.kind);
    if (!o || !def) return res.redirect(back);
    const v = readFields([{ name: 'date', type: 'date' }, { name: 'price', type: 'money' }, { name: 'terms', type: 'textarea' }], req.body);
    db.prepare('INSERT INTO offer_events (offer_id, kind, date, price, terms) VALUES (?,?,?,?,?)').run(o.id, def[0], v.date || today(), v.price, v.terms);
    if (def[2]) db.prepare('UPDATE offers SET status = ? WHERE id = ?').run(def[2], o.id);
    const place = o.address || 'the home';
    const subject = {
      counter_seller: `The seller countered your offer on ${place}`,
      counter_buyer: `We sent a counter offer on ${place}`,
      accepted: `Your offer on ${place} was accepted!`,
      declined: `Update on your offer for ${place}`,
      withdrawn: `Your offer on ${place} was withdrawn`,
      note: `Update on your offer for ${place}`,
    }[def[0]];
    const mail = {
      subject, replyTo: req.user.email,
      lines: [`${def[1]}${v.price ? ' at ' + helpers.money(v.price) : ''} — ${place}.`], quote: v.terms,
    };
    mailTo(clientsOf(p.id), { ...mail, link: `${baseUrl(req)}/p/${p.id}#offers`, linkLabel: 'See the details' });
    if (def[0] === 'accepted') {
      mailTo(lendersOf(p.id), { ...mail, subject: `Offer accepted for ${buyerName(p)} — ${place}`, link: `${baseUrl(req)}/p/${p.id}`, linkLabel: 'Open the portal' });
    }
    res.redirect(back);
  });

  app.post('/admin/p/:pid/offers/:oid/events/:eid/delete', requireAgent, loadProperty, (req, res) => {
    db.prepare('DELETE FROM offer_events WHERE id = ? AND offer_id IN (SELECT id FROM offers WHERE id = ? AND property_id = ?)').run(
      req.params.eid, req.params.oid, req.property.id
    );
    res.redirect(`/admin/p/${req.property.id}#buyoffers`);
  });

  // ---------- timeline alerts ----------
  // The agent ticked "email my client" while saving a milestone (e.g. the inspection got scheduled).
  function milestoneUpdated(req, p, v) {
    mailTo(clientsOf(p.id), {
      subject: `${v.title}${v.status === 'done' ? ' — done' : v.due_date ? ' — scheduled' : ''}`, replyTo: req.user.email,
      lines: [
        v.status === 'done' ? `${v.title} is complete.` : v.due_date ? `${v.title} is scheduled for ${when(v.due_date, v.due_time)}.` : `There is an update on: ${v.title}.`,
        [v.vendor, v.vendor_contact].filter(Boolean).join(' · ') || null,
      ].filter(Boolean),
      quote: v.notes,
      link: `${baseUrl(req)}/p/${p.id}#timeline`, linkLabel: 'Open your portal',
    });
  }

  // Buyers owe the deposit within 3 days of opening escrow: fill that date in once escrow opens.
  function afterDealSaved(propertyId) {
    const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
    if (p && p.side === 'buyer' && p.escrow_opened) {
      db.prepare("UPDATE milestones SET due_date = ? WHERE property_id = ? AND title LIKE 'Earnest money%' AND due_date IS NULL AND status != 'done'").run(
        addDays(p.escrow_opened, 3), p.id
      );
    }
  }

  // Hourly: remind the buyer (and lender, where marked) the day before a deadline.
  function emailDueReminders() {
    if (!mailer.ready()) return;
    const t = today(), base = savedBase();
    const due = db
      .prepare(
        `SELECT m.*, p.address FROM milestones m JOIN properties p ON p.id = m.property_id
         WHERE m.alert IN ('client', 'both') AND m.status != 'done' AND m.due_date IN (?, ?)
           AND (m.reminded_for IS NULL OR m.reminded_for != m.due_date) AND p.stage != 'closed'`
      )
      .all(t, addDays(t, 1));
    for (const m of due) {
      db.prepare('UPDATE milestones SET reminded_for = due_date WHERE id = ?').run(m.id);
      const mail = {
        subject: `Reminder: ${m.title} — due ${m.due_date === t ? 'today' : 'tomorrow'}`,
        lines: [`${m.title} for ${m.address} is due ${m.due_date === t ? 'today' : 'tomorrow'}, ${when(m.due_date, m.due_time)}.`],
        quote: m.notes, replyTo: (agents()[0] || {}).email,
        link: base ? `${base}/p/${m.property_id}` : null, linkLabel: 'Open the portal',
      };
      mailTo(clientsOf(m.property_id), mail);
      if (m.alert === 'both') mailTo(lendersOf(m.property_id), mail);
    }
  }

  return { pageData, adminData, lenderPage, offerSubmitted, milestoneUpdated, afterDealSaved, emailDueReminders };
};
