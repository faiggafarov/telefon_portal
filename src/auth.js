const { randomBytes, createHash } = require('node:crypto');

const SESSION_TTL = 8 * 60 * 60 * 1000;
const publicReads = new Set(['/employees', '/domains', '/departments', '/sectors', '/positions', '/meetings']);

function createAuth(pool, { now = Date.now } = {}) {
  const sessions = new Map();
  const attempts = new Map();
  const digest = token => createHash('sha256').update(token).digest('hex');
  function issue(user) {
    for (const [key, session] of sessions) if (session.expires <= now()) sessions.delete(key);
    const token = randomBytes(32).toString('hex');
    sessions.set(digest(token), { userId: String(user.id), expires: now() + SESSION_TTL });
    return token;
  }
  function revokeUser(id) {
    for (const [key, session] of sessions) if (session.userId === String(id)) sessions.delete(key);
  }
  function limitLogin(req, res, next) {
    for (const [key, entry] of attempts) if (entry.expires <= now()) attempts.delete(key);
    const key = req.ip;
    const entry = attempts.get(key) || { count: 0, expires: now() + 15 * 60 * 1000 };
    if (entry.count >= 20) return res.status(429).json({ error: 'Çox sayda giriş cəhdi. Bir qədər sonra yenidən cəhd edin.' });
    entry.count++;
    attempts.set(key, entry);
    next();
  }
  async function guard(req, res, next) {
    if ((['GET', 'HEAD'].includes(req.method) && publicReads.has(req.path)) ||
        (req.method === 'POST' && ['/auth/login', '/employee_edit_requests'].includes(req.path))) return next();
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '');
    const key = match && digest(match[1]);
    const session = key && sessions.get(key);
    if (!session || session.expires <= now()) {
      if (key) sessions.delete(key);
      return res.status(401).json({ error: 'Admin hesabına yenidən daxil olun.' });
    }
    try {
      const result = await pool.query('SELECT id, username, role FROM portal_users WHERE id = $1 AND is_active = true', [session.userId]);
      const user = result.rows[0];
      if (!user) { sessions.delete(key); return res.status(401).json({ error: 'Sessiya etibarsızdır.' }); }
      const memberRoute = ['/auth/me', '/auth/logout'].includes(req.path);
      const isMeetingRoute = req.path === '/meetings' || req.path.startsWith('/meetings/');
      if (user.role === 'meeting_admin') {
        if (!memberRoute && !isMeetingRoute) {
          return res.status(403).json({ error: 'Bu əməliyyat üçün səlahiyyətiniz yoxdur.' });
        }
      } else if (user.role !== 'admin' && !memberRoute) {
        return res.status(403).json({ error: 'Bu əməliyyat yalnız admin üçün açıqdır.' });
      }
      req.authUser = user;
      req.sessionKey = key;
      next();
    } catch (err) {
      console.error('Session verification failed:', err.message);
      res.status(503).json({ error: 'Sessiyanı yoxlamaq mümkün olmadı.' });
    }
  }
  return { issue, revokeUser, guard, limitLogin, logout: req => sessions.delete(req.sessionKey) };
}

module.exports = { createAuth };
