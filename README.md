# Client Home Sale Portal

A private portal where each seller signs in and sees exactly where their home sale stands, without having to ask.

## What clients see

- Stage of the sale (Preparing → On the market → Reviewing offers → In escrow → Sold)
- Timeline of every milestone: listing agreement, photos, MLS, open house, escrow steps, closing
- Open houses and guest counts, showings and the feedback received
- Offers, with an overview of each one
- Escrow company, escrow number, closing date and a countdown
- Who pays for what (termite report, inspection, title insurance, appraisal, …)
- Contact details for everyone involved (agent, transaction coordinator, escrow, title, …)
- Updates posted by the agent
- The agent's photo, contact info and bio, with a built-in chat to message the agent
- Documents the agent uploads (contracts, reports, closing statement), available after the sale too
- A button to their home value report (a HomeIQ or similar link pasted in by the agent)
- "Trusted pros": the agent's recommended gardeners, electricians, roofers, painters, …

## Branding

Under **Branding** the agent sets the main and accent colors, uploads a logo and headshot, and fills in contact info and an "about me". It applies to the whole portal immediately.

## Buyer portal

Deals where the agent represents the buyer get their own page:

- **Lender & pre-approval:** the lender's contact info and the pre-approval documents
- **Search criteria:** price, beds, baths, areas and a map of San Diego County where ZIP codes can be tapped on/off and exact areas drawn. Buyer and agent can both edit; the other is emailed
- **Homes:** the agent shares homes (address, price, photo, listing link, note). The buyer can like, pass (it leaves their portal after 24 hours), comment, or request a tour
- **Offers:** each offer the agent submits, with every counter and the final decision underneath
- **Timeline:** buyer checklist from first conversation to keys, with inspection, appraisal and loan contingency dates, earnest money deposit (auto-set to 3 days after escrow opens), and expandable explanations
- **Documents & reports:** inspection, termite and other reports, with comments

**Lender login (limited):** created by the agent on a buyer deal. A lender sees only the buyer's and agent's contact info, offers out with the listing agent's contact, key loan dates, and can upload pre-approval documents.

**Buyer-side emails:** buyer on counters/decisions, shared homes, tours, documents, criteria changes and (when ticked) timeline updates; lender on every offer submitted and accepted; buyer and/or lender the day before deadlines marked for a reminder; agent on likes, passes, comments, tour requests, criteria changes and lender uploads.

Map data: `public/sd-zips.json` is simplified from US Census ZIP code tabulation areas; the map itself uses Leaflet and OpenStreetMap.

## What the agent sees

- **Dashboard:** current listings, active buyers, deals in escrow, commission pending and earned this year
- **Sellers and buyers kept separate**, each split into current and past deals and grouped by ZIP code
- For every deal: client contact info, price, the agent's commission, escrow opened / closed dates, days in escrow and days since closing
- **Follow-ups:** a reminder 30 days, 90 days and 12 months after closing, then every year on the anniversary (homeversary and home valuation update). Reminders show on the dashboard and, when email is set up, are emailed on the day they come due
- Commission = price × commission % (less any referral fee) × the agent's split, less fees. Defaults are set under **Settings** and can be overridden per deal. Clients never see it

## How logins work

1. The first time the site is opened it asks you (the agent) to create your own login.
2. Add a sale, then under **Client access** enter the client's name, email and a password.
3. Send the client the site address, their email and that password. They can change the password under their account.

Clients only ever see the sales linked to their login. Passwords are stored hashed, so a forgotten one is reset by the agent (Client logins → pick the client → set a new password).

Every new sale starts with a standard milestone checklist (see `DEFAULT_MILESTONES` in `kinds.js`). The "who pays" defaults are only starting points — edit them per transaction.

## Email alerts

When email is set up (see the `SMTP_*` settings below):

- The agent is emailed when a client sends a chat message, opens their home value report, or comes back to the portal after the sale has closed (once a day at most).
- Clients are emailed when the agent sends them a chat message.

A burst of chat messages produces one email, not one per message. **Branding → Email alerts** shows whether email is set up and has a "send me a test email" button. Recent client visits and home-value checks are also listed on each sale under **Client access**.

## Run it

```
npm install
npm start          # http://localhost:3000
```

`npm run seed` fills an empty database with a demo agent, client and sample sale.

## Settings (environment variables)

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Port to listen on | `3000` |
| `DATA_DIR` | Folder that holds the database and uploaded files | `./data` |
| `BRAND_NAME` | Business name used in page titles and emails | `Manuel Sanchez \| SERHANT.` |
| `SMTP_HOST`, `SMTP_PORT` | Email server used to send alerts (e.g. `smtp.gmail.com`, `587`). No alerts are sent without `SMTP_HOST` | |
| `SMTP_USER`, `SMTP_PASS` | Login for that email server (for Gmail / Google Workspace: your address and an app password) | |
| `MAIL_FROM` | Address alerts are sent from | same as `SMTP_USER` |
| `PUBLIC_URL` | The portal's web address, used for links in emails | taken from the request |
| `TIME_ZONE` | Time zone used for "today" | `America/Los_Angeles` |
| `NODE_ENV` | Set to `production` when hosted (login cookie then requires HTTPS) | |

## Hosting

Any host that runs Node 20+ and offers a persistent disk works. All data (the SQLite file `portal.db` plus uploaded documents and images in `uploads/`) lives in `DATA_DIR`, so that folder **must** be on a persistent disk and should be backed up. `render.yaml` is a ready-made setup for Render.
