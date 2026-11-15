// Shared definitions: sale stages, milestone phases, default milestone checklist,
// and the editable record types ("kinds") that hang off a sale.

const STAGES = [
  ['prep', 'Preparing'],
  ['active', 'On the market'],
  ['offers', 'Reviewing offers'],
  ['escrow', 'In escrow'],
  ['closed', 'Sold'],
];

const PHASES = [
  ['prep', 'Getting ready to list'],
  ['market', 'On the market'],
  ['escrow', 'In escrow'],
];

const STATUSES = [
  ['pending', 'Not started'],
  ['in_progress', 'In progress'],
  ['done', 'Done'],
];

const PAID_BY = [
  ['', 'Not applicable'],
  ['Seller', 'Seller (you)'],
  ['Buyer', 'Buyer'],
  ['Split', 'Split between buyer & seller'],
  ['Agent', 'Covered by your agent'],
];

// Checklist every new sale starts with. Who-pays values are common defaults
// and are meant to be edited per transaction, since they are negotiable.
const DEFAULT_MILESTONES = [
  ['prep', 'Listing agreement signed', ''],
  ['prep', 'Seller disclosures completed', ''],
  ['prep', 'Home prep & staging', ''],
  ['prep', 'Professional photos taken', ''],
  ['market', 'Listing live on the MLS', ''],
  ['market', 'Yard sign & lockbox installed', ''],
  ['market', 'Open house scheduled', ''],
  ['market', 'Offers reviewed', ''],
  ['market', 'Offer accepted', ''],
  ['escrow', 'Escrow opened', ''],
  ['escrow', "Buyer's earnest money deposit received", 'Buyer'],
  ['escrow', 'Seller disclosures delivered to buyer', ''],
  ['escrow', 'Home inspection', 'Buyer'],
  ['escrow', 'Termite inspection & report', 'Seller'],
  ['escrow', 'Natural hazard disclosure report', 'Seller'],
  ['escrow', 'Preliminary title report received', ''],
  ['escrow', 'Request for repairs negotiated', ''],
  ['escrow', 'Appraisal', 'Buyer'],
  ['escrow', "Buyer's contingencies removed", ''],
  ['escrow', "Buyer's loan approved", ''],
  ['escrow', "Owner's title insurance policy", 'Seller'],
  ['escrow', "Lender's title insurance policy", 'Buyer'],
  ['escrow', 'Escrow fees', 'Split'],
  ['escrow', 'Closing documents signed', ''],
  ['escrow', "Buyer's final walk-through", ''],
  ['escrow', 'Close of escrow — funds & keys', ''],
];

const label = (pairs, v) => (pairs.find((p) => p[0] === v) || [v, v])[1];

const PROPERTY_FIELDS = [
  { name: 'address', label: 'Street address', type: 'text', required: true, wide: true },
  { name: 'city', label: 'City, state, ZIP', type: 'text' },
  { name: 'stage', label: 'Current stage', type: 'select', options: STAGES },
  { name: 'list_price', label: 'List price', type: 'money' },
  { name: 'list_date', label: 'Date listed on MLS', type: 'date' },
  { name: 'mls_number', label: 'MLS #', type: 'text' },
  { name: 'listing_url', label: 'Listing link', type: 'url', wide: true },
  { name: 'escrow_company', label: 'Escrow company', type: 'text' },
  { name: 'escrow_number', label: 'Escrow #', type: 'text' },
  { name: 'escrow_opened', label: 'Escrow opened', type: 'date' },
  { name: 'closing_date', label: 'Closing date', type: 'date' },
  { name: 'sale_price', label: 'Accepted / sale price', type: 'money' },
  { name: 'value_url', label: 'Home value report link (paste the client’s HomeIQ report link)', type: 'url', wide: true },
  { name: 'headline', label: 'Status note shown at the top of the client page', type: 'textarea', wide: true },
];

const VENDOR_FIELDS = [
  { name: 'category', label: 'Type of service', type: 'text', required: true, list: ['Gardener / Landscaper', 'Electrician', 'Plumber', 'Roofer', 'Painter', 'Handyman', 'Heating & Air', 'House Cleaner', 'Mover', 'Pest Control', 'General Contractor', 'Flooring', 'Pool Service'] },
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'company', label: 'Company', type: 'text' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'website', label: 'Website', type: 'url' },
  { name: 'notes', label: 'Why you recommend them', type: 'textarea', wide: true },
];

