import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import prefixSelector from 'postcss-prefix-selector'
import { buildProvenance } from '../scripts/build-provenance.mjs'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  appType: 'mpa',
  envPrefix: [],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [buildProvenance('report-center'), tailwindcss(), {
    name: 'report-center-dependency-notices',
    generateBundle() {
      for (const dependency of ['react', 'react-dom', 'lucide-react', 'tailwindcss']) {
        this.emitFile({ type: 'asset', fileName: `licenses/${dependency}.LICENSE.txt`,
          source: readFileSync(new URL(`./node_modules/${dependency}/LICENSE`, import.meta.url), 'utf8') })
      }
    },
  }],
  css: { postcss: { plugins: [{
    postcssPlugin: 'report-center-property-namespace',
    Declaration(declaration) {
      declaration.prop = declaration.prop.replaceAll('--tw-', '--report-tw-')
      declaration.value = declaration.value.replaceAll('--tw-', '--report-tw-')
    },
    AtRule(rule) {
      if (rule.name === 'property') rule.params = rule.params.replaceAll('--tw-', '--report-tw-')
    },
  }, prefixSelector({
    prefix: '.saas-report-center',
    transform(prefix, selector, prefixed) {
      if (selector.includes('.saas-report-center')) return selector
      if (selector === ':root' || selector === ':host') return prefix
      return prefixed
    },
  })] } },
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('./src/entry.ts', import.meta.url)),
      name: 'report-center', formats: ['umd'], fileName: () => 'report-center.umd.js',
      cssFileName: 'report-center',
    },
    // A single classic entry avoids native ESM/module scripts in qiankun 2.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  server: { host: '127.0.0.1', port: 3009, strictPort: true, cors: true },
  preview: { host: '127.0.0.1', port: 3009, strictPort: true, cors: true },
})
