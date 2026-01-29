import { app, BrowserWindow, WebContentsView, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

type BrowserBounds = { x: number; y: number; width: number; height: number }

type CrawlStartParams = {
  startUrl: string
  options?: {
    maxPages?: number
    delayMs?: number
    jitterMs?: number
  }
}

type CrawlPageData = {
  url: string
  normalizedUrl: string
  title: string
  h1: string
  description: string
  keywords: string
  statusCode: number | null
  contentLength: number | null
  loadTimeMs: number | null
  discoveredAt: number
  links: string[]
  images: string[]
  scripts: string[]
  stylesheets: string[]
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let mainWindow: BrowserWindow | null = null
let browserView: WebContentsView | null = null
let crawlView: WebContentsView | null = null

let activeCrawl: { runId: string; cancelled: boolean } | null = null

function safeParseUrl(raw: string): URL | null {
  try {
    const trimmed = String(raw ?? '').trim()
    if (!trimmed) {
      return null
    }
    const candidate = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`
    return new URL(candidate)
  } catch {
    return null
  }
}

function normalizeUrl(input: string): string {
  const u = safeParseUrl(input)
  if (!u) {
    return ''
  }
  u.hash = ''
  // canonical-ish
  const href = u.toString()
  return href.endsWith('/') ? href.slice(0, -1) : href
}

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.setMenuBarVisibility(false)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // В UI не открываем новые окна; внешние ссылки — системный браузер.
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(url)
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

function ensureBrowserView(bounds: BrowserBounds) {
  if (!mainWindow) {
    return
  }
  if (!browserView) {
    browserView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })
    mainWindow.contentView.addChildView(browserView)
  }
  browserView.setBounds(bounds)
}

function ensureCrawlView() {
  if (!crawlView) {
    crawlView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })
    try {
      crawlView.webContents.setAudioMuted(true)
    } catch {
      void 0
    }
  }

  // Служебный view должен быть присоединён к окну, чтобы загрузка была стабильной,
  // но при этом не мешать UI: оставляем его минимальным.
  if (mainWindow) {
    try {
      if (crawlView && !mainWindow.contentView.children.includes(crawlView)) {
        mainWindow.contentView.addChildView(crawlView)
      }
      crawlView.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    } catch {
      void 0
    }
  }
}

async function extractPageDataFromView(view: WebContentsView): Promise<Omit<CrawlPageData, 'statusCode' | 'contentLength' | 'loadTimeMs' | 'discoveredAt'>> {
  const data = await view.webContents.executeJavaScript(`
    (function() {
      const text = (v) => (typeof v === 'string' ? v : '');
      const pickMeta = (name) => {
        const el = document.querySelector('meta[name="' + name + '"]');
        const content = el && el.getAttribute ? el.getAttribute('content') : '';
        return text(content).trim();
      };

      const title = text(document.title).trim();
      const h1El = document.querySelector('h1');
      const h1 = text(h1El && h1El.textContent).trim().replace(/\\s+/g, ' ').slice(0, 300);
      const description = pickMeta('description').slice(0, 500);
      const keywords = pickMeta('keywords').slice(0, 500);

      const rawLinks = Array.from(document.querySelectorAll('a[href]'))
        .map((a) => a && a.href ? String(a.href) : '')
        .filter(Boolean);

      const rawImages = Array.from(document.querySelectorAll('img[src]'))
        .map((img) => img && img.src ? String(img.src) : '')
        .filter(Boolean);

      const rawScripts = Array.from(document.querySelectorAll('script[src]'))
        .map((s) => s && s.src ? String(s.src) : '')
        .filter(Boolean);

      const rawStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))
        .map((l) => l && l.href ? String(l.href) : '')
        .filter(Boolean);

      const uniq = (arr) => Array.from(new Set(arr));
      return {
        url: String(window.location.href || ''),
        title,
        h1,
        description,
        keywords,
        links: uniq(rawLinks),
        images: uniq(rawImages),
        scripts: uniq(rawScripts),
        stylesheets: uniq(rawStyles),
      };
    })()
  `)

  const url = typeof data?.url === 'string' ? data.url : ''
  return {
    url,
    normalizedUrl: normalizeUrl(url),
    title: typeof data?.title === 'string' ? data.title : '',
    h1: typeof data?.h1 === 'string' ? data.h1 : '',
    description: typeof data?.description === 'string' ? data.description : '',
    keywords: typeof data?.keywords === 'string' ? data.keywords : '',
    links: Array.isArray(data?.links) ? data.links.filter((x: unknown) => typeof x === 'string') : [],
    images: Array.isArray(data?.images) ? data.images.filter((x: unknown) => typeof x === 'string') : [],
    scripts: Array.isArray(data?.scripts) ? data.scripts.filter((x: unknown) => typeof x === 'string') : [],
    stylesheets: Array.isArray(data?.stylesheets) ? data.stylesheets.filter((x: unknown) => typeof x === 'string') : [],
  }
}

function sendCrawlEvent(payload: any) {
  if (!mainWindow) {
    return
  }
  mainWindow.webContents.send('crawl:event', payload)
}

async function crawlStart(params: CrawlStartParams) {
  const startedAt = Date.now()

  const start = safeParseUrl(params?.startUrl)
  if (!start) {
    return { success: false as const, error: 'Invalid URL' }
  }

  const runId = `run_${startedAt}_${Math.random().toString(16).slice(2)}`
  activeCrawl = { runId, cancelled: false }

  const maxPages = typeof params?.options?.maxPages === 'number' && Number.isFinite(params.options.maxPages)
    ? Math.max(1, Math.floor(params.options.maxPages))
    : 200

  const delayMs = typeof params?.options?.delayMs === 'number' && Number.isFinite(params.options.delayMs)
    ? Math.max(0, Math.floor(params.options.delayMs))
    : 650

  const jitterMs = typeof params?.options?.jitterMs === 'number' && Number.isFinite(params.options.jitterMs)
    ? Math.max(0, Math.floor(params.options.jitterMs))
    : 350

  ensureCrawlView()
  if (!crawlView) {
    return { success: false as const, error: 'Crawler view not available' }
  }

  const origin = start.origin
  const queue: string[] = [start.toString()]
  const seen = new Set<string>()

  sendCrawlEvent({
    type: 'started',
    runId,
    startedAt,
    startUrl: start.toString(),
    options: { maxPages, delayMs, jitterMs },
  })

  let processed = 0

  while (queue.length > 0) {
    if (!activeCrawl || activeCrawl.runId !== runId || activeCrawl.cancelled) {
      sendCrawlEvent({ type: 'cancelled', runId, processed, finishedAt: Date.now() })
      return { success: true as const, runId }
    }

    if (processed >= maxPages) {
      break
    }

    const nextUrl = queue.shift() || ''
    const normalized = normalizeUrl(nextUrl)
    if (!normalized) {
      continue
    }
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)

    const u = safeParseUrl(normalized)
    if (!u) {
      continue
    }
    if (u.origin !== origin) {
      continue
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      continue
    }

    const pageStartedAt = Date.now()
    sendCrawlEvent({ type: 'page:loading', runId, url: u.toString(), processed, queued: queue.length })

    let loadOk = true
    try {
      await crawlView.webContents.loadURL(u.toString())
    } catch {
      loadOk = false
    }

    const loadFinishedAt = Date.now()

    let extracted: Omit<CrawlPageData, 'statusCode' | 'contentLength' | 'loadTimeMs' | 'discoveredAt'> | null = null
    try {
      extracted = await extractPageDataFromView(crawlView)
    } catch {
      extracted = null
    }

    const page: CrawlPageData = {
      url: u.toString(),
      normalizedUrl: normalizeUrl(u.toString()),
      title: extracted?.title || '',
      h1: extracted?.h1 || '',
      description: extracted?.description || '',
      keywords: extracted?.keywords || '',
      statusCode: null,
      contentLength: null,
      loadTimeMs: loadOk ? (loadFinishedAt - pageStartedAt) : null,
      discoveredAt: pageStartedAt,
      links: extracted?.links || [],
      images: extracted?.images || [],
      scripts: extracted?.scripts || [],
      stylesheets: extracted?.stylesheets || [],
    }

    sendCrawlEvent({
      type: 'page:done',
      runId,
      page,
      processed: processed + 1,
      queued: queue.length,
      ok: loadOk,
    })

    // Добавляем внутренние ссылки в очередь
    for (const link of page.links) {
      const normalizedLink = normalizeUrl(link)
      if (!normalizedLink) {
        continue
      }
      if (seen.has(normalizedLink)) {
        continue
      }
      const lu = safeParseUrl(normalizedLink)
      if (!lu) {
        continue
      }
      if (lu.origin !== origin) {
        continue
      }
      if (lu.protocol !== 'http:' && lu.protocol !== 'https:') {
        continue
      }
      queue.push(lu.toString())
    }

    processed += 1

    const sleepFor = delayMs + Math.floor(Math.random() * (jitterMs + 1))
    if (sleepFor > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepFor))
    }
  }

  sendCrawlEvent({ type: 'finished', runId, processed, finishedAt: Date.now(), queued: queue.length })
  return { success: true as const, runId }
}

ipcMain.handle('browser:ensure', async (_event, bounds: BrowserBounds) => {
  ensureBrowserView(bounds)
  return { success: true }
})

ipcMain.handle('browser:resize', async (_event, bounds: BrowserBounds) => {
  if (!browserView) {
    ensureBrowserView(bounds)
    return { success: true }
  }
  browserView.setBounds(bounds)
  return { success: true }
})

ipcMain.handle('browser:navigate', async (_event, url: string) => {
  if (!browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  const u = safeParseUrl(url)
  if (!u) {
    return { success: false, error: 'Invalid URL' }
  }
  try {
    await browserView.webContents.loadURL(u.toString())
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
  if (!activeCrawl) {
    return { success: true }
  }
  if (typeof runId === 'string' && runId && activeCrawl.runId === runId) {
    activeCrawl.cancelled = true
  }
  return { success: true }
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
    mainWindow = null
    browserView = null
    crawlView = null
    activeCrawl = null
  }
})

