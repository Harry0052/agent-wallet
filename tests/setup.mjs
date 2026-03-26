// Prevent `server-only` from throwing in the Node.js test runner.
// Must run synchronously via --import before any test files load.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve('server-only');
const original = readFileSync(serverOnlyPath, 'utf8');
const STUB = '/* stubbed for test runner */\n';

if (original.includes('throw new Error')) {
  writeFileSync(serverOnlyPath, STUB, 'utf8');

  // Restore on clean exit
  const restore = () => {
    try {
      const current = readFileSync(serverOnlyPath, 'utf8');
      if (current === STUB) {
        writeFileSync(serverOnlyPath, original, 'utf8');
      }
    } catch { /* best effort */ }
  };
  process.on('exit', restore);
  process.on('SIGINT', () => { restore(); process.exit(130); });
  process.on('SIGTERM', () => { restore(); process.exit(143); });
}
