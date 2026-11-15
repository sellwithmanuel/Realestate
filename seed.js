// Fills an EMPTY database with a demo agent, a demo client and a sample sale so
// you can see what the portal looks like. Run with: npm run seed
const { db, createUser, createProperty } = require('./db');

if (db.prepare('SELECT 1 FROM users').get()) {
  console.log('The database already has users, so nothing was changed.');
  process.exit(0);
}

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
};

createUser({ name: 'Demo Agent', email: 'agent@example.com', phone: '(555) 010-2000', password: 'demo-agent-123', role: 'agent' });
const client = createUser({ name: 'Jordan Sample', email: 'client@example.com', password: 'demo-client-123', role: 'client' });

const pid = createProperty('1234 Sample Street', 'Anytown, CA', '90001', 'seller');
db.prepare('INSERT INTO property_clients (property_id, user_id) VALUES (?,?)').run(pid, client);
db.prepare(
  `UPDATE properties SET stage='escrow', list_price=1250000, sale_price=1285000, list_date=?, mls_number='SAMPLE123',
   escrow_company='Sample Escrow Co.', escrow_number='00-12345', escrow_opened=?, closing_date=?,
   headline=? WHERE id=?`
).run(day(-24), day(-6), day(24), 'We are in escrow! Inspections are this week — nothing you need to do right now.', pid);

const set = (title, fields) => {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE milestones SET ${cols.map((c) => c + ' = ?').join(', ')} WHERE property_id = ? AND title = ?`).run(
    ...cols.map((c) => fields[c]), pid, title
  );
};
const done = (title, offset, extra = {}) => set(title, { status: 'done', done_date: day(offset), ...extra });
done('Listing agreement signed', -35);
done('Seller disclosures completed', -32);
done('Home prep & staging', -29);
done('Professional photos taken', -27, { paid_by: 'Agent' });
done('Listing live on the MLS', -24);
done('Yard sign & lockbox installed', -24);
done('Open house scheduled', -22);
done('Offers reviewed', -8);
done('Offer accepted', -7);
done('Escrow opened', -6);
done("Buyer's earnest money deposit received", -4);
done('Seller disclosures delivered to buyer', -4);
set('Home inspection', { status: 'in_progress', due_date: day(2), vendor: 'Sample Home Inspections' });
set('Termite inspection & report', { status: 'in_progress', due_date: day(3), cost: 125, vendor: 'Sample Termite Co.' });
set('Appraisal', { due_date: day(9) });
set("Buyer's contingencies removed", { due_date: day(11) });
set('Close of escrow — funds & keys', { due_date: day(24) });

const oh = db.prepare('INSERT INTO open_houses (property_id, date, start_time, end_time, guests, notes) VALUES (?,?,?,?,?,?)');
oh.run(pid, day(-21), '13:00', '16:00', 23, 'Great turnout. Several neighbors and four serious buyers.');
oh.run(pid, day(-14), '12:00', '15:00', 14, null);

const sh = db.prepare('INSERT INTO showings (property_id, date, buyer_agent, interest, feedback) VALUES (?,?,?,?,?)');
sh.run(pid, day(-20), 'Sample Realty', 'High', 'Loved the kitchen and the yard. Thinking about writing an offer.');
sh.run(pid, day(-17), 'Example Homes', 'Medium', 'Liked the layout but hoped for a bigger primary bedroom.');
sh.run(pid, day(-12), 'Demo Brokerage', 'High', 'Clients want a second look this weekend.');
sh.run(pid, day(-10), 'Sample Realty', '', null);

const of = db.prepare(
  `INSERT INTO offers (property_id, received_date, buyer_name, buyer_agent, price, status, financing, down_payment, deposit, escrow_days, credits, contingencies, notes)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
);
of.run(pid, day(-9), 'Buyer A', 'Sample Realty', 1285000, 'Accepted', 'Conventional loan', '25%', 38000, 30, 'None',
  'Inspection 10 days, appraisal 17 days, loan 21 days', 'Strongest overall: highest price, solid down payment and a fully underwritten pre-approval.');
of.run(pid, day(-9), 'Buyer B', 'Demo Brokerage', 1260000, 'Declined', 'Cash', null, 37000, 21, '$5,000 for repairs',
  'Inspection 7 days', 'Fast cash close, but $25,000 lower and asking for a credit.');

