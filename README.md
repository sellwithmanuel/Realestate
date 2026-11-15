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

## How logins work

1. The first time the site is opened it asks you (the agent) to create your own login.
2. Add a sale, then under **Client access** enter the client's name, email and a password.
3. Send the client the site address, their email and that password. They can change the password under their account.

Clients only ever see the sales linked to their login. Passwords are stored hashed, so a forgotten one is reset by the agent (Client logins → pick the client → set a new password).

Every new sale starts with a standard milestone checklist (see `DEFAULT_MILESTONES` in `kinds.js`). The "who pays" defaults are only starting points — edit them per transaction.

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
| `BRAND_NAME` | Name shown in the header | `Sell With Manuel` |
| `TIME_ZONE` | Time zone used for "today" | `America/Los_Angeles` |
| `NODE_ENV` | Set to `production` when hosted (login cookie then requires HTTPS) | |

## Hosting

Any host that runs Node 20+ and offers a persistent disk works. All data (the SQLite file `portal.db` plus uploaded documents and images in `uploads/`) lives in `DATA_DIR`, so that folder **must** be on a persistent disk and should be backed up. `render.yaml` is a ready-made setup for Render.
