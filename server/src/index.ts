import 'dotenv/config';
import { app } from './app';
import { initCache } from './cache';

const PORT = process.env.PORT ?? 3001;

async function start() {
  await initCache();
  const server = app.listen(PORT, () =>
    console.log(`[server] Listening on http://localhost:${PORT}`)
  );

  const shutdown = () => {
    server.closeAllConnections(); // destroy open sockets immediately (Node 18.2+)
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
