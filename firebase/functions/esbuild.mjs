import * as esbuild from 'esbuild'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

// Mark all runtime dependencies and Node built-ins as external.
// @pasdiu/shared is in devDependencies and will be inlined.
const externalDependencies = [
  ...Object.keys(pkg.dependencies || {}),
  'firebase-admin/*',
  'firebase-functions/*',
]

const isWatch = process.argv.includes('--watch')

const buildOptions = {
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external: externalDependencies,
  banner: {
    // Inject require shim for any legacy CJS imports if needed
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
}

if (isWatch) {
  const ctx = await esbuild.context(buildOptions)
  await ctx.watch()
  console.log('⚡ Watching Cloud Functions build...')
} else {
  await esbuild.build(buildOptions)
  console.log('✔ Cloud Functions built to lib/index.js (with @pasdiu/shared inlined)')
}
