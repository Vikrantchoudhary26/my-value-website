// POST /api/contact { name, email, message, company? (honeypot) }
// Contact / support form → forwards to CONTACT_TO with Reply-To set to the sender.
// Accepts JSON (fetch) or a plain HTML form post (no-JS fallback → 303 redirect).

const L = require('./_lib');

module.exports = async (req, res) => {
  const form = L.isFormPost(req);
  const done = (status, data) => (form ? L.redirect(res, `/contact?${data.ok ? 'sent=1' : `error=${data.error}`}#contact-form`) : L.json(res, status, data));
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { error: 'method_not_allowed' }); }
    if (!L.hasMail() || !L.hasRedis() || !process.env.CONTACT_TO) return done(503, { error: 'not_configured' });
    const b = L.body(req);
    if (b.company) return done(400, { error: 'invalid' });
    const email = L.normalizeEmail(b.email);
    const name = String(b.name || '').trim().slice(0, 120);
    const message = String(b.message || '').trim().slice(0, 5000);
    const topic = String(b.topic || 'other').replace(/[^a-z-]/g, '').slice(0, 30) || 'other';
    if (!email) return done(400, { error: 'invalid_email' });
    if (message.length < 2) return done(400, { error: 'empty_message' });
    if (await L.rateLimited('contact', req, 5, 3600)) return done(429, { error: 'rate_limited' });

    await L.sendMail({
      to: process.env.CONTACT_TO,
      replyTo: email,
      subject: `[MyValue ${topic}] ${name || email}`,
      html: `<p><b>From:</b> ${L.esc(name)} &lt;${L.esc(email)}&gt;<br><b>Topic:</b> ${L.esc(topic)}</p><p style="white-space:pre-wrap">${L.esc(message)}</p>`,
      text: `From: ${name} <${email}>\nTopic: ${topic}\n\n${message}\n`
    });
    return done(200, { ok: true });
  } catch (err) {
    console.error('[contact]', err);
    return done(500, { error: 'server_error' });
  }
};
