const express = require('express');
const router = express.Router();

const documentsRouter = require('./documents');
const uploadRouter = require('./upload');
const tagsRouter = require('./tags');
const readerRouter = require('./reader');
const codeAnalysisRouter = require('./code-analysis');
const sshServersRouter = require('./ssh-servers');
const authRouter = require('./auth-users');
const trackerRouter = require('./tracker');

router.use('/documents', documentsRouter);
router.use('/upload', uploadRouter);
router.use('/tags', tagsRouter);
router.use('/reader', readerRouter);
router.use('/code-analysis', codeAnalysisRouter);
router.use('/ssh-servers', sshServersRouter);
router.use('/auth', authRouter);
router.use('/tracker', trackerRouter);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
