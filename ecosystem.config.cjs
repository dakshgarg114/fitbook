// pm2 process list for self-hosting: `pm2 start ecosystem.config.cjs`.
// Needs Node 22.18+ (runs TypeScript directly) and a .env file in the repo root.
module.exports = {
  apps: [
    {
      name: 'fitbook',
      cwd: __dirname + '/server',
      script: 'src/index.ts',
      interpreter: 'node',
      node_args: '--env-file=../.env --disable-warning=ExperimentalWarning',
      env: { NODE_ENV: 'production', PORT: '4310' },
      max_restarts: 10,
      restart_delay: 2000,
    },
    // Optional: expose the server through a Cloudflare Tunnel.
    // Copy scripts/cloudflared.example.yml to scripts/cloudflared.yml and fill it in first.
    {
      name: 'fitbook-tunnel',
      script: 'cloudflared',
      args: `tunnel --config ${__dirname}/scripts/cloudflared.yml run fitbook`,
      interpreter: 'none',
      autorestart: true,
    },
  ],
};
