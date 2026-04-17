// pm2 config for search-surface. On pu2: `pm2 start ecosystem.config.cjs`.
module.exports = {
  apps: [
    {
      name: 'search-api',
      cwd: __dirname + '/server',
      script: 'index.js',
      env: {
        NODE_ENV: 'production',
        API_PORT: 4078,
        PLATFORM_ADMIN_EMAILS: 'ewan@wispayr.online',
      },
      max_memory_restart: '512M',
    },
    {
      name: 'search-web',
      cwd: __dirname + '/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 4077',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
    },
  ],
};