const KINDS = {
  updates: {
    table: 'updates', title: 'Updates to your client', singular: 'update',
    order: 'date DESC, id DESC',
    fields: [
      { name: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { name: 'message', label: 'Message', type: 'textarea', required: true, wide: true },
    ],
    summary: (r, h) => `${h.fdate(r.date)} — ${r.message}`,
  },
  milestones: {
    table: 'milestones', title: 'Milestones', singular: 'milestone',
    order: "CASE phase WHEN 'prep' THEN 0 WHEN 'market' THEN 1 ELSE 2 END, sort, id",
    fields: [
      { name: 'title', label: 'Milestone', type: 'text', required: true, wide: true },
      { name: 'phase', label: 'Phase', type: 'select', options: PHASES },
      { name: 'status', label: 'Status', type: 'select', options: STATUSES },
      { name: 'due_date', label: 'Scheduled / due', type: 'date' },
      { name: 'done_date', label: 'Completed on', type: 'date' },
      { name: 'paid_by', label: 'Who pays', type: 'select', options: PAID_BY },
      { name: 'cost', label: 'Cost (optional)', type: 'money' },
      { name: 'vendor', label: 'Company / vendor', type: 'text' },
      { name: 'sort', label: 'Order within phase', type: 'number' },
      { name: 'notes', label: 'Notes for client', type: 'textarea', wide: true },
    ],
    summary: (r, h) =>
      [
        label(PHASES, r.phase),
        r.title,
        r.paid_by && `${r.paid_by} pays`,
        r.status === 'done' ? r.done_date && `done ${h.fdate(r.done_date)}` : r.due_date && `due ${h.fdate(r.due_date)}`,
      ].filter(Boolean).join(' · '),
  },
  openhouses: {
    table: 'open_houses', title: 'Open houses', singular: 'open house',
    order: 'date DESC, id DESC',
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'start_time', label: 'Starts', type: 'time' },
      { name: 'end_time', label: 'Ends', type: 'time' },
      { name: 'guests', label: 'Number of guests (after the event)', type: 'number' },
      { name: 'notes', label: 'Notes / feedback', type: 'textarea', wide: true },
    ],
    summary: (r, h) =>
      `${h.fdate(r.date)}${r.start_time ? ' ' + h.ftime(r.start_time) : ''}${r.guests != null ? ` — ${r.guests} guests` : ''}`,
  },
  showings: {
    table: 'showings', title: 'Showings & feedback', singular: 'showing',
    order: 'date DESC, id DESC',
    fields: [
      { name: 'date', label: 'Date', type: 'date', default: 'today', required: true },
      { name: 'buyer_agent', label: "Buyer's agent / brokerage", type: 'text' },
      { name: 'interest', label: 'Interest level', type: 'select', options: [['', 'Unknown'], 'High', 'Medium', 'Low'] },
      { name: 'feedback', label: 'Feedback received', type: 'textarea', wide: true },
    ],
    summary: (r, h) => `${h.fdate(r.date)}${r.buyer_agent ? ' — ' + r.buyer_agent : ''}${r.feedback ? ' — feedback received' : ''}`,
  },
  offers: {
    table: 'offers', title: 'Offers', singular: 'offer',
    order: 'received_date DESC, id DESC',
    fields: [
      { name: 'received_date', label: 'Date received', type: 'date', default: 'today', required: true },
      { name: 'buyer_name', label: 'Buyer', type: 'text' },
      { name: 'buyer_agent', label: "Buyer's agent / brokerage", type: 'text' },
      { name: 'price', label: 'Offer price', type: 'money', required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['Received', 'Countered', 'Accepted', 'Declined', 'Withdrawn', 'Expired'] },
      { name: 'financing', label: 'Financing', type: 'select', options: [['', 'Not specified'], 'Cash', 'Conventional loan', 'FHA loan', 'VA loan', 'Other'] },
      { name: 'down_payment', label: 'Down payment', type: 'text' },
      { name: 'deposit', label: 'Earnest money deposit', type: 'money' },
      { name: 'escrow_days', label: 'Escrow length (days)', type: 'number' },
      { name: 'credits', label: 'Credits / concessions requested', type: 'text' },
      { name: 'expires', label: 'Offer expires', type: 'date' },
      { name: 'contingencies', label: 'Contingencies', type: 'textarea', wide: true },
      { name: 'notes', label: "Your overview / recommendation", type: 'textarea', wide: true },
    ],
    summary: (r, h) => `${h.fdate(r.received_date)} — ${h.money(r.price)}${r.buyer_name ? ' from ' + r.buyer_name : ''} (${r.status})`,
  },
  contacts: {
    table: 'contacts', title: 'Everyone involved', singular: 'contact',
    order: 'sort, id',
    fields: [
      { name: 'role', label: 'Role', type: 'text', required: true, list: ['Transaction Coordinator', 'Escrow Officer', 'Title Officer', "Buyer's Agent", "Buyer's Lender", 'Home Inspector', 'Termite Company', 'Appraiser', 'Photographer', 'Stager'] },
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'company', label: 'Company', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'sort', label: 'Order', type: 'number' },
    ],
    summary: (r) => `${r.role} — ${r.name}${r.company ? ', ' + r.company : ''}`,
  },
};

module.exports = { STAGES, PHASES, STATUSES, PAID_BY, DEFAULT_MILESTONES, PROPERTY_FIELDS, VENDOR_FIELDS, KINDS, label };
