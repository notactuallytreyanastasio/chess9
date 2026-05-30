import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// Builds the SAME UI, but with its core swapped for the Temper-generated engine via the
// shim. The UI imports `../core/index` unchanged; this alias redirects that to the shim at
// bundle time (a runtime swap), and viteSingleFile inlines the Temper runtime into one HTML.
// Requires `temper build --backend js` to have produced temper_port/chess9/temper.out/js.
const shim = fileURLToPath(new URL('./temper_port/shim/core.mjs', import.meta.url));

export default defineConfig({
  plugins: [viteSingleFile()],
  resolve: {
    alias: [{ find: /^\.\.\/core\/index$/, replacement: shim }],
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    outDir: 'dist-temper',
    emptyOutDir: true,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
