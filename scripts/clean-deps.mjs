/**
 * Remove installed dependencies and build artifacts across the workspace, so
 * `npm run clean:install` can rebuild from a clean slate when the node_modules
 * tree gets into a bad state (stale workspace symlinks, half-installed deps).
 *
 * Usage: node scripts/clean-deps.mjs   (or `npm run clean`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// npm workspaces keep a single root lockfile — we do NOT delete package-lock.json.
const targets = [
  'node_modules',
  'shared/node_modules',
  'shared/dist',
  'app/node_modules',
  'app/dist',
  'firebase/node_modules',
  'firebase/functions/node_modules',
  'firebase/functions/lib',
];

console.log('🧹 Cleaning node_modules and build artifacts...');
for (const rel of targets) {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) {
    try {
      fs.rmSync(full, { recursive: true, force: true });
      console.log(`  ✓ Removed ${rel}`);
    } catch (err) {
      console.warn(`  ⚠️ Could not remove ${rel}: ${err.message}`);
    }
  }
}
console.log('✨ Cleanup complete.\n');
