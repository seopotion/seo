import { runScheduler } from './generation-scheduler';

// Local one-shot: `npm run scheduler:local -w worker` after `docker compose up -d`.
const count = await runScheduler();
console.log(`[scheduler] enqueued ${count} generation task(s)`);
process.exit(0);
