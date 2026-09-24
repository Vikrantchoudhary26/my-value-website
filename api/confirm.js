// GET /api/confirm?token=<token>
// Double opt-in confirmation link from the waitlist email. Idempotent: the
// first click confirms and credits the referrer; later clicks just redirect.

const L = require('./_lib');
const { BOOST } = require('./waitlist');

module.exports = async (req, res) => {
  try {
    if (!L.hasRedis()) return L.redirect(res, '/?confirmed=error#waitlist');
    const token = String(req.query.token || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
    const [email] = token ? await L.redis(['GET', `wl:t:${token}`]) : [null];
    if (!email) return L.redirect(res, '/?confirmed=invalid#waitlist');

    const userKey = `wl:u:${email}`;
    // HSETNX is the atomic "first click wins" guard.
    const [first, flat] = await L.redis(['HSETNX', userKey, 'confirmedAt', new Date().toISOString()], ['HGETALL', userKey]);
    const u = L.toObject(flat);
    if (first) {
      const cmds = [['HSET', userKey, 'confirmed', 1], ['INCR', 'wl:confirmed']];
      if (u.ref) cmds.push(['ZINCRBY', 'wl:q', -BOOST, u.ref], ['HINCRBY', `wl:u:${u.ref}`, 'refs', 1]);
      await L.redis(...cmds);
    }
    return L.redirect(res, `/?confirmed=1&code=${encodeURIComponent(u.code || '')}#waitlist`);
  } catch (err) {
    console.error('[confirm]', err);
    return L.redirect(res, '/?confirmed=error#waitlist');
  }
};
