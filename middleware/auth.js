const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'vibmon_dev_secret_change_in_production';

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se requiere rol administrador' });
    next();
  });
}


function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try { req.user = jwt.verify(auth.slice(7), SECRET); } catch {}
  }
  if (!req.user) req.user = { role: 'viewer', username: 'Visitante' };
  next();
}

module.exports = { signToken, requireAuth, requireAdmin, optionalAuth };

