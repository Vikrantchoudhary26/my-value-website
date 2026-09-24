// Waitlist + referral engine.
//
//   POST /api/waitlist   { email, ref?, utm?, source?, company? (honeypot) }
//        → 201 { ok, code, position, total, referralUrl }
//        → 200 { ok, existing: true }  (already on the list — link re-sent by email)
//        Accepts JSON (fetch) or a plain HTML form post (no-JS fallback → 303 redirect).
//   GET  /api/waitlist               → { confirmed, total }   (progress bar; CDN-cached 60s)
//   GET  /api/waitlist?code=<code>   → { position, total, refs, confirmed, referralUrl }
//
// Redis keys:
//   wl:seq           signup counter (the base queue score)
//   wl:q             sorted set of emails; score = seq − REFERRAL_BOOST × confirmed referrals
//   wl:u:<email>     hash: code, seq, created, ref (referrer email), utm, source,
//                    confirmed, confirmedAt, refs, token, unsub
//   wl:c:<code>      referral code → email
//   wl:t:<token>     confirmation/unsubscribe token → email
//   wl:confirmed     count of double-opt-in confirmed signups (what the progress bar shows)
//
// Referral credit is only granted when the referred person confirms their email
// (see confirm.js), so fake addresses can't be used to jump the queue.

const L = require('./_lib');

const BOOST = Math.max(1, parseInt(process.env.REFERRAL_BOOST || '10', 10));

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') return await status(req, res);
    if (req.method === 'POST') return await join(req, res);
    res.setHeader('Allow', 'GET, POST');
    return L.json(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    console.error('[waitlist]', err);
    return L.isFormPost(req) ? L.redirect(res, '/?wl_error=server#waitlist') : L.json(res, 500, { error: 'server_error' });
  }
};

