import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Emits ONE self-contained dist/index.html with all JS/CSS inlined and no
// external requests — droppable anywhere (e.g. as a Claude artifact).
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
