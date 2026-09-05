import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'YaFact',
        short_name: 'YaFact',
        description: 'Facturá en segundos, sin planillas ni vueltas.',
        lang: 'es-AR',
        theme_color: '#F26A1B',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // NO cacheamos el HTML: las navegaciones van SIEMPRE a la red, así el
        // index.html es siempre el último y nunca queda apuntando a un JS viejo
        // (evita la pantalla en blanco tras un deploy). Solo cacheamos estáticos
        // con hash (inmutables). Sigue siendo instalable.
        globPatterns: ['**/*.{js,css,svg,png,ico,woff,woff2}'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
})
