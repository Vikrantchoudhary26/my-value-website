// Shared helpers for the MyValue serverless API (Vercel Node functions).
// Files starting with "_" are not exposed as routes.
//
// Zero npm dependencies: Redis via the Upstash REST API, email via the
// Resend REST API, both over global fetch (Node 18+).
//
// Env vars (Vercel → Project → Settings → Environment Variables):
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//     (or KV_REST_API_URL / KV_REST_API_TOKEN from the Vercel KV/Upstash integration)
//   RESEND_API_KEY
//   MAIL_FROM            e.g. "MyValue <hello@getmyvalue.app>" (domain verified in Resend)
//   MAIL_POSTAL_ADDRESS  physical mailing address — required by CAN-SPAM
//   SITE_URL             e.g. "https://getmyvalue.app" (no trailing slash)
//   CONTACT_TO           inbox that receives contact/support form messages
//   APP_STORE_URL        used by /api/send-link once live
//   REFERRAL_BOOST       places a referrer moves up per confirmed referral (default 10)

const crypto = require('crypto');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const SITE_URL = (process.env.SITE_URL || 'https://getmyvalue.app').replace(/\/$/, '');

function hasRedis() { return Boolean(REDIS_URL && REDIS_TOKEN); }
function hasMail() { return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM); }

// Run several Redis commands in one round trip. Returns an array of results;
// throws if any command errored.
async function redis(...commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!res.ok) throw new Error(`redis http ${res.status}`);
  const out = await res.json();
  return out.map((r) => {
    if (r.error) throw new Error(`redis: ${r.error}`);
    return r.result;
  });
}

// Upstash returns HGETALL as a flat [k, v, k, v] array.
function toObject(flat) {
  const o = {};
  if (!Array.isArray(flat)) return o;
  for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function normalizeEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

// Unambiguous alphabet for referral codes (no 0/O/1/l/I).
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function randomCode(len = 7) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
function randomToken() { return crypto.randomBytes(24).toString('hex'); }

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '')).split(',')[0].trim() || 'unknown';
}

// Fixed-window limiter: at most `max` hits per `windowSec` per key.
async function rateLimited(bucket, req, max, windowSec) {
  const key = `rl:${bucket}:${clientIp(req)}`;
  const [, count] = await redis(['SET', key, 0, 'EX', windowSec, 'NX'], ['INCR', key]);
  return count > max;
}

async function sendMail({ to, subject, html, text, replyTo, headers }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html, text, reply_to: replyTo, headers })
  });
  if (!res.ok) throw new Error(`resend http ${res.status}: ${await res.text()}`);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Minimal monochrome email shell with the CAN-SPAM footer.
function emailLayout(bodyHtml, footerExtraHtml = '') {
  const addr = esc(process.env.MAIL_POSTAL_ADDRESS || '');
  return `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#000">
<div style="max-width:520px;margin:0 auto;padding:40px 24px">
<p style="font-weight:700;font-size:18px;margin:0 0 28px">MyValue</p>
${bodyHtml}
<hr style="border:0;border-top:1px solid #e5e5e5;margin:36px 0 16px">
<p style="font-size:12px;line-height:1.6;color:#6b6b6b;margin:0">${footerExtraHtml}${addr ? `<br>MyValue · ${addr}` : ''}</p>
</div></body></html>`;
}

function button(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-weight:500;padding:14px 24px;border-radius:6px">${esc(label)}</a>`;
}

// Read a POST body whether it arrived as JSON or as a plain HTML form post.
function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return Object.fromEntries(new URLSearchParams(req.body)); }
  }
  return {};
}
function isFormPost(req) {
  return String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded');
}

function json(res, status, data, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheSeconds ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}` : 'no-store');
  res.end(JSON.stringify(data));
}
function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

module.exports = {
  SITE_URL, hasRedis, hasMail, redis, toObject, normalizeEmail, randomCode, randomToken,
  rateLimited, sendMail, esc, emailLayout, button, body, isFormPost, json, redirect
};
