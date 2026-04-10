module.exports = {
  apps: [
    {
      name: 'ngupi-backend',
      script: 'src/index.js',
      cwd: '/Users/acidjp/.openclaw/workspace-sobatngupi/backend',
      interpreter: '/Users/acidjp/.nvm/versions/node/v22.20.0/bin/node',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/Users/acidjp/.openclaw/workspace-sobatngupi/backend/logs/error.log',
      out_file: '/Users/acidjp/.openclaw/workspace-sobatngupi/backend/logs/out.log',
      merge_logs: true,
      autorestart: true
    },
    {
      name: 'ngupi-ngrok',
      script: '/opt/homebrew/bin/ngrok',
      args: 'http --url=ngupingupi.me 3001',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};
