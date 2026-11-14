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

const pid = createProperty('1234 Sample Street', 'Anytown, CA 90000');
db.prepare('INSERT INTO property_clients VALUES (?,?)').run(pid, client);
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

console.log('Demo data created.\n  Agent:  agent@example.com / demo-agent-123\n  Client: client@example.com / demo-client-123');