async function join(req, res) {
  const form = L.isFormPost(req);
  const fail = (status, error) => (form ? L.redirect(res, `/?wl_error=${error}#waitlist`) : L.json(res, status, { error }));

  // Without storage + email we can't honour double opt-in, so refuse loudly
  // rather than silently dropping signups.
  if (!L.hasRedis() || !L.hasMail()) return fail(503, 'not_configured');

  const b = L.body(req);
  if (b.company) return fail(400, 'invalid');
  const email = L.normalizeEmail(b.email);
  if (!email) return fail(400, 'invalid_email');
  if (await L.rateLimited('wl', req, 8, 3600)) return fail(429, 'rate_limited');

  // Reserve a unique referral code, then claim the email atomically with HSETNX
  // so a double-submit can never create two entries.
  let code = null;
  for (let i = 0; i < 5 && !code; i++) {
    const candidate = L.randomCode();
    const [ok] = await L.redis(['SET', `wl:c:${candidate}`, email, 'NX']);
    if (ok) code = candidate;
  }
  if (!code) throw new Error('could not allocate referral code');

  const userKey = `wl:u:${email}`;
  const [claimed] = await L.redis(['HSETNX', userKey, 'code', code]);
  if (!claimed) {
    await L.redis(['DEL', `wl:c:${code}`]);
    // Already on the list. Don't reveal their position or code to whoever typed
    // the address; re-send it to the inbox instead (at most every 15 minutes).
    const [flat, fresh] = await L.redis(['HGETALL', userKey], ['SET', `wl:resent:${email}`, 1, 'EX', 900, 'NX']);
    if (fresh) await sendWelcome(email, L.toObject(flat)).catch((e) => console.error('[waitlist] resend', e));
    return form ? L.redirect(res, '/?wl_existing=1#waitlist') : L.json(res, 200, { ok: true, existing: true });
  }

  let referrer = '';
  const refCode = String(b.ref || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (refCode) {
    const [r] = await L.redis(['GET', `wl:c:${refCode}`]);
    if (r && r !== email) referrer = r;
  }

  const token = L.randomToken();
  const [seq] = await L.redis(['INCR', 'wl:seq']);
  await L.redis(
    ['HSET', userKey,
      'seq', seq,
      'created', new Date().toISOString(),
      'ref', referrer,
      'utm', String(b.utm || '').slice(0, 300),
      'source', String(b.source || '').slice(0, 40),
      'confirmed', 0,
      'refs', 0,
      'token', token],
    ['SET', `wl:t:${token}`, email],
    ['ZADD', 'wl:q', seq, email]
  );
  const [rank, total] = await L.redis(['ZRANK', 'wl:q', email], ['ZCARD', 'wl:q']);

  let emailSent = true;
  try {
    await sendWelcome(email, { code, token, confirmed: '0' });
  } catch (e) {
    emailSent = false;
    console.error('[waitlist] confirmation email failed', e);
  }

  if (form) return L.redirect(res, `/?joined=${code}#waitlist`);
  return L.json(res, 201, {
    ok: true, code, emailSent,
    position: rank + 1, total,
    boost: BOOST,
    referralUrl: referralUrl(code)
  });
}

async function status(req, res) {
  if (!L.hasRedis()) return L.json(res, 503, { error: 'not_configured' });
  const code = String(req.query.code || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);

  if (!code) {
    const [confirmed, total] = await L.redis(['GET', 'wl:confirmed'], ['ZCARD', 'wl:q']);
    return L.json(res, 200, { confirmed: Number(confirmed || 0), total: Number(total || 0) }, 60);
  }

  const [email] = await L.redis(['GET', `wl:c:${code}`]);
  if (!email) return L.json(res, 404, { error: 'not_found' });
  const [flat, rank, total] = await L.redis(['HGETALL', `wl:u:${email}`], ['ZRANK', 'wl:q', email], ['ZCARD', 'wl:q']);
  const u = L.toObject(flat);
  return L.json(res, 200, {
    code,
    position: rank == null ? null : rank + 1,
    total: Number(total || 0),
    refs: Number(u.refs || 0),
    confirmed: u.confirmed === '1',
    boost: BOOST,
    referralUrl: referralUrl(code)
  });
}

function referralUrl(code) { return `${L.SITE_URL}/?ref=${code}`; }

async function sendWelcome(email, user) {
  const link = referralUrl(user.code);
  const confirmUrl = `${L.SITE_URL}/api/confirm?token=${user.token}`;
  const unsubUrl = `${L.SITE_URL}/api/unsubscribe?token=${user.token}`;
  const confirmed = user.confirmed === '1';

  const subject = confirmed ? 'Your MyValue referral link' : 'Confirm your spot on the MyValue waitlist';
  const html = L.emailLayout(
    (confirmed
      ? `<p style="font-size:16px;line-height:1.6;margin:0 0 20px">You're confirmed on the MyValue waitlist.</p>`
      : `<p style="font-size:16px;line-height:1.6;margin:0 0 24px">Tap below to confirm your spot on the MyValue waitlist.</p>
         <p style="margin:0 0 28px">${L.button(confirmUrl, 'Confirm my spot')}</p>`) +
    `<p style="font-size:15px;line-height:1.6;margin:0 0 8px">Every friend who joins with your link and confirms moves you up ${BOOST} spots:</p>
     <p style="font-size:15px;margin:0"><a href="${L.esc(link)}" style="color:#000">${L.esc(link)}</a></p>`,
    `You're receiving this because this address was entered on the MyValue waitlist at getmyvalue.app. ` +
    (confirmed ? '' : `Didn't sign up? Ignore this email and you won't be added. `) +
    `<a href="${L.esc(unsubUrl)}" style="color:#6b6b6b">Unsubscribe</a>.`
  );
  const text = (confirmed ? `You're confirmed on the MyValue waitlist.\n\n` : `Confirm your spot on the MyValue waitlist:\n${confirmUrl}\n\n`) +
    `Every friend who joins with your link and confirms moves you up ${BOOST} spots:\n${link}\n\nUnsubscribe: ${unsubUrl}\n` +
    (process.env.MAIL_POSTAL_ADDRESS ? `\nMyValue · ${process.env.MAIL_POSTAL_ADDRESS}\n` : '');

  await L.sendMail({
    to: email, subject, html, text,
    headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
  });
}

module.exports.sendWelcome = sendWelcome;
module.exports.BOOST = BOOST;
