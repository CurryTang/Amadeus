const express = require('express');
const router = express.Router();
const keypairService = require('../services/keypair.service');

const documentsRouter = require('./documents');
const uploadRouter = require('./upload');
const tagsRouter = require('./tags');
const readerRouter = require('./reader');
const codeAnalysisRouter = require('./code-analysis');
const sshServersRouter = require('./ssh-servers');
const authRouter = require('./auth-users');
const trackerRouter = require('./tracker');
const researchOpsRouter = require('./researchops/index');
const importRouter = require('./import');

router.use('/documents', documentsRouter);
router.use('/upload', uploadRouter);
router.use('/tags', tagsRouter);
router.use('/reader', readerRouter);
router.use('/code-analysis', codeAnalysisRouter);
router.use('/ssh-servers', sshServersRouter);
router.use('/auth', authRouter);
router.use('/tracker', trackerRouter);
router.use('/researchops', researchOpsRouter);
router.use('/import', importRouter);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public key endpoint — no auth required (public keys are public)
// Used for the one-liner: curl https://.../api/public-key >> ~/.ssh/authorized_keys
router.get('/public-key', async (req, res) => {
  const key = await keypairService.getPublicKey();
  if (!key) {
    return res.status(404).json({ error: 'Managed keypair not yet generated. Restart the server.' });
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(`${key}\n`);
});

module.exports = router;
