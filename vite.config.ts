import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Stamps the built service worker with the list of files to precache, so the
// whole app loads offline after the first visit.
function precache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'blind-score-precache',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) walk(p);
          else files.push('./' + relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== './sw.js');
      const version = String(
        list.reduce((h, f) => (h * 31 + statSync(join(outDir, f)).size + f.length) >>> 0, 7),
      );
      const swPath = join(outDir, 'sw.js');
      writeFileSync(
        swPath,
        readFileSync(swPath, 'utf8')
          .replace('__PRECACHE__', JSON.stringify(['./', ...list]))
          .replace('__VERSION__', version),
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), precache()],
  test: { environment: 'node' },
});
