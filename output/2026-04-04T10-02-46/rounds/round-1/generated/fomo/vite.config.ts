import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    resolve: {
      alias: {
        '@': resolve(__dirname, '.'),
      },
      conditions: ['browser', 'module', 'main'],
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
        output: {
          entryFileNames: (chunkInfo) => {
            if (chunkInfo.name === 'background') {
              return 'background/index.js';
            }
            return '[name]/[name].js';
          },
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith('.css')) {
              return 'popup/popup.css';
            }
            return 'assets/[name]-[hash][extname]';
          },
        },
        external: ['chrome', /^node:/],
      },
    },
    define: {
      'import.meta.env.VITE_DASHSCOPE_API_KEY': JSON.stringify(
        env.VITE_DASHSCOPE_API_KEY || ''
      ),
      'import.meta.env.VITE_DASHSCOPE_BASE_URL': JSON.stringify(
        env.VITE_DASHSCOPE_BASE_URL ||
          'https://dashscope.aliyuncs.com/compatible-mode/v1'
      ),
      'import.meta.env.VITE_DASHSCOPE_MODEL': JSON.stringify(
        env.VITE_DASHSCOPE_MODEL || 'qwen-max'
      ),
    },
    plugins: [
      {
        name: 'copy-manifest',
        closeBundle() {
          const distDir = resolve(__dirname, 'dist');
          if (!existsSync(distDir)) {
            mkdirSync(distDir, { recursive: true });
          }

          // Copy manifest.json
          copyFileSync(
            resolve(__dirname, 'manifest.json'),
            resolve(distDir, 'manifest.json')
          );

          // Copy popup.css
          const popupDir = resolve(distDir, 'popup');
          if (!existsSync(popupDir)) {
            mkdirSync(popupDir, { recursive: true });
          }
          const popupCssSrc = resolve(__dirname, 'popup/popup.css');
          if (existsSync(popupCssSrc)) {
            copyFileSync(popupCssSrc, resolve(popupDir, 'popup.css'));
          }

          // Copy icons
          const iconsSrcDir = resolve(__dirname, 'icons');
          const iconsDistDir = resolve(distDir, 'icons');
          if (existsSync(iconsSrcDir)) {
            if (!existsSync(iconsDistDir)) {
              mkdirSync(iconsDistDir, { recursive: true });
            }
            const iconFiles = readdirSync(iconsSrcDir).filter(
              (f) => f.endsWith('.png') || f.endsWith('.svg')
            );
            for (const file of iconFiles) {
              copyFileSync(
                resolve(iconsSrcDir, file),
                resolve(iconsDistDir, file)
              );
            }
          }
        },
      },
    ],
  };
});
