import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () =>
  console.log(`[server] Running on http://localhost:${PORT}`)
);
