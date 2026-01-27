import { defineConfig } from 'vite';
import { resolve } from 'path';

// Separate build config for content script (needs IIFE format)
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/content-scripts/extractor.ts'),
      name: 'EvidenceExtractor',
      formats: ['iife'],
      fileName: () => 'content-script.js'
    },
    outDir: 'dist',
    emptyOutDir: false, // Don't clear - main build runs first
    sourcemap: false,
    minify: false,
    rollupOptions: {
      output: {
        // Ensure all dependencies are inlined
        inlineDynamicImports: true
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
});