const ct = db.prepare('INSERT INTO contacts (property_id, role, name, company, phone, email, sort) VALUES (?,?,?,?,?,?,?)');
ct.run(pid, 'Transaction Coordinator', 'Taylor Example', 'Sample TC Services', '(555) 010-2001', 'tc@example.com', 1);
ct.run(pid, 'Escrow Officer', 'Morgan Example', 'Sample Escrow Co.', '(555) 010-2002', 'escrow@example.com', 2);
ct.run(pid, 'Title Officer', 'Casey Example', 'Sample Title Co.', '(555) 010-2003', 'title@example.com', 3);
ct.run(pid, "Buyer's Agent", 'Riley Example', 'Sample Realty', '(555) 010-2004', 'buyeragent@example.com', 4);

const up = db.prepare('INSERT INTO updates (property_id, date, message) VALUES (?,?,?)');
up.run(pid, day(-1), 'Home inspection is confirmed. The inspector will need about 3 hours of access.');
up.run(pid, day(-4), "The buyer's deposit has been received by escrow.");
up.run(pid, day(-7), 'Congratulations — offer accepted and escrow is open!');

// Agent-side demo data: commission defaults, a buyer in escrow, more listings and past deals.
const setting = db.prepare('INSERT INTO settings (key, value) VALUES (?,?)');
setting.run('default_commission_pct', '2.5');
setting.run('default_split_pct', '80');
db.prepare("UPDATE properties SET client_name = 'Jordan Sample', client_phone = '(555) 010-3001', client_email = 'client@example.com' WHERE id = ?").run(pid);
const deal = (side, address, zip, fields) => {
  const id = createProperty(address, 'Anytown, CA', zip, side);
  const cols = Object.keys(fields);
  db.prepare(`UPDATE properties SET ${cols.map((c) => c + ' = ?').join(', ')} WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
  if (fields.stage === 'closed') db.prepare("UPDATE milestones SET status = 'done' WHERE property_id = ?").run(id);
  return id;
};
deal('seller', '88 Example Avenue', '90001', { stage: 'active', list_price: 899000, list_date: day(-9), client_name: 'Avery Sample', client_phone: '(555) 010-3002', client_email: 'avery@example.com' });
deal('seller', '5 Demo Court', '90002', { stage: 'prep', list_price: 1650000, client_name: 'Quinn Sample', client_phone: '(555) 010-3003' });
deal('seller', '410 Placeholder Lane', '90002', { stage: 'closed', list_price: 975000, sale_price: 990000, escrow_opened: day(-62), closing_date: day(-31), client_name: 'Drew & Sky Sample', client_phone: '(555) 010-3004', client_email: 'drew@example.com' });
deal('seller', '72 Mockingbird Way', '90001', { stage: 'closed', list_price: 1400000, sale_price: 1380000, escrow_opened: day(-392), closing_date: day(-355), client_name: 'Reese Sample', client_email: 'reese@example.com', referral_pct: 25 });
const escrowBuy = deal('buyer', '19 Sample Hill Road', '90003', { stage: 'escrow', sale_price: 1120000, escrow_opened: day(-12), closing_date: day(18), client_name: 'Parker Sample', client_phone: '(555) 010-3005', client_email: 'parker@example.com' });
const searchBuy = deal('buyer', 'Emerson’s home search', '', {
  stage: 'offers', client_name: 'Emerson Sample', client_phone: '(555) 010-3006', client_email: 'buyer@example.com', preapproval_amount: 950000,
  headline: 'We have one offer out and two more homes worth a look.',
  criteria: JSON.stringify({ price_min: '700000', price_max: '950000', beds: '3', baths: '2', types: 'House or townhome', areas: 'North Park, Kensington', zips: '92104, 92116', must: 'Garage, small yard', notes: '', shapes: null }),
});
const buyerUser = createUser({ name: 'Emerson Sample', email: 'buyer@example.com', phone: '(555) 010-3006', password: 'demo-buyer-123', role: 'client' });
const lenderUser = createUser({ name: 'Lee Example', email: 'lender@example.com', phone: '(555) 010-4000', company: 'Sample Home Loans', password: 'demo-lender-123', role: 'client', isLender: true });
db.prepare("INSERT INTO property_clients (property_id, user_id, access) VALUES (?,?,'client')").run(searchBuy, buyerUser);
db.prepare("INSERT INTO property_clients (property_id, user_id, access) VALUES (?,?,'lender')").run(searchBuy, lenderUser);
db.prepare("INSERT INTO property_clients (property_id, user_id, access) VALUES (?,?,'lender')").run(escrowBuy, lenderUser);
for (const t of ['First conversation', 'Buyer representation agreement signed', 'Pre-approval letter received', 'Search criteria set', 'Home search started', 'Offer submitted']) {
  db.prepare("UPDATE milestones SET status = 'done', done_date = ? WHERE property_id = ? AND title = ?").run(day(-10), searchBuy, t);
}
const hm = db.prepare('INSERT INTO homes (property_id, address, city, price, beds, baths, sqft, url, note, reaction, reacted_at, tour_requested_at, tour_date, tour_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
hm.run(searchBuy, '2210 Sample Bluff Dr', 'North Park', 925000, 3, 2, 1650, 'https://example.com/listing/1', 'Great light and a real garage. Priced right.', 'like', new Date().toISOString().slice(0, 19).replace('T', ' '), new Date().toISOString().slice(0, 19).replace('T', ' '), day(2), '10:30');
hm.run(searchBuy, '48 Placeholder Pl', 'Kensington', 899000, 3, 2.5, 1720, 'https://example.com/listing/2', 'Townhome, newer build, low HOA.', null, null, null, null, null);
hm.run(searchBuy, '915 Example Ct', 'North Park', 875000, 4, 2, 1810, null, null, 'dislike', new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 19).replace('T', ' '), null, null, null);
db.prepare("INSERT INTO comments (property_id, target, target_id, user_id, body) VALUES (?, 'home', 1, ?, ?)").run(searchBuy, buyerUser, 'Love the kitchen. Is the garage big enough for two cars?');
const bo = db.prepare("INSERT INTO offers (property_id, received_date, address, price, status, financing, down_payment, deposit, escrow_days, contingencies, listing_agent, listing_agent_phone, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(searchBuy, day(-3), '77 Demo Ridge Rd', 880000, 'Countered', 'Conventional loan', '20%', 26400, 30, 'Inspection 17 days, appraisal 17 days, loan 21 days', 'Jesse Example', '(555) 010-5000', 'Their counter is fair. I would meet in the middle on price and keep our 30 days.').lastInsertRowid;
const evt = db.prepare('INSERT INTO offer_events (offer_id, kind, date, price, terms) VALUES (?,?,?,?,?)');
evt.run(bo, 'counter_seller', day(-2), 905000, 'Seller wants a 21-day escrow and to stay 3 days after closing.');
evt.run(bo, 'counter_buyer', day(-1), 892000, '30-day escrow, seller may stay 2 days after closing.');
db.prepare('UPDATE properties SET emd_amount = 33600, escrow_company = ? WHERE id = ?').run('Sample Escrow Co.', escrowBuy);
for (const [t, d] of [['Earnest money deposit due', -9], ['Inspection contingency removal due', 5], ['Appraisal contingency removal due', 5], ['Loan contingency removal due', 9]]) {
  db.prepare('UPDATE milestones SET due_date = ? WHERE property_id = ? AND title = ?').run(day(d), escrowBuy, t);
}
deal('buyer', '300 Example Terrace', '90001', { stage: 'closed', sale_price: 845000, escrow_opened: day(-125), closing_date: day(-92), client_name: 'Harper Sample', client_email: 'harper@example.com' });

const vd = db.prepare('INSERT INTO vendors (category, name, company, phone, notes) VALUES (?,?,?,?,?)');
vd.run('Electrician', 'Alex Example', 'Sample Electric', '(555) 010-2010', 'Fast, fair and always on time.');
vd.run('Gardener / Landscaper', 'Sam Example', 'Sample Gardens', '(555) 010-2011', null);
vd.run('Painter', 'Jamie Example', 'Sample Painting', '(555) 010-2012', 'Painted three of my listings this year.');
db.prepare('UPDATE properties SET value_url = ? WHERE id = ?').run('https://example.com/home-value-report', pid);

console.log('Demo data created.\n  Agent:  agent@example.com / demo-agent-123\n  Seller: client@example.com / demo-client-123\n  Buyer:  buyer@example.com / demo-buyer-123\n  Lender: lender@example.com / demo-lender-123');
