import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    resolve: {
      alias: {
        '@': resolve(__dirname, '.'),
      },
      conditions: ['browser', 'module', 'import', 'default'],
    },
    define: {
      'import.meta.env.VITE_DASHSCOPE_API_KEY': JSON.stringify(env.VITE_DASHSCOPE_API_KEY || ''),
      'import.meta.env.VITE_DASHSCOPE_BASE_URL': JSON.stringify(env.VITE_DASHSCOPE_BASE_URL || ''),
      'import.meta.env.VITE_DASHSCOPE_MODEL': JSON.stringify(env.VITE_DASHSCOPE_MODEL || ''),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'esnext',
      minify: false,
      sourcemap: true,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'popup/index.html'),
          background: resolve(__dirname, 'background/index.ts'),
        },
        external: ['chrome', /^node:/],
        output: {
          entryFileNames: (chunkInfo) => {
            if (chunkInfo.name === 'background') {
              return 'background/index.js';
            }
            return '[name]/[name].js';
          },
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name && assetInfo.name.endsWith('.css')) {
              return 'popup/popup.css';
            }
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
    plugins: [
      {
        name: 'copy-manifest',
        closeBundle() {
          const distDir = resolve(__dirname, 'dist');
          mkdirSync(distDir, { recursive: true });

          // Copy manifest.json
          copyFileSync(
            resolve(__dirname, 'manifest.json'),
            resolve(distDir, 'manifest.json')
          );

          // Copy popup CSS
          const popupCssSrc = resolve(__dirname, 'popup/popup.css');
          const popupCssDest = resolve(distDir, 'popup/popup.css');
          if (existsSync(popupCssSrc)) {
            mkdirSync(resolve(distDir, 'popup'), { recursive: true });
            copyFileSync(popupCssSrc, popupCssDest);
          }

          // Copy icons
          const iconsDir = resolve(__dirname, 'icons');
          const distIconsDir = resolve(distDir, 'icons');
          if (existsSync(iconsDir)) {
            mkdirSync(distIconsDir, { recursive: true });
            const iconFiles = readdirSync(iconsDir).filter(
              (f) => f.endsWith('.png') || f.endsWith('.svg')
            );
            for (const file of iconFiles) {
              copyFileSync(
                resolve(iconsDir, file),
                resolve(distIconsDir, file)
              );
            }
          }
        },
      },
    ],
  };
});
