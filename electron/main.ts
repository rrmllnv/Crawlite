import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadUserConfig, saveUserConfig } from './api/UserConfig'
import { appState } from './state'
import type { BrowserBounds, CrawlStartParams } from './types'
import {
  ensureBrowserView,
  setBrowserViewVisible,
  browserNavigate,
  browserGoBack,
  browserGoForward,
  browserReload,
  setBrowserDeviceMode,
} from './api/browserView'
import { safeParseUrl } from './api/urlUtils'
import { buildSitemapUrls } from './api/sitemap'
import { suggestFilenameFromUrl, downloadToFile } from './api/download'
import { handlePageAnalyze } from './api/pageAnalyze'
import { handleResourceHead } from './api/resourceHead'
import {
  handleHighlightHeading,
  handleHighlightLink,
  handleHighlightImage,
} from './api/browserHighlight'
import { crawlStart, cancelCrawl } from './api/crawlRun'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

function createWindow(): void {
  appState.mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Crawlite',
    autoHideMenuBar: true,
  })

  const mainWindow = appState.mainWindow
  mainWindow.setMenuBarVisibility(false)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(url).catch(() => void 0)
      }
    } catch {
      void 0
    }
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  if (VITE_DEV_SERVER_URL || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools()
  }
}

ipcMain.handle('browser:ensure', async (_event, bounds: BrowserBounds) => {
  ensureBrowserView(bounds)
  return { success: true }
})

ipcMain.handle('browser:resize', async (_event, bounds: BrowserBounds) => {
  ensureBrowserView(bounds)
  return { success: true }
})

ipcMain.handle('browser:set-visible', async (_event, visible: boolean) => {
  return setBrowserViewVisible(visible)
})

ipcMain.handle('browser:navigate', async (_event, url: string) => {
  return browserNavigate(url, safeParseUrl)
})

ipcMain.handle('browser:go-back', async () => {
  return browserGoBack()
})

ipcMain.handle('browser:go-forward', async () => {
  return browserGoForward()
})

ipcMain.handle('browser:reload', async () => {
  return browserReload()
})

ipcMain.handle('browser:set-device-mode', async (_event, rawMode: unknown) => {
  return setBrowserDeviceMode(rawMode)
})

ipcMain.handle('browser:highlight-heading', async (_event, payload: { level: number; text: string }) => {
  return handleHighlightHeading(payload)
})

ipcMain.handle('browser:highlight-link', async (_event, url: string) => {
  return handleHighlightLink(url)
})

ipcMain.handle('browser:highlight-image', async (_event, url: string) => {
  return handleHighlightImage(url)
})

ipcMain.handle('page:analyze', async (_event, url: string) => {
  return handlePageAnalyze(url)
})

ipcMain.handle('resource:head', async (_event, url: string) => {
  return handleResourceHead(url)
})

ipcMain.handle(
  'sitemap:build',
  async (
    _event,
    startUrl: string,
    options?: { maxUrls?: number }
  ) => {
    const u = safeParseUrl(startUrl)
    if (!u) {
      return { success: false, error: 'Invalid URL' }
    }
    try {
      const data = await buildSitemapUrls(u.toString(), options)
      return {
        success: true,
        sitemaps: data.sitemaps,
        urls: data.urls,
        urlMetaByUrl: data.urlMetaByUrl || {},
        truncated: Boolean((data as any).truncated),
        maxUrlsUsed: typeof (data as any).maxUrlsUsed === 'number' ? (data as any).maxUrlsUsed : undefined,
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
)

ipcMain.handle('download:file', async (_event, url: string) => {
  const u = safeParseUrl(url)
  if (!u) {
    return { success: false, error: 'Invalid URL' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { success: false, error: 'Unsupported protocol' }
  }

  const suggested = suggestFilenameFromUrl(u.toString())
  const baseDir = app.getPath('downloads')
  const defaultPath = path.join(baseDir, suggested)

  const res = await dialog.showSaveDialog({
    title: 'Скачать файл',
    defaultPath,
  })
  if (res.canceled || !res.filePath) {
    return { success: false, error: 'Cancelled' }
  }

  try {
    await downloadToFile(u.toString(), res.filePath)
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('crawl:start', async (_event, params: CrawlStartParams) => {
  try {
    return await crawlStart(params)
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('crawl:cancel', async (_event, runId: string) => {
  cancelCrawl(runId)
  return { success: true }
})

ipcMain.handle('load-user-config', async () => {
  return loadUserConfig()
})

ipcMain.handle('save-user-config', async (_event, userConfig: any) => {
  return saveUserConfig(userConfig)
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    appState.mainWindow = null
    appState.browserView = null
    appState.crawlView = null
    appState.activeCrawl = null
  }
})
