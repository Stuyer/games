import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(import.meta.dirname);
const staticEntries = [
  'favicons',
  'svg',
  'robots.txt',
  'site.webmanifest',
  'sitemap.xml',
  'supabase-config.js',
  'CNAME',
  'yandex_8a99cd3e800b18ac.html'
];

function copyStaticSiteFiles() {
  return {
    name: 'copy-static-site-files',
    closeBundle() {
      const output = resolve(root, 'dist');
      for (const entry of staticEntries) {
        const source = resolve(root, entry);
        if (existsSync(source)) cpSync(source, resolve(output, entry), { recursive: true });
      }
      const faviconsSource = resolve(root, 'favicons');
      const assetsFavicons = resolve(output, 'assets/favicons');
      if (existsSync(faviconsSource)) cpSync(faviconsSource, assetsFavicons, { recursive: true });
    }
  };
}

function extensionlessPageRoutes() {
  const routes = [
    ['add-game', 'add-game.html'],
    ['stats', 'stats.html'],
    ['submissions', 'submissions.html'],
    ['moderation', 'moderation/index.html']
  ];
  return {
    name: 'extensionless-page-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url) {
          const url = new URL(req.url, 'http://vite.local');
          const route = routes.find(([path]) => url.pathname === `/${path}` || url.pathname === `/${path}/`);
          if (route) {
            url.pathname = `/${route[1]}`;
            req.url = `${url.pathname}${url.search}`;
          }
        }
        next();
      });
    },
    closeBundle() {
      const output = resolve(root, 'dist');
      for (const [route, source] of routes) {
        const sourceFile = resolve(output, source);
        if (!existsSync(sourceFile)) continue;
        const targetFile = resolve(output, route, 'index.html');
        if (sourceFile !== targetFile) {
          cpSync(sourceFile, targetFile, { recursive: true });
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), copyStaticSiteFiles(), extensionlessPageRoutes()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        'add-game': resolve(root, 'add-game.html'),
        stats: resolve(root, 'stats.html'),
        submissions: resolve(root, 'submissions.html'),
        moderation: resolve(root, 'moderation/index.html')
      },
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'motion-vendor': ['framer-motion'],
          'chart-vendor': ['chart.js'],
          'supabase-vendor': ['@supabase/supabase-js']
        }
      }
    }
  }
});
