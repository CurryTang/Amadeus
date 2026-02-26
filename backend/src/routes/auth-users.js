const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');

const COOKIE_NAME = 'auth_token';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

function setCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
  };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT id, username, password_hash FROM users WHERE username = ?`,
      args: [username],
    });

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { username: user.username, userId: user.username },
      config.auth.jwtSecret,
      { expiresIn: '30d' }
    );

    // Set persistent HttpOnly cookie (30 days)
    res.cookie(COOKIE_NAME, token, setCookieOptions());

    res.json({ token, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT username, tracker_onboarding_seen FROM users WHERE username = ?`,
      args: [req.userId],
    });
    const user = result.rows[0];
    res.json({
      username: req.userId,
      trackerOnboardingSeen: Number(user?.tracker_onboarding_seen) === 1,
    });
  } catch (err) {
    console.error('Auth /me error:', err);
    res.status(500).json({ error: 'Failed to load current user' });
  }
});

// POST /api/auth/tracker-onboarding/seen
router.post('/tracker-onboarding/seen', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.execute({
      sql: `UPDATE users SET tracker_onboarding_seen = 1 WHERE username = ?`,
      args: [req.userId],
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Auth tracker onboarding seen error:', err);
    res.status(500).json({ error: 'Failed to update onboarding status' });
  }
});

// GET /api/auth/verify  (kept for frontend AuthContext compatibility)
router.get('/verify', (req, res) => {
  if (!config.auth.enabled) {
    return res.json({ valid: true, authEnabled: false });
  }

  // Accept Bearer token or cookie
  let tokenToVerify = null;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') tokenToVerify = parts[1];
  }
  if (!tokenToVerify && req.cookies?.[COOKIE_NAME]) {
    tokenToVerify = req.cookies[COOKIE_NAME];
  }

  if (!tokenToVerify) return res.json({ valid: false, authEnabled: true });

  try {
    jwt.verify(tokenToVerify, config.auth.jwtSecret);
    return res.json({ valid: true, authEnabled: true });
  } catch {
    return res.json({ valid: false, authEnabled: true });
  }
});

module.exports = router;
