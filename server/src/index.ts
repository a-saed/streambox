import 'dotenv/config';
import { app } from './app';
import { initCache } from './cache';

const PORT = process.env.PORT ?? 3001;

async function start() {
  // Listen immediately so fly.io health checks pass; cache warms in background
  const server = app.listen(PORT, () =>
    console.log(`[server] Listening on http://localhost:${PORT}`)
  );
  initCache().catch(err => console.error('[cache] Init failed:', err));

  const shutdown = () => {
    server.closeAllConnections(); // destroy open sockets immediately (Node 18.2+)
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
