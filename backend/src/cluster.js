const cluster = require('cluster');
const os = require('os');

if (cluster.isPrimary) {
  const numWorkers = parseInt(process.env.WEB_CONCURRENCY) || Math.min(os.cpus().length, 4);
  console.log(`[Cluster] Starting ${numWorkers} workers...`);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork({ WORKER_ID: String(i) });
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[Cluster] Worker ${worker.process.pid} died (${signal || code}), restarting...`);
    cluster.fork({ WORKER_ID: String(worker.id % numWorkers) });
  });
} else {
  require('./index.js');
}
