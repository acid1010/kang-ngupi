const path = require('node:path');
const fs = require('fs');

const backendDir = __dirname;
const logsDir = path.join(backendDir, 'logs');
const envPath = path.join(backendDir, '.env');

// Load .env file manually
const envVars = {};
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim();
        envVars[key] = value;
      }
    }
  });
}

module.exports = {
  apps: [
    {
      name: 'ngupi-backend',
      script: 'src/index.js',
      cwd: backendDir,
      interpreter: process.execPath,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        ...envVars
      },
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: path.join(logsDir, 'backend-error.log'),
      out_file: path.join(logsDir, 'backend-out.log'),
      merge_logs: false,
      autorestart: true
    },
    {
      name: 'ngupi-payment-poller',
      script: 'src/payments/poll.js',
      cwd: backendDir,
      interpreter: process.execPath,
      env: {
        NODE_ENV: 'production',
        PAYMENT_POLL_INTERVAL_MS: 15000,
        ...envVars
      },
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '200M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: path.join(logsDir, 'poller-error.log'),
      out_file: path.join(logsDir, 'poller-out.log'),
      merge_logs: false,
      autorestart: true
    }
  ]
};
