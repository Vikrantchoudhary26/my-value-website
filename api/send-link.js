// POST /api/send-link { email }
// Live mode, desktop visitors: email the App Store link to the visitor's phone.
// The address is used once to send this email and is not stored.

const L = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { error: 'method_not_allowed' }); }
    const url = process.env.APP_STORE_URL;
    if (!L.hasMail() || !L.hasRedis() || !url) return L.json(res, 503, { error: 'not_configured' });
    const b = L.body(req);
    if (b.company) return L.json(res, 400, { error: 'invalid' });
    const email = L.normalizeEmail(b.email);
    if (!email) return L.json(res, 400, { error: 'invalid_email' });
    if (await L.rateLimited('sendlink', req, 5, 3600)) return L.json(res, 429, { error: 'rate_limited' });

    await L.sendMail({
      to: email,
      subject: 'Your MyValue download link',
      html: L.emailLayout(
        `<p style="font-size:16px;line-height:1.6;margin:0 0 24px">Open this on your iPhone to get MyValue.</p><p style="margin:0">${L.button(url, 'Download on the App Store')}</p>`,
        "You're receiving this one-time email because this address was entered on getmyvalue.app. We haven't added you to any list."
      ),
      text: `Open this on your iPhone to get MyValue:\n${url}\n`
    });
    return L.json(res, 200, { ok: true });
  } catch (err) {
    console.error('[send-link]', err);
    return L.json(res, 500, { error: 'server_error' });
  }
};
