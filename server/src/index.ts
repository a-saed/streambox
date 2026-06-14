import { app } from './app';
import { initCache } from './cache';

const PORT = process.env.PORT ?? 3001;

async function start() {
  await initCache();
  app.listen(PORT, () =>
    console.log(`[server] Listening on http://localhost:${PORT}`)
  );
}

start();
