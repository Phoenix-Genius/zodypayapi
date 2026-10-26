import { loadConfig } from '../config.js';
import { createDb, runMigrations } from './index.js';

const { db, close } = await createDb(loadConfig().DATABASE_URL);
await runMigrations(db);
close();
console.log('Migrations applied');
