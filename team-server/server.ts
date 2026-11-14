/**
 * Runs the team server (hub.ts). Environment: `HOST` (127.0.0.1), `PORT` (8791), `DB_FILE`
 * (team-data/team.sqlite under the working directory; the Docker image sets /data/team.sqlite) and `TRUST_PROXY`
 * (1 behind a reverse proxy, whose `X-Forwarded-For` then names the client).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHub } from './hub.ts';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 8791);
const DB_FILE = process.env.DB_FILE ?? 'team-data/team.sqlite';

mkdirSync(dirname(DB_FILE), { recursive: true });
const hub = createHub({ dbFile: DB_FILE, trustProxy: process.env.TRUST_PROXY === '1' });
hub.server.listen(PORT, HOST, () => console.log(`team server on http://${HOST}:${PORT} (${DB_FILE})`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void hub.close().then(() => process.exit(0)));
