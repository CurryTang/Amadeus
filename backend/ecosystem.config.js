module.exports = {
  apps: [
    {
      name: 'auto-reader-api',
      script: 'src/index.js',
      cwd: '/var/www/auto-researcher/backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/pm2/auto-reader-error.log',
      out_file: '/var/log/pm2/auto-reader-out.log',
      time: true,
    },
  ],
};
