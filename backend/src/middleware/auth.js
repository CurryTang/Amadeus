const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Ensure both strings are the same length for comparison
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    // Still do a comparison to maintain constant time
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Hash token with salt for comparison
 * This adds an extra layer of security - even if someone sees the hashed value,
 * they can't easily reverse it to get the original token
 */
function hashToken(token) {
  const salt = config.auth.salt || 'auto-reader-default-salt';
  return crypto.createHash('sha256').update(token + salt).digest('hex');
}

/**
 * Authentication middleware
 * Checks for Authorization header with Bearer token
 * Allows Chrome extension requests without auth (origin: chrome-extension://*)
 *
 * Usage:
 *   router.post('/protected', requireAuth, handler)
 *   router.use(requireAuth) // protect all routes in router
 */
function requireAuth(req, res, next) {
  // If auth is disabled, allow all requests
  if (!config.auth.enabled) {
    req.userId = 'czk';
    req.isAuthenticated = true;
    return next();
  }

  // Try Bearer JWT
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      try {
        const payload = jwt.verify(parts[1], config.auth.jwtSecret);
        req.userId = payload.username;
        req.isAuthenticated = true;
        return next();
      } catch { /* fall through */ }

      // Legacy: compare against ADMIN_TOKEN (for backward compat)
      const expectedToken = config.auth.adminToken;
      if (expectedToken) {
        const providedHash = hashToken(parts[1]);
        const expectedHash = hashToken(expectedToken);
        if (timingSafeEqual(providedHash, expectedHash)) {
          req.userId = 'czk';
          req.isAuthenticated = true;
          return next();
        }
      }
    }
  }

  // Try cookie (web app + extension shared session)
  const cookieToken = req.cookies?.auth_token;
  if (cookieToken) {
    try {
      const payload = jwt.verify(cookieToken, config.auth.jwtSecret);
      req.userId = payload.username;
      req.isAuthenticated = true;
      return next();
    } catch { /* expired/invalid */ }
  }

  return res.status(401).json({
    error: 'Authentication required',
    message: 'Please log in'
  });
}

/**
 * Optional auth middleware
 * Sets req.isAuthenticated but doesn't block the request
 * Useful for endpoints that behave differently for authenticated users
 */
function optionalAuth(req, res, next) {
  if (!config.auth.enabled) {
    req.userId = 'czk';
    req.isAuthenticated = true;
    return next();
  }

  // Try Bearer JWT
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      try {
        const payload = jwt.verify(parts[1], config.auth.jwtSecret);
        req.userId = payload.username;
        req.isAuthenticated = true;
        return next();
      } catch { /* fall through */ }

      const expectedToken = config.auth.adminToken;
      if (expectedToken) {
        const providedHash = hashToken(parts[1]);
        const expectedHash = hashToken(expectedToken);
        if (timingSafeEqual(providedHash, expectedHash)) {
          req.userId = 'czk';
          req.isAuthenticated = true;
          return next();
        }
      }
    }
  }

  // Try cookie
  const cookieToken = req.cookies?.auth_token;
  if (cookieToken) {
    try {
      const payload = jwt.verify(cookieToken, config.auth.jwtSecret);
      req.userId = payload.username;
      req.isAuthenticated = true;
      return next();
    } catch { /* expired/invalid */ }
  }

  req.isAuthenticated = false;
  next();
}

/**
 * Verify token endpoint handler
 * Returns whether the provided token is valid
 */
function verifyToken(req, res) {
  if (!config.auth.enabled) {
    return res.json({ valid: true, authEnabled: false });
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.json({ valid: false, authEnabled: true });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.json({ valid: false, authEnabled: true });
  }

  const providedToken = parts[1];
  const expectedToken = config.auth.adminToken;

  if (!expectedToken) {
    return res.json({ valid: false, authEnabled: true, error: 'Token not configured' });
  }

  const providedHash = hashToken(providedToken);
  const expectedHash = hashToken(expectedToken);

  const valid = timingSafeEqual(providedHash, expectedHash);
  res.json({ valid, authEnabled: true });
}

module.exports = {
  requireAuth,
  optionalAuth,
  verifyToken,
  hashToken,
};
