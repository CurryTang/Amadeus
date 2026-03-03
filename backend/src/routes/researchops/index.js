'use strict';

const express = require('express');
const router = express.Router();
const resHelpers = require('../../middleware/res-helpers');
const { requireAuth } = require('../../middleware/auth');

router.use(resHelpers);
router.use(requireAuth);

// Health check
router.get('/health', (req, res) => res.ok({ status: 'ok' }));

// Sub-routers are mounted here as domain files are created:
// router.use('/', require('./runs'));
// router.use('/', require('./projects'));
// router.use('/', require('./knowledge'));
// router.use('/', require('./autopilot'));
// router.use('/', require('./dashboard'));
// router.use('/', require('./admin'));

module.exports = router;
