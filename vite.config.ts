import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

// Plugin to copy static files and fix HTML paths after build
function chromeExtensionPlugin() {
  return {
    name: 'chrome-extension',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');

      // Copy manifest.json
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(distDir, 'manifest.json')
      );

      // Move HTML files to root of dist and fix script paths
      const htmlFiles = [
        { src: 'src/popup/popup.html', dest: 'popup.html' },
        { src: 'src/offscreen/offscreen.html', dest: 'offscreen.html' },
        { src: 'src/preview/preview.html', dest: 'preview.html' }
      ];

      for (const { src, dest } of htmlFiles) {
        const srcPath = resolve(distDir, src);
        const destPath = resolve(distDir, dest);

        if (existsSync(srcPath)) {
          let content = readFileSync(srcPath, 'utf-8');
          // Fix script/link paths (remove ../../ or similar)
          content = content.replace(/href="\.\.\/\.\.\/([^"]+)"/g, 'href="$1"');
          content = content.replace(/src="\.\.\/\.\.\/([^"]+)"/g, 'src="$1"');
          // Also fix relative paths like ./popup.css
          content = content.replace(/href="\.\/([^"]+\.css)"/g, 'href="$1"');
          content = content.replace(/src="\.\/([^"]+\.js)"/g, 'src="$1"');
          writeFileSync(destPath, content);
        }
      }

      // Copy assets if they exist
      const assetsDir = resolve(distDir, 'assets');
      if (!existsSync(assetsDir)) {
        mkdirSync(assetsDir, { recursive: true });
      }

      const iconSizes = [16, 48, 128];
      for (const size of iconSizes) {
        const iconPath = resolve(__dirname, `assets/icon-${size}.png`);
        if (existsSync(iconPath)) {
          copyFileSync(iconPath, resolve(assetsDir, `icon-${size}.png`));
        }
      }
    }
  };
}

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        'service-worker': resolve(__dirname, 'src/service-worker/index.ts'),
        // Note: content-script is built separately with IIFE format
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        preview: resolve(__dirname, 'src/preview/preview.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return '[name].[ext]';
          }
          return 'assets/[name].[ext]';
        }
      }
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV === 'development',
    target: 'esnext',
    minify: false
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [chromeExtensionPlugin()]
});
