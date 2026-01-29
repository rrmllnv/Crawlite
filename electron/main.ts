import { app, BrowserWindow, WebContentsView, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadUserConfig, saveUserConfig } from './api/UserConfig'

type BrowserBounds = { x: number; y: number; width: number; height: number }

type CrawlStartParams = {
  startUrl: string
  options?: {
    maxDepth?: number
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
  headingsText: {
    h1: string[]
    h2: string[]
    h3: string[]
    h4: string[]
    h5: string[]
    h6: string[]
  }
  headingsCount: {
    h1: number
    h2: number
    h3: number
    h4: number
    h5: number
    h6: number
  }
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
let crawlMainFrameMetaByUrl = new Map<string, { statusCode: number | null; contentLength: number | null }>()
let crawlWebRequestAttachedForWebContentsId: number | null = null

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

function normalizeHostname(hostname: string): string {
  const h = String(hostname || '').trim().toLowerCase()
  return h.startsWith('www.') ? h.slice(4) : h
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

function isHttpUrl(u: URL | null): u is URL {
  if (!u) return false
  return u.protocol === 'http:' || u.protocol === 'https:'
}

function isInternalByHost(u: URL | null, baseHostNormalized: string): boolean {
  if (!u) return false
  if (!isHttpUrl(u)) return false
  return normalizeHostname(u.hostname) === baseHostNormalized
}

function readHeaderValue(headers: Record<string, unknown> | undefined, name: string): string {
  if (!headers || typeof headers !== 'object') {
    return ''
  }
  const target = String(name || '').toLowerCase()
  const entries = Object.entries(headers)
  for (const [key, rawValue] of entries) {
    if (String(key).toLowerCase() !== target) {
      continue
    }
    if (typeof rawValue === 'string') {
      return rawValue
    }
    if (Array.isArray(rawValue) && rawValue.length > 0 && typeof rawValue[0] === 'string') {
      return rawValue[0]
    }
  }
  return ''
}

function parseContentLength(headers: Record<string, unknown> | undefined): number | null {
  const value = readHeaderValue(headers, 'content-length').trim()
  if (!value) {
    return null
  }
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) {
    return null
  }
  return Math.trunc(num)
}

function attachCrawlWebRequestListeners(view: WebContentsView) {
  const wcId = view.webContents.id
  if (crawlWebRequestAttachedForWebContentsId === wcId) {
    return
  }

  crawlWebRequestAttachedForWebContentsId = wcId

  try {
    const webRequest = view.webContents.session.webRequest
    webRequest.onCompleted({ urls: ['*://*/*'] }, (details: any) => {
      try {
        if (!details || typeof details !== 'object') {
          return
        }
        if (typeof details.webContentsId === 'number' && details.webContentsId !== wcId) {
          return
        }
        if (details.resourceType !== 'mainFrame') {
          return
        }

        const url = typeof details.url === 'string' ? details.url : ''
        const normalized = normalizeUrl(url)
        if (!normalized) {
          return
        }

        const statusCode = typeof details.statusCode === 'number' && Number.isFinite(details.statusCode)
          ? Math.trunc(details.statusCode)
          : null
        const contentLength = parseContentLength(details.responseHeaders as Record<string, unknown> | undefined)
        crawlMainFrameMetaByUrl.set(normalized, { statusCode, contentLength })
      } catch {
        void 0
      }
    })
  } catch {
    void 0
  }
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

  if (crawlView) {
    attachCrawlWebRequestListeners(crawlView)
  }
}

async function extractPageDataFromView(
  view: WebContentsView
): Promise<(Omit<CrawlPageData, 'statusCode' | 'contentLength' | 'loadTimeMs' | 'discoveredAt'> & { htmlBytes: number | null })> {
  const data = await view.webContents.executeJavaScript(`
    (function() {
      const text = (v) => (typeof v === 'string' ? v : '');
      const pickMeta = (name) => {
        const el = document.querySelector('meta[name="' + name + '"]');
        const content = el && el.getAttribute ? el.getAttribute('content') : '';
        return text(content).trim();
      };

      const title = text(document.title).trim();
      const isVisible = (el) => {
        try {
          if (!el) return false;
          const rects = el.getClientRects();
          if (!rects || rects.length === 0) return false;
          const style = window.getComputedStyle(el);
          if (!style) return true;
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          return true;
        } catch (e) {
          return true;
        }
      };
      const normText = (s) => text(s).trim().replace(/\\s+/g, ' ').slice(0, 300);

      // Более устойчивый выбор H1:
      // - берем только видимые
      // - предпочитаем внутри main/role=main
      // - иначе исключаем header/nav/footer
      const allH1 = Array.from(document.querySelectorAll('h1')).filter((el) => isVisible(el));
      const inMain = (el) => {
        try { return Boolean(el.closest('main, [role="main"]')); } catch (e) { return false; }
      };
      const inChrome = (el) => {
        try { return Boolean(el.closest('header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]')); } catch (e) { return false; }
      };
      const mainH1 = allH1.filter((el) => inMain(el));
      const candidateList = mainH1.length > 0 ? mainH1 : allH1.filter((el) => !inChrome(el));
      const chosen = (candidateList.length > 0 ? candidateList : allH1)[0] || null;
      const h1 = normText(chosen && chosen.textContent);
      const description = pickMeta('description').slice(0, 500);
      const keywords = pickMeta('keywords').slice(0, 500);

      const uniqKeepOrder = (arr) => {
        const seen = new Set();
        const out = [];
        for (const item of arr) {
          const v = String(item || '').trim();
          if (!v) continue;
          const key = v.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(v);
          if (out.length >= 200) break;
        }
        return out;
      };

      const collectHeadingTexts = (sel) => {
        try {
          const nodes = Array.from(document.querySelectorAll(sel)).filter((el) => isVisible(el));
          const texts = nodes.map((el) => normText(el && el.textContent)).filter(Boolean);
          return uniqKeepOrder(texts);
        } catch (e) {
          return [];
        }
      };

      const headingsText = {
        h1: collectHeadingTexts('h1'),
        h2: collectHeadingTexts('h2'),
        h3: collectHeadingTexts('h3'),
        h4: collectHeadingTexts('h4'),
        h5: collectHeadingTexts('h5'),
        h6: collectHeadingTexts('h6'),
      };

      const count = (sel) => {
        try {
          const n = document.querySelectorAll(sel).length;
          return (typeof n === 'number' && Number.isFinite(n)) ? n : 0;
        } catch (e) {
          return 0;
        }
      };

      const headingsCount = {
        h1: headingsText.h1.length || count('h1'),
        h2: headingsText.h2.length || count('h2'),
        h3: headingsText.h3.length || count('h3'),
        h4: headingsText.h4.length || count('h4'),
        h5: headingsText.h5.length || count('h5'),
        h6: headingsText.h6.length || count('h6'),
      };

      let htmlBytes = null;
      try {
        const html = document.documentElement ? document.documentElement.outerHTML : '';
        if (typeof TextEncoder !== 'undefined') {
          htmlBytes = new TextEncoder().encode(String(html || '')).length;
        } else {
          htmlBytes = String(html || '').length;
        }
      } catch (e) {
        htmlBytes = null;
      }

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
        headingsText,
        headingsCount,
        htmlBytes,
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
    headingsText: (data && typeof data === 'object' && (data as any).headingsText && typeof (data as any).headingsText === 'object')
      ? {
          h1: Array.isArray((data as any).headingsText.h1) ? (data as any).headingsText.h1.filter((x: unknown) => typeof x === 'string') : [],
          h2: Array.isArray((data as any).headingsText.h2) ? (data as any).headingsText.h2.filter((x: unknown) => typeof x === 'string') : [],
          h3: Array.isArray((data as any).headingsText.h3) ? (data as any).headingsText.h3.filter((x: unknown) => typeof x === 'string') : [],
          h4: Array.isArray((data as any).headingsText.h4) ? (data as any).headingsText.h4.filter((x: unknown) => typeof x === 'string') : [],
          h5: Array.isArray((data as any).headingsText.h5) ? (data as any).headingsText.h5.filter((x: unknown) => typeof x === 'string') : [],
          h6: Array.isArray((data as any).headingsText.h6) ? (data as any).headingsText.h6.filter((x: unknown) => typeof x === 'string') : [],
        }
      : { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
    headingsCount: (data && typeof data === 'object' && (data as any).headingsCount && typeof (data as any).headingsCount === 'object')
      ? {
          h1: typeof (data as any).headingsCount.h1 === 'number' ? (data as any).headingsCount.h1 : 0,
          h2: typeof (data as any).headingsCount.h2 === 'number' ? (data as any).headingsCount.h2 : 0,
          h3: typeof (data as any).headingsCount.h3 === 'number' ? (data as any).headingsCount.h3 : 0,
          h4: typeof (data as any).headingsCount.h4 === 'number' ? (data as any).headingsCount.h4 : 0,
          h5: typeof (data as any).headingsCount.h5 === 'number' ? (data as any).headingsCount.h5 : 0,
          h6: typeof (data as any).headingsCount.h6 === 'number' ? (data as any).headingsCount.h6 : 0,
        }
      : { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    description: typeof data?.description === 'string' ? data.description : '',
    keywords: typeof data?.keywords === 'string' ? data.keywords : '',
    links: Array.isArray(data?.links) ? data.links.filter((x: unknown) => typeof x === 'string') : [],
    images: Array.isArray(data?.images) ? data.images.filter((x: unknown) => typeof x === 'string') : [],
    scripts: Array.isArray(data?.scripts) ? data.scripts.filter((x: unknown) => typeof x === 'string') : [],
    stylesheets: Array.isArray(data?.stylesheets) ? data.stylesheets.filter((x: unknown) => typeof x === 'string') : [],
    htmlBytes: typeof (data as any)?.htmlBytes === 'number' && Number.isFinite((data as any).htmlBytes)
      ? Math.trunc((data as any).htmlBytes)
      : null,
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

  const maxDepth = typeof params?.options?.maxDepth === 'number' && Number.isFinite(params.options.maxDepth)
    ? Math.max(0, Math.floor(params.options.maxDepth))
    : 2

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

  // “Внутренние страницы” считаем по нормализованному hostname (www.* == без www).
  // Это нужно, чтобы редиректы и ссылки с www не считались “внешними”.
  const baseHost = normalizeHostname(start.hostname)
  const queue: Array<{ url: string; depth: number }> = [{ url: start.toString(), depth: 0 }]
  const seen = new Set<string>()
  const enqueued = new Set<string>()
  enqueued.add(normalizeUrl(start.toString()))

  sendCrawlEvent({
    type: 'started',
    runId,
    startedAt,
    startUrl: start.toString(),
    options: { maxPages, delayMs, jitterMs },
  })

  let processed = 0

  // Добавляем стартовую страницу в список сразу
  sendCrawlEvent({
    type: 'page:discovered',
    runId,
    processed,
    queued: queue.length,
    page: {
      url: start.toString(),
      normalizedUrl: normalizeUrl(start.toString()),
      title: '',
      h1: '',
      headingsText: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
      headingsCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      description: '',
      keywords: '',
      statusCode: null,
      contentLength: null,
      loadTimeMs: null,
      discoveredAt: Date.now(),
      links: [],
      images: [],
      scripts: [],
      stylesheets: [],
    },
  })

  while (queue.length > 0) {
    if (!activeCrawl || activeCrawl.runId !== runId || activeCrawl.cancelled) {
      sendCrawlEvent({ type: 'cancelled', runId, processed, queued: queue.length, finishedAt: Date.now() })
      return { success: true as const, runId }
    }

    if (processed >= maxPages) {
      break
    }

    const next = queue.shift()
    if (!next) {
      continue
    }
    const nextUrl = next.url
    const depth = next.depth
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
    if (!isInternalByHost(u, baseHost)) {
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

    // Для SPA/динамических сайтов: даем DOM догрузить контент перед извлечением.
    try {
      await crawlView.webContents.executeJavaScript(`
        (function() {
          return new Promise((resolve) => {
            try {
              requestAnimationFrame(() => setTimeout(resolve, 250));
            } catch (e) {
              setTimeout(resolve, 250);
            }
          });
        })()
      `)
    } catch {
      void 0
    }

    const loadFinishedAt = Date.now()

    let extracted: (Omit<CrawlPageData, 'statusCode' | 'contentLength' | 'loadTimeMs' | 'discoveredAt'> & { htmlBytes: number | null }) | null = null
    try {
      extracted = await extractPageDataFromView(crawlView)
    } catch {
      extracted = null
    }

    const finalUrlRaw = (extracted?.url || crawlView.webContents.getURL() || u.toString())
    const finalNormalized = normalizeUrl(finalUrlRaw) || normalizeUrl(u.toString())
    const meta = finalNormalized ? crawlMainFrameMetaByUrl.get(finalNormalized) : undefined

    const page: CrawlPageData = {
      url: finalUrlRaw,
      normalizedUrl: finalNormalized,
      title: extracted?.title || '',
      h1: extracted?.h1 || '',
      headingsText: extracted?.headingsText || { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
      headingsCount: extracted?.headingsCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      description: extracted?.description || '',
      keywords: extracted?.keywords || '',
      statusCode: meta?.statusCode ?? null,
      contentLength: meta?.contentLength ?? (extracted?.htmlBytes ?? null),
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

    // Добавляем внутренние ссылки в очередь (с учетом глубины)
    if (depth >= maxDepth) {
      processed += 1

      const sleepFor = delayMs + Math.floor(Math.random() * (jitterMs + 1))
      if (sleepFor > 0) {
        await new Promise((resolve) => setTimeout(resolve, sleepFor))
      }
      continue
    }

    for (const link of page.links) {
      const normalizedLink = normalizeUrl(link)
      if (!normalizedLink) {
        continue
      }
      if (seen.has(normalizedLink) || enqueued.has(normalizedLink)) {
        continue
      }
      const lu = safeParseUrl(normalizedLink)
      if (!lu) {
        continue
      }
      if (!isInternalByHost(lu, baseHost)) {
        continue
      }
      enqueued.add(normalizedLink)
      queue.push({ url: lu.toString(), depth: depth + 1 })

      sendCrawlEvent({
        type: 'page:discovered',
        runId,
        processed,
        queued: queue.length,
        page: {
          url: lu.toString(),
          normalizedUrl: normalizedLink,
          title: '',
          h1: '',
          headingsText: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
          headingsCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
          description: '',
          keywords: '',
          statusCode: null,
          contentLength: null,
          loadTimeMs: null,
          discoveredAt: Date.now(),
          links: [],
          images: [],
          scripts: [],
          stylesheets: [],
        },
      })
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
    mainWindow = null
    browserView = null
    crawlView = null
    activeCrawl = null
  }
})

