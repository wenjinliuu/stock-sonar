import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '个股声呐 Stock Sonar',
        short_name: '声呐',
        lang: 'zh-CN',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // 页面导航一律走网络（先过 Cloudflare Access 登录），不用缓存的 index.html 兜底；
        // 否则缓存的外壳会绕过登录，随后 /api 请求被 Access 重定向到另一个域名而报 Load failed。
        navigateFallback: null,
        globPatterns: ['assets/**/*.{js,css}', '*.svg'],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
