import { initDb, migrate, closeDb, dialect, engine } from '../src/lib/db.js';

await initDb();
await migrate();
console.log(`Migration complete (${dialect}/${engine})`);
await closeDb();
