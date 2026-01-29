/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    VSCODE_DEBUG?: 'true'
    VITE_DEV_SERVER_URL?: string
    VITE_PUBLIC?: string
  }
}

