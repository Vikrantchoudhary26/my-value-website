// GET|POST /api/unsubscribe?token=<token>
// One-click unsubscribe (RFC 8058) for waitlist emails. The address keeps its
// place in the queue but is flagged so no further marketing email is sent.

const L = require('./_lib');

module.exports = async (req, res) => {
  let ok = false;
  try {
    const token = String(req.query.token || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
    if (L.hasRedis() && token) {
      const [email] = await L.redis(['GET', `wl:t:${token}`]);
      if (email) {
        await L.redis(['HSET', `wl:u:${email}`, 'unsub', 1]);
        ok = true;
      }
    }
  } catch (err) {
    console.error('[unsubscribe]', err);
  }
  res.statusCode = ok ? 200 : 400;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>MyValue</title><body style="margin:0;background:#000;color:#fff;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center">
<div><p style="font-weight:700;font-size:18px">MyValue</p><p>${ok ? "You're unsubscribed. You won't get any more waitlist emails from us." : 'That unsubscribe link is invalid or expired. Reply to any of our emails and we will remove you by hand.'}</p>
<p><a href="/" style="color:#fff">Back to getmyvalue.app</a></p></div></body>`);
};
