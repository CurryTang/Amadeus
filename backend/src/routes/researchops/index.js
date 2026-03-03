'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const resHelpers = require('../../middleware/res-helpers');
const { requireAuth } = require('../../middleware/auth');

router.use(resHelpers);

// Serve OpenAPI spec — no auth required
router.get('/openapi', (req, res) => {
  try {
    const specPath = path.resolve(__dirname, '../../../openapi.yaml');
    const raw = fs.readFileSync(specPath, 'utf8');
    const spec = yaml.load(raw);
    return res.json(spec);
  } catch (err) {
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load OpenAPI spec' } });
  }
});

router.use(requireAuth);

// Health check
router.get('/health', (req, res) => res.ok({ status: 'ok' }));

// Sub-routers are mounted here as domain files are created:
router.use('/', require('./runs'));
router.use('/', require('./projects'));
router.use('/', require('./knowledge'));
router.use('/', require('./autopilot'));
router.use('/', require('./dashboard'));
router.use('/', require('./admin'));

module.exports = router;
