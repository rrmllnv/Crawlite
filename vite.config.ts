import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  publicDir: path.resolve(__dirname, 'public'),
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    rollupOptions: {
      input: path.resolve(__dirname, 'src/index.html'),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: path.resolve(__dirname, 'electron/main.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron'),
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron'),
          },
        },
      },
      renderer: process.env.NODE_ENV === 'test'
        ? undefined
        : {},
    }),
  ],
  css: {
    devSourcemap: true,
    preprocessorOptions: {
      scss: {
        additionalData: (source: string) => {
          const variablesPath = path.resolve(__dirname, 'src/styles/variables.scss')
          const normalizedPath = variablesPath.replace(/\\/g, '/')
          return `@use "${normalizedPath}" as *;\n${source}`
        },
        loadPaths: [path.resolve(__dirname, 'src')],
        silenceDeprecations: ['legacy-js-api', 'import'],
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})

