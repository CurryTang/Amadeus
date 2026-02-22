const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const config = require('./config');
const routes = require('./routes');
const { initDatabase } = require('./db');

// Import reader services (for scheduler integration)
const schedulerService = require('./services/scheduler.service');
const readerService = require('./services/reader.service');
const pdfService = require('./services/pdf.service');
const codeAnalysisService = require('./services/code-analysis.service');
const aiEditService = require('./services/ai-edit.service');
const paperTrackerService = require('./services/paper-tracker.service');

const app = express();

// Trust proxy (nginx) so rate limiter reads X-Forwarded-For correctly
app.set('trust proxy', 1);

// CORS must be before helmet/rate-limiting so preflight OPTIONS gets proper headers
app.use(
  cors({
    origin: config.cors.origin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Compression middleware
app.use(compression());

// Cookie parser (needed for HttpOnly cookie auth)
app.use(cookieParser());

// Security middleware - disable crossOriginResourcePolicy for API access
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Rate limiting - prevent abuse (configurable via config/index.js)
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.general.windowMs,
  max: config.rateLimit.general.max,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Paper/document analysis rate limit
const paperAnalysisLimiter = rateLimit({
  windowMs: config.rateLimit.paperAnalysis.windowMs,
  max: config.rateLimit.paperAnalysis.max,
  message: { error: 'Paper analysis rate limit exceeded. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Code analysis rate limit
const codeAnalysisLimiter = rateLimit({
  windowMs: config.rateLimit.codeAnalysis.windowMs,
  max: config.rateLimit.codeAnalysis.max,
  message: { error: 'Code analysis rate limit exceeded. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Upload rate limit
const uploadLimiter = rateLimit({
  windowMs: config.rateLimit.upload.windowMs,
  max: config.rateLimit.upload.max,
  message: { error: 'Upload rate limit exceeded. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limit to all requests
app.use(generalLimiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply specific rate limits to expensive operations
app.use('/api/reader/process', paperAnalysisLimiter);
app.use('/api/code-analysis', codeAnalysisLimiter);
app.use('/api/upload', uploadLimiter);

// API routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Auto Reader API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      documents: '/api/documents',
      upload: '/api/upload',
      reader: '/api/reader',
      codeAnalysis: '/api/code-analysis',
      tags: '/api/tags',
      researchOps: '/api/researchops',
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Initialize database and start server
async function startServer() {
  try {
    await initDatabase();
    console.log('Connected to Turso database');

    // Clean up any leftover temp files from previous sessions
    // All raw files should only be stored in S3, not on the server
    await pdfService.cleanupAllTmpFiles();

    // Initialize document reader scheduler (only on primary worker in cluster mode)
    const isPrimaryWorker = !process.env.WORKER_ID || process.env.WORKER_ID === '0';
    if (config.reader?.enabled && isPrimaryWorker) {
      schedulerService.setReaderService(readerService);
      schedulerService.start();
      console.log('Document reader scheduler started');

      // Start code analysis processor
      codeAnalysisService.startProcessor();
      console.log('Code analysis processor started');

      // Start AI edit processor
      aiEditService.startProcessor();
      console.log('AI edit processor started');
    } else {
      console.log('Document reader is disabled');
    }

    // Start paper tracker scheduler (only when enabled on this node)
    if (isPrimaryWorker && config.tracker?.enabled) {
      const trackerIntervalMs = parseInt(process.env.TRACKER_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10);
      paperTrackerService.start(trackerIntervalMs);
      console.log('Paper tracker scheduler started');
    } else if (isPrimaryWorker) {
      console.log('Paper tracker scheduler is disabled on this node');
    }

    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  schedulerService.stop();
  codeAnalysisService.stopProcessor();
  aiEditService.stopProcessor();
  paperTrackerService.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  schedulerService.stop();
  codeAnalysisService.stopProcessor();
  aiEditService.stopProcessor();
  paperTrackerService.stop();
  process.exit(0);
});

startServer();
