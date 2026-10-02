// Hatter: bundle the released Crowsi access entry only; no owner ceremonies.
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
await mkdir(new URL('../.output/bin/', import.meta.url), { recursive: true })
await build({ entryPoints: [new URL('../bin/hatter-console.mjs', import.meta.url).pathname],
  outfile: new URL('../.output/bin/hatter-console.mjs', import.meta.url).pathname,
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  sourcemap: false, legalComments: 'inline', logLevel: 'warning' })
