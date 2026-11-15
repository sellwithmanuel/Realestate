// Email notifications. Sending is switched on by setting SMTP_HOST (plus
// SMTP_PORT, SMTP_USER, SMTP_PASS and optionally MAIL_FROM). Without it,
// the portal works normally and simply sends no email.
const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT) || 587;
const fromAddress = process.env.MAIL_FROM || process.env.SMTP_USER;
const transport =
  host && fromAddress
    ? nodemailer.createTransport({
        host, port, secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })
    : null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const oneLine = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

const ready = () => !!transport;

// lines: paragraphs of plain text. quote: optional quoted message. Returns a promise.
function send({ to, subject, lines, quote, link, linkLabel, fromName, replyTo, color }) {
  if (!transport) return Promise.resolve(false);
  const text = [...lines, quote ? `"${quote}"` : null, link ? `${linkLabel}: ${link}` : null].filter(Boolean).join('\n\n');
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1c2a2e;max-width:520px">` +
    lines.map((l) => `<p>${esc(l)}</p>`).join('') +
    (quote ? `<p style="border-left:4px solid ${color};margin:16px 0;padding:8px 14px;background:#f3f4f8;white-space:pre-line">${esc(quote)}</p>` : '') +
    (link ? `<p><a href="${esc(link)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:8px">${esc(linkLabel)}</a></p>` : '') +
    `</div>`;
  return transport
    .sendMail({
      from: { name: oneLine(fromName), address: fromAddress },
      to, replyTo: replyTo || undefined,
      subject: oneLine(subject), text, html,
    })
    .then(() => true);
}

module.exports = { ready, send };
