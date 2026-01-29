import { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, net } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { lookup } from 'node:dns/promises'
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
  hasViewport: boolean
  hasCanonical: boolean
  canonicalUrl: string
  metaRobots: string
  ipAddress: string
  headingsRawCount: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number }
  headingsEmptyCount: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number }
  nestedHeadings: string[]
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
  analysisTimeMs: number | null
  discoveredAt: number
  links: string[]
  linksDetailed: { url: string; anchor: string }[]
  images: string[]
  scripts: string[]
  stylesheets: string[]
  misc: string[]
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ipByHost = new Map<string, string>()

async function resolveHostIp(hostname: string): Promise<string> {
  const host = String(hostname || '').trim()
  if (!host) return ''
  const cached = ipByHost.get(host)
  if (cached) return cached
  try {
    const res = await lookup(host, { all: false })
    const ip = typeof (res as any)?.address === 'string' ? String((res as any).address) : ''
    if (ip) {
      ipByHost.set(host, ip)
      return ip
    }
  } catch {
    void 0
  }
  return ''
}

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let mainWindow: BrowserWindow | null = null
let browserView: WebContentsView | null = null
let crawlView: WebContentsView | null = null

let browserViewLastBounds: BrowserBounds | null = null
let browserViewIsVisible = true

let activeCrawl: { runId: string; cancelled: boolean } | null = null
let crawlMainFrameMetaByUrl = new Map<string, { statusCode: number | null; contentLength: number | null }>()
let crawlWebRequestAttachedForWebContentsId: number | null = null

const BROWSER_SCROLLBAR_CSS = `
  /* App-injected scrollbar styling (WebContentsView) */
  :root {
    color-scheme: dark;
  }
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.04);
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.16);
    border-radius: 10px;
    border: 2px solid rgba(0, 0, 0, 0);
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.22);
    border: 2px solid rgba(0, 0, 0, 0);
    background-clip: padding-box;
  }
`

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

function isDocumentOrMediaUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    const pathLower = String(u.pathname || '').toLowerCase()
    const ext = pathLower.includes('.') ? pathLower.split('.').pop() || '' : ''
    const cleanExt = ext.split('?')[0].split('#')[0]
    if (!cleanExt) return false

    const blocked = new Set([
      // documents
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv',
      // archives/binaries
      'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'exe', 'msi', 'dmg', 'apk',
      // video/audio
      'mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'm4v', 'mp3', 'wav', 'flac', 'ogg', 'm4a',
    ])
    return blocked.has(cleanExt)
  } catch {
    return false
  }
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

function suggestFilenameFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    const last = String(u.pathname || '').split('/').filter(Boolean).pop() || ''
    const clean = last.split('?')[0].split('#')[0]
    return clean || 'download'
  } catch {
    return 'download'
  }
}

async function headContentLength(url: string): Promise<number | null> {
  return await new Promise<number | null>((resolve) => {
    try {
      const request = net.request({ method: 'HEAD', url })
      request.on('response', (response: any) => {
        try {
          const headers = response?.headers as Record<string, unknown> | undefined
          const len = parseContentLength(headers)
          resolve(len)
        } catch {
          resolve(null)
        }
      })
      request.on('error', () => resolve(null))
      request.end()
    } catch {
      resolve(null)
    }
  })
}

function parseContentRangeTotal(headers: Record<string, unknown> | undefined): number | null {
  const value = readHeaderValue(headers, 'content-range').trim()
  // format: bytes 0-0/12345
  const m = /\/(\d+)\s*$/i.exec(value)
  if (!m) return null
  const num = Number(m[1])
  if (!Number.isFinite(num) || num < 0) return null
  return Math.trunc(num)
}

async function probeResourceSize(url: string): Promise<number | null> {
  // 1) HEAD content-length
  const lenHead = await headContentLength(url)
  if (typeof lenHead === 'number' && Number.isFinite(lenHead) && lenHead > 0) return lenHead

  // 2) GET range 0-0 (часто даёт общий размер в Content-Range)
  return await new Promise<number | null>((resolve) => {
    try {
      const request = net.request({
        method: 'GET',
        url,
        headers: {
          Range: 'bytes=0-0',
        },
      } as any)
      request.on('response', (response: any) => {
        try {
          const headers = response?.headers as Record<string, unknown> | undefined
          const total = parseContentRangeTotal(headers)
          const len = total ?? parseContentLength(headers)
          resolve(typeof len === 'number' && Number.isFinite(len) && len > 0 ? Math.trunc(len) : null)
        } catch {
          resolve(null)
        }
        try {
          ;(response as any).destroy()
        } catch {
          void 0
        }
      })
      request.on('error', () => resolve(null))
      request.end()
    } catch {
      resolve(null)
    }
  })
}

async function fetchUrlText(url: string, maxBytes: number): Promise<{ ok: boolean; statusCode: number; body: string }> {
  return await new Promise((resolve) => {
    try {
      const request = net.request({ method: 'GET', url })
      request.on('response', (response: any) => {
        try {
          const statusCode = typeof response.statusCode === 'number' ? response.statusCode : 0
          const chunks: Buffer[] = []
          let size = 0
          ;(response as any).on('data', (chunk: Buffer) => {
            try {
              if (!Buffer.isBuffer(chunk)) {
                return
              }
              size += chunk.length
              if (size > maxBytes) {
                try {
                  ;(response as any).destroy()
                } catch {
                  void 0
                }
                return
              }
              chunks.push(chunk)
            } catch {
              void 0
            }
          })
          ;(response as any).on('end', () => {
            try {
              const buf = Buffer.concat(chunks)
              resolve({ ok: statusCode >= 200 && statusCode < 300, statusCode, body: buf.toString('utf-8') })
            } catch {
              resolve({ ok: false, statusCode, body: '' })
            }
          })
          ;(response as any).on('error', () => resolve({ ok: false, statusCode, body: '' }))
        } catch {
          resolve({ ok: false, statusCode: 0, body: '' })
        }
      })
      request.on('error', () => resolve({ ok: false, statusCode: 0, body: '' }))
      request.end()
    } catch {
      resolve({ ok: false, statusCode: 0, body: '' })
    }
  })
}

function decodeXmlEntities(value: string): string {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function extractXmlLocs(xml: string): string[] {
  const out: string[] = []
  const re = /<loc[^>]*>([\s\S]*?)<\/loc>/gi
  let m: RegExpExecArray | null = null
  while ((m = re.exec(xml))) {
    const raw = decodeXmlEntities(String(m[1] || '')).trim()
    if (!raw) continue
    out.push(raw)
    if (out.length >= 200000) break
  }
  return out
}

async function buildSitemapUrls(startUrl: string): Promise<{ sitemaps: string[]; urls: string[] }> {
  const start = safeParseUrl(startUrl)
  if (!start) {
    return { sitemaps: [], urls: [] }
  }

  const origin = start.origin
  const robotsUrl = `${origin}/robots.txt`
  const candidates = new Set<string>()
  // дефолтные варианты
  candidates.add(`${origin}/sitemap.xml`)
  candidates.add(`${origin}/sitemap_index.xml`)

  const robots = await fetchUrlText(robotsUrl, 512 * 1024)
  if (robots.ok && robots.body) {
    const lines = robots.body.split(/\r?\n/)
    for (const line of lines) {
      const t = String(line || '').trim()
      if (!t) continue
      const m = /^sitemap:\s*(.+)$/i.exec(t)
      if (m && m[1]) {
        const s = String(m[1]).trim()
        if (s) candidates.add(s)
      }
    }
  }

  const sitemapQueue: string[] = Array.from(candidates)
  const sitemapSeen = new Set<string>()
  const urlsSeen = new Set<string>()
  const allSitemaps: string[] = []
  const allUrls: string[] = []

  while (sitemapQueue.length > 0) {
    const next = sitemapQueue.shift()
    if (!next) break
    const norm = normalizeUrl(next)
    if (!norm || sitemapSeen.has(norm)) continue
    sitemapSeen.add(norm)
    allSitemaps.push(next)

    const res = await fetchUrlText(next, 5 * 1024 * 1024)
    if (!res.ok || !res.body) {
      continue
    }
    const xml = res.body
    const isIndex = /<sitemapindex\b/i.test(xml)
    const locs = extractXmlLocs(xml)
    if (locs.length === 0) continue

    if (isIndex) {
      for (const loc of locs) {
        const n = normalizeUrl(loc)
        if (!n || sitemapSeen.has(n)) continue
        if (sitemapSeen.size + sitemapQueue.length >= 200) break
        sitemapQueue.push(loc)
      }
    } else {
      for (const loc of locs) {
        const n = normalizeUrl(loc)
        if (!n || urlsSeen.has(n)) continue
        urlsSeen.add(n)
        allUrls.push(loc)
        if (allUrls.length >= 200000) break
      }
    }
  }

  return { sitemaps: allSitemaps, urls: allUrls }
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    try {
      const request = net.request(url)
      request.on('response', (response) => {
        try {
          const statusCode = typeof response.statusCode === 'number' ? response.statusCode : 0
          // базовая поддержка редиректов
          if (statusCode >= 300 && statusCode < 400) {
            const location = response.headers?.location
            const next = Array.isArray(location) ? location[0] : location
            if (typeof next === 'string' && next) {
              // закрываем текущий поток
              try {
                ;(response as any).destroy()
              } catch {
                void 0
              }
              void downloadToFile(next, filePath).then(resolve).catch(reject)
              return
            }
          }

          const stream = fs.createWriteStream(filePath)
          stream.on('finish', () => resolve())
          stream.on('error', (e: unknown) => reject(e))
          ;(response as any).on('error', (e: unknown) => reject(e))
          ;(response as any).pipe(stream)
        } catch (e) {
          reject(e)
        }
      })
      request.on('error', (e) => reject(e))
      request.end()
    } catch (e) {
      reject(e)
    }
  })
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
    try {
      const sendNavState = () => {
        try {
          if (!browserView) return
          const wc = browserView.webContents
          mainWindow?.webContents.send('browser:event', {
            type: 'nav',
            canGoBack: wc.canGoBack(),
            canGoForward: wc.canGoForward(),
            url: wc.getURL(),
          })
        } catch {
          void 0
        }
      }

      browserView.webContents.on('did-start-loading', () => {
        try {
          mainWindow?.webContents.send('browser:event', { type: 'loading', isLoading: true })
        } catch {
          void 0
        }
      })
      const stop = () => {
        try {
          mainWindow?.webContents.send('browser:event', { type: 'loading', isLoading: false })
        } catch {
          void 0
        }
        sendNavState()
      }
      browserView.webContents.on('did-stop-loading', stop)
      browserView.webContents.on('did-fail-load', stop)

      browserView.webContents.on('did-navigate', sendNavState)
      browserView.webContents.on('did-navigate-in-page', sendNavState)
      browserView.webContents.on('did-start-navigation', sendNavState)

      browserView.webContents.on('did-finish-load', () => {
        try {
          void browserView?.webContents.insertCSS(BROWSER_SCROLLBAR_CSS).catch(() => void 0)
        } catch {
          void 0
        }
      })
      void browserView.webContents.insertCSS(BROWSER_SCROLLBAR_CSS).catch(() => void 0)
      sendNavState()
    } catch {
      void 0
    }
  }
  // `WebContentsView` рисуется поверх DOM, поэтому при показе модалок его нужно уметь скрывать.
  // При скрытии мы не меняем `lastBounds`, чтобы восстановить исходное положение.
  browserViewLastBounds = bounds
  if (!browserViewIsVisible) {
    browserView.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    return
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
): Promise<(Omit<CrawlPageData, 'statusCode' | 'contentLength' | 'loadTimeMs' | 'analysisTimeMs' | 'discoveredAt' | 'ipAddress'> & { htmlBytes: number | null })> {
  const data = await view.webContents.executeJavaScript(`
    (function() {
      const text = (v) => (typeof v === 'string' ? v : '');
      const pickMeta = (name) => {
        const el = document.querySelector('meta[name="' + name + '"]');
        const content = el && el.getAttribute ? el.getAttribute('content') : '';
        return text(content).trim();
      };

      const title = text(document.title).trim();
      const hasViewport = Boolean((function() {
        try {
          const el = document.querySelector('meta[name="viewport"]');
          const v = el && el.getAttribute ? String(el.getAttribute('content') || '').trim() : '';
          return Boolean(v);
        } catch (e) { return false; }
      })());

      let canonicalUrl = '';
      try {
        const c = document.querySelector('link[rel="canonical"][href]');
        canonicalUrl = c && c.href ? String(c.href) : '';
      } catch (e) { canonicalUrl = ''; }
      const hasCanonical = Boolean(String(canonicalUrl || '').trim());
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

      // Выбор H1 без привязки к <main>: берём видимый H1 с самым “сильным” текстом.
      const allH1 = Array.from(document.querySelectorAll('h1')).filter((el) => isVisible(el));
      let chosen = null;
      let bestLen = -1;
      for (const el of allH1) {
        const t = normText(el && el.textContent);
        if (!t) continue;
        if (t.length > bestLen) {
          bestLen = t.length;
          chosen = el;
        }
      }
      const h1 = normText(chosen && chosen.textContent);
      const description = pickMeta('description').slice(0, 500);
      const keywords = pickMeta('keywords').slice(0, 500);
      const metaRobots = pickMeta('robots').slice(0, 500);

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

      const headingsRawCount = {
        h1: count('h1'),
        h2: count('h2'),
        h3: count('h3'),
        h4: count('h4'),
        h5: count('h5'),
        h6: count('h6'),
      };

      const emptyCount = (sel) => {
        try {
          const nodes = Array.from(document.querySelectorAll(sel));
          let n = 0;
          for (const el of nodes) {
            const t = normText(el && el.textContent);
            if (!t) n += 1;
          }
          return n;
        } catch (e) {
          return 0;
        }
      };
      const headingsEmptyCount = {
        h1: emptyCount('h1'),
        h2: emptyCount('h2'),
        h3: emptyCount('h3'),
        h4: emptyCount('h4'),
        h5: emptyCount('h5'),
        h6: emptyCount('h6'),
      };

      const nestedHeadings = (function() {
        try {
          const issues = [];
          const all = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
          for (const parent of all) {
            const child = parent && parent.querySelector ? parent.querySelector('h1,h2,h3,h4,h5,h6') : null;
            if (!child) continue;
            const p = String(parent.tagName || '').toLowerCase();
            const c = String(child.tagName || '').toLowerCase();
            if (!p || !c) continue;
            issues.push(p + ' содержит ' + c);
            if (issues.length >= 20) break;
          }
          return Array.from(new Set(issues));
        } catch (e) {
          return [];
        }
      })();

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

      const isHttpLike = (s) => /^https?:\\/\\//i.test(String(s || ''));
      const absUrl = (raw) => {
        try { return String(new URL(String(raw || ''), window.location.href).toString()); } catch (e) { return ''; }
      };
      const isDocOrMedia = (u) => {
        try {
          const x = new URL(String(u || ''));
          const p = String(x.pathname || '').toLowerCase();
          const ext = p.includes('.') ? (p.split('.').pop() || '') : '';
          const e = ext.split('?')[0].split('#')[0];
          const blocked = new Set(['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','txt','csv','zip','rar','7z','tar','gz','bz2','xz','exe','msi','dmg','apk','mp4','webm','mkv','mov','avi','wmv','flv','m4v','mp3','wav','flac','ogg','m4a']);
          return blocked.has(String(e || '').toLowerCase());
        } catch (e) {
          return false;
        }
      };

      const rawLinks = [];
      const rawLinksDetailed = [];
      const rawMisc = [];

      // Ссылки: в links кладём только http(s). Остальное — в misc (mailto/tel/javascript/# и т.п.).
      Array.from(document.querySelectorAll('a[href]')).forEach((a) => {
        try {
          const raw = a && a.getAttribute ? String(a.getAttribute('href') || '') : '';
          const v = String(raw || '').trim();
          if (!v) return;
          if (v.startsWith('#') || /^mailto:/i.test(v) || /^tel:/i.test(v) || /^javascript:/i.test(v)) {
            rawMisc.push(v);
            return;
          }
          const abs = absUrl(v);
          if (!abs) {
            rawMisc.push(v);
            return;
          }
          if (isHttpLike(abs) && !isDocOrMedia(abs)) {
            rawLinks.push(abs);
            rawLinksDetailed.push({ url: abs, anchor: normText(a && a.textContent).slice(0, 300) });
          } else {
            rawMisc.push(abs);
          }
        } catch (e) {
          rawMisc.push(String((a && a.href) || '').trim());
        }
      });

      const rawImages = [];
      Array.from(document.querySelectorAll('img[src]')).forEach((img) => {
        const raw = img && img.getAttribute ? String(img.getAttribute('src') || '') : '';
        const abs = absUrl(raw);
        if (!abs) return;
        if (isHttpLike(abs)) rawImages.push(abs);
        else rawMisc.push(abs);
      });

      const rawScripts = [];
      Array.from(document.querySelectorAll('script[src]')).forEach((s) => {
        const raw = s && s.getAttribute ? String(s.getAttribute('src') || '') : '';
        const abs = absUrl(raw);
        if (!abs) return;
        if (isHttpLike(abs)) rawScripts.push(abs);
        else rawMisc.push(abs);
      });

      const rawStyles = [];
      Array.from(document.querySelectorAll('link[rel="stylesheet"][href]')).forEach((l) => {
        const raw = l && l.getAttribute ? String(l.getAttribute('href') || '') : '';
        const abs = absUrl(raw);
        if (!abs) return;
        if (isHttpLike(abs)) rawStyles.push(abs);
        else rawMisc.push(abs);
      });

      // Другие link[href] (иконки, manifest, preconnect, etc.) — в misc
      Array.from(document.querySelectorAll('link[href]')).forEach((l) => {
        try {
          const rel = l && l.getAttribute ? String(l.getAttribute('rel') || '') : '';
          if (String(rel).toLowerCase().includes('stylesheet')) {
            return;
          }
          const raw = l && l.getAttribute ? String(l.getAttribute('href') || '') : '';
          const abs = absUrl(raw);
          if (!abs) return;
          rawMisc.push(abs);
        } catch (e) {
          void 0;
        }
      });

      const uniq = (arr) => Array.from(new Set(arr));
      const uniqLinksDetailed = (arr) => {
        const byUrl = new Map();
        for (const it of (arr || [])) {
          const url = it && it.url ? String(it.url).trim() : '';
          if (!url) continue;
          const anchor = it && typeof it.anchor === 'string' ? String(it.anchor).trim() : '';
          const prev = byUrl.get(url);
          if (!prev) {
            byUrl.set(url, { url, anchor });
            continue;
          }
          if (!prev.anchor && anchor) {
            byUrl.set(url, { url, anchor });
          }
        }
        return Array.from(byUrl.values());
      };
      return {
        url: String(window.location.href || ''),
        title,
        h1,
        hasViewport,
        hasCanonical,
        canonicalUrl: String(canonicalUrl || ''),
        headingsRawCount,
        headingsEmptyCount,
        nestedHeadings,
        headingsText,
        headingsCount,
        htmlBytes,
        description,
        keywords,
        metaRobots,
        links: uniq(rawLinks),
        linksDetailed: uniqLinksDetailed(rawLinksDetailed),
        images: uniq(rawImages),
        scripts: uniq(rawScripts),
        stylesheets: uniq(rawStyles),
        misc: uniq(rawMisc),
      };
    })()
  `)

  const url = typeof data?.url === 'string' ? data.url : ''
  return {
    url,
    normalizedUrl: normalizeUrl(url),
    title: typeof data?.title === 'string' ? data.title : '',
    h1: typeof data?.h1 === 'string' ? data.h1 : '',
    hasViewport: Boolean((data as any)?.hasViewport),
    hasCanonical: Boolean((data as any)?.hasCanonical),
    canonicalUrl: typeof (data as any)?.canonicalUrl === 'string' ? (data as any).canonicalUrl : '',
    metaRobots: typeof (data as any)?.metaRobots === 'string' ? (data as any).metaRobots : '',
    headingsRawCount: (data && typeof data === 'object' && (data as any).headingsRawCount && typeof (data as any).headingsRawCount === 'object')
      ? {
          h1: typeof (data as any).headingsRawCount.h1 === 'number' ? (data as any).headingsRawCount.h1 : 0,
          h2: typeof (data as any).headingsRawCount.h2 === 'number' ? (data as any).headingsRawCount.h2 : 0,
          h3: typeof (data as any).headingsRawCount.h3 === 'number' ? (data as any).headingsRawCount.h3 : 0,
          h4: typeof (data as any).headingsRawCount.h4 === 'number' ? (data as any).headingsRawCount.h4 : 0,
          h5: typeof (data as any).headingsRawCount.h5 === 'number' ? (data as any).headingsRawCount.h5 : 0,
          h6: typeof (data as any).headingsRawCount.h6 === 'number' ? (data as any).headingsRawCount.h6 : 0,
        }
      : { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    headingsEmptyCount: (data && typeof data === 'object' && (data as any).headingsEmptyCount && typeof (data as any).headingsEmptyCount === 'object')
      ? {
          h1: typeof (data as any).headingsEmptyCount.h1 === 'number' ? (data as any).headingsEmptyCount.h1 : 0,
          h2: typeof (data as any).headingsEmptyCount.h2 === 'number' ? (data as any).headingsEmptyCount.h2 : 0,
          h3: typeof (data as any).headingsEmptyCount.h3 === 'number' ? (data as any).headingsEmptyCount.h3 : 0,
          h4: typeof (data as any).headingsEmptyCount.h4 === 'number' ? (data as any).headingsEmptyCount.h4 : 0,
          h5: typeof (data as any).headingsEmptyCount.h5 === 'number' ? (data as any).headingsEmptyCount.h5 : 0,
          h6: typeof (data as any).headingsEmptyCount.h6 === 'number' ? (data as any).headingsEmptyCount.h6 : 0,
        }
      : { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    nestedHeadings: Array.isArray((data as any)?.nestedHeadings) ? (data as any).nestedHeadings.filter((x: unknown) => typeof x === 'string') : [],
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
    linksDetailed: Array.isArray((data as any)?.linksDetailed)
      ? (data as any).linksDetailed
          .map((x: any) => ({ url: String(x?.url || '').trim(), anchor: String(x?.anchor || '').trim() }))
          .filter((x: any) => x.url)
      : [],
    images: Array.isArray(data?.images) ? data.images.filter((x: unknown) => typeof x === 'string') : [],
    scripts: Array.isArray(data?.scripts) ? data.scripts.filter((x: unknown) => typeof x === 'string') : [],
    stylesheets: Array.isArray(data?.stylesheets) ? data.stylesheets.filter((x: unknown) => typeof x === 'string') : [],
    misc: Array.isArray((data as any)?.misc) ? (data as any).misc.filter((x: unknown) => typeof x === 'string') : [],
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
      hasViewport: false,
      hasCanonical: false,
      canonicalUrl: '',
      headingsRawCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      headingsEmptyCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      nestedHeadings: [],
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
      misc: [],
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

    let extracted: (Omit<CrawlPageData, 'statusCode' | 'contentLength' | 'loadTimeMs' | 'analysisTimeMs' | 'discoveredAt' | 'ipAddress'> & { htmlBytes: number | null }) | null = null
    try {
      extracted = await extractPageDataFromView(crawlView)
    } catch {
      extracted = null
    }

    const finalUrlRaw = (extracted?.url || crawlView.webContents.getURL() || u.toString())
    const finalNormalized = normalizeUrl(finalUrlRaw) || normalizeUrl(u.toString())
    const meta = finalNormalized ? crawlMainFrameMetaByUrl.get(finalNormalized) : undefined
    let ipAddress = ''
    try {
      const host = safeParseUrl(finalUrlRaw)?.hostname || u.hostname
      ipAddress = await resolveHostIp(host)
    } catch {
      ipAddress = ''
    }

    const page: CrawlPageData = {
      url: finalUrlRaw,
      normalizedUrl: finalNormalized,
      title: extracted?.title || '',
      h1: extracted?.h1 || '',
      hasViewport: Boolean((extracted as any)?.hasViewport),
      hasCanonical: Boolean((extracted as any)?.hasCanonical),
      canonicalUrl: typeof (extracted as any)?.canonicalUrl === 'string' ? (extracted as any).canonicalUrl : '',
      metaRobots: typeof (extracted as any)?.metaRobots === 'string' ? (extracted as any).metaRobots : '',
      ipAddress,
      headingsRawCount: (extracted as any)?.headingsRawCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      headingsEmptyCount: (extracted as any)?.headingsEmptyCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      nestedHeadings: (extracted as any)?.nestedHeadings || [],
      headingsText: extracted?.headingsText || { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
      headingsCount: extracted?.headingsCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      description: extracted?.description || '',
      keywords: extracted?.keywords || '',
      statusCode: meta?.statusCode ?? null,
      contentLength: meta?.contentLength ?? (extracted?.htmlBytes ?? null),
      loadTimeMs: loadOk ? (loadFinishedAt - pageStartedAt) : null,
      analysisTimeMs: Date.now() - pageStartedAt,
      discoveredAt: pageStartedAt,
      links: extracted?.links || [],
      linksDetailed: Array.isArray((extracted as any)?.linksDetailed) ? (extracted as any).linksDetailed : [],
      images: extracted?.images || [],
      scripts: extracted?.scripts || [],
      stylesheets: extracted?.stylesheets || [],
      misc: (extracted as any)?.misc || [],
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
      // документы/видео/архивы в дерево страниц не добавляем
      if (isDocumentOrMediaUrl(normalizedLink)) {
        continue
      }
      if (seen.has(normalizedLink) || enqueued.has(normalizedLink)) {
        continue
      }
      // Жёстко ограничиваем планируемое кол-во страниц, чтобы “в очереди” не раздувалось.
      if (enqueued.size >= maxPages) {
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
          hasViewport: false,
          hasCanonical: false,
          canonicalUrl: '',
          metaRobots: '',
          ipAddress: '',
          headingsRawCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
          headingsEmptyCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
          nestedHeadings: [],
          headingsText: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
          headingsCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
          description: '',
          keywords: '',
          statusCode: null,
          contentLength: null,
          loadTimeMs: null,
        analysisTimeMs: null,
          discoveredAt: Date.now(),
          links: [],
          linksDetailed: [],
          images: [],
          scripts: [],
          stylesheets: [],
          misc: [],
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
  ensureBrowserView(bounds)
  return { success: true }
})

ipcMain.handle('browser:set-visible', async (_event, visible: boolean) => {
  browserViewIsVisible = Boolean(visible)
  if (!browserView) {
    return { success: true }
  }
  try {
    if (!browserViewIsVisible) {
      browserView.setBounds({ x: 0, y: 0, width: 1, height: 1 })
      return { success: true }
    }
    if (browserViewLastBounds) {
      browserView.setBounds(browserViewLastBounds)
      return { success: true }
    }
    // Если bounds ещё не задавались — просто оставляем как есть.
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
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

ipcMain.handle('browser:go-back', async () => {
  if (!browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  try {
    if (browserView.webContents.canGoBack()) {
      browserView.webContents.goBack()
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('browser:go-forward', async () => {
  if (!browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  try {
    if (browserView.webContents.canGoForward()) {
      browserView.webContents.goForward()
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('browser:reload', async () => {
  if (!browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  try {
    browserView.webContents.reload()
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('browser:highlight-heading', async (_event, payload: { level: number; text: string }) => {
  if (!browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  const level = typeof payload?.level === 'number' ? Math.floor(payload.level) : 0
  const text = typeof payload?.text === 'string' ? payload.text : ''
  if (level < 1 || level > 6) {
    return { success: false, error: 'Invalid heading level' }
  }
  if (!text.trim()) {
    return { success: false, error: 'Empty heading text' }
  }

  try {
    const js = `
      (function() {
        try {
          const clearOverlay = () => {
            try {
              const dim = document.getElementById('__crawlite_overlay_dim');
              const box = document.getElementById('__crawlite_overlay_box');
              if (dim) dim.remove();
              if (box) box.remove();
            } catch (e) { /* noop */ }
          };
          const ensureOverlay = () => {
            try {
              clearOverlay();
              const dim = document.createElement('div');
              dim.id = '__crawlite_overlay_dim';
              dim.style.position = 'fixed';
              dim.style.inset = '0';
              dim.style.background = 'rgba(0,0,0,0.65)';
              dim.style.pointerEvents = 'none';
              dim.style.zIndex = '2147483646';

              const box = document.createElement('div');
              box.id = '__crawlite_overlay_box';
              box.style.position = 'fixed';
              box.style.pointerEvents = 'none';
              box.style.zIndex = '2147483647';
              box.style.border = '2px solid rgba(74, 163, 255, 0.95)';
              box.style.background = 'rgba(74, 163, 255, 0.10)';
              box.style.borderRadius = '10px';
              box.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.25)';

              document.documentElement.appendChild(dim);
              document.documentElement.appendChild(box);
              return { dim, box };
            } catch (e) {
              return null;
            }
          };
          const positionBox = (box, el) => {
            try {
              const r = el.getBoundingClientRect();
              const pad = 6;
              const left = Math.max(8, r.left - pad);
              const top = Math.max(8, r.top - pad);
              const w = Math.max(0, r.width + pad * 2);
              const h = Math.max(0, r.height + pad * 2);
              box.style.left = left + 'px';
              box.style.top = top + 'px';
              box.style.width = w + 'px';
              box.style.height = h + 'px';
            } catch (e) { /* noop */ }
          };

          const level = ${level};
          const targetRaw = ${JSON.stringify(text)};
          const normalize = (s) => String(s || '').trim().replace(/\\s+/g, ' ').slice(0, 300);
          const target = normalize(targetRaw);
          const list = Array.from(document.querySelectorAll('h' + level));
          const exact = list.find((el) => normalize(el && el.textContent) === target) || null;
          const partial = exact ? exact : (list.find((el) => normalize(el && el.textContent).includes(target)) || null);
          const el = partial;
          if (!el) return false;

          const disableSmooth = () => {
            try {
              const existing = document.getElementById('__crawlite_scroll_fix');
              if (existing) existing.remove();
              const st = document.createElement('style');
              st.id = '__crawlite_scroll_fix';
              st.textContent = 'html,body,*{scroll-behavior:auto !important;}';
              document.documentElement.appendChild(st);
              return () => { try { st.remove(); } catch (e) { /* noop */ } };
            } catch (e) {
              return () => {};
            }
          };
          const waitStable = (el) => {
            return new Promise((resolve) => {
              try {
                let last = el.getBoundingClientRect();
                let stable = 0;
                const started = Date.now();
                const tick = () => {
                  const r = el.getBoundingClientRect();
                  const d = Math.abs(r.top - last.top) + Math.abs(r.left - last.left);
                  last = r;
                  if (d < 0.5) stable += 1;
                  else stable = 0;
                  if (stable >= 3 || (Date.now() - started) > 800) return resolve(true);
                  requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              } catch (e) {
                resolve(true);
              }
            });
          };

          (async () => {
            const restore = disableSmooth();
            el.style.scrollMarginTop = '120px';
            try { el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) { /* noop */ } }
            await waitStable(el);
            try { restore(); } catch (e) { /* noop */ }

            const ov = ensureOverlay();
            if (ov && ov.box) {
              positionBox(ov.box, el);
              setTimeout(() => { try { positionBox(ov.box, el); } catch (e) { /* noop */ } }, 120);
            }

            setTimeout(() => {
              clearOverlay();
            }, 1400);
          })();

          return true;
        } catch (e) {
          return false;
        }
      })()
    `
    const ok = await browserView.webContents.executeJavaScript(js, true)
    return { success: Boolean(ok) }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('browser:highlight-link', async (_event, url: string) => {
  if (!browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  const target = typeof url === 'string' ? url.trim() : ''
  if (!target) {
    return { success: false, error: 'Empty URL' }
  }
  try {
    const js = `
      (function() {
        try {
          const clearOverlay = () => {
            try {
              const dim = document.getElementById('__crawlite_overlay_dim');
              const box = document.getElementById('__crawlite_overlay_box');
              if (dim) dim.remove();
              if (box) box.remove();
            } catch (e) { /* noop */ }
          };
          const ensureOverlay = () => {
            try {
              clearOverlay();
              const dim = document.createElement('div');
              dim.id = '__crawlite_overlay_dim';
              dim.style.position = 'fixed';
              dim.style.inset = '0';
              dim.style.background = 'rgba(0,0,0,0.65)';
              dim.style.pointerEvents = 'none';
              dim.style.zIndex = '2147483646';

              const box = document.createElement('div');
              box.id = '__crawlite_overlay_box';
              box.style.position = 'fixed';
              box.style.pointerEvents = 'none';
              box.style.zIndex = '2147483647';
              box.style.border = '2px solid rgba(74, 163, 255, 0.95)';
              box.style.background = 'rgba(74, 163, 255, 0.10)';
              box.style.borderRadius = '10px';
              box.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.25)';

              document.documentElement.appendChild(dim);
              document.documentElement.appendChild(box);
              return { dim, box };
            } catch (e) {
              return null;
            }
          };
          const positionBox = (box, el) => {
            try {
              const r = el.getBoundingClientRect();
              const pad = 6;
              const left = Math.max(8, r.left - pad);
              const top = Math.max(8, r.top - pad);
              const w = Math.max(0, r.width + pad * 2);
              const h = Math.max(0, r.height + pad * 2);
              box.style.left = left + 'px';
              box.style.top = top + 'px';
              box.style.width = w + 'px';
              box.style.height = h + 'px';
            } catch (e) { /* noop */ }
          };

          const targetRaw = ${JSON.stringify(target)};
          const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ');
          const strip = (u) => {
            try { const x = new URL(u); x.hash = ''; x.search = ''; return x.toString(); } catch (e) { return ''; }
          };
          const target = norm(targetRaw);
          const targetNoQuery = strip(target);

          // если ссылка в <details> — раскрываем
          const openDetailsChain = (el) => {
            const opened = [];
            try {
              let d = el && el.closest ? el.closest('details') : null;
              while (d) {
                if (!d.open) { d.open = true; opened.push(d); }
                d = d.parentElement && d.parentElement.closest ? d.parentElement.closest('details') : null;
              }
            } catch (e) { /* noop */ }
            return opened;
          };

          const isVisible = (el) => {
            try {
              if (!el) return false;
              const rects = el.getClientRects();
              if (!rects || rects.length === 0) return false;
              const st = window.getComputedStyle(el);
              if (!st) return true;
              if (st.display === 'none' || st.visibility === 'hidden') return false;
              if (Number(st.opacity || '1') <= 0.01) return false;
              return true;
            } catch (e) {
              return true;
            }
          };

          const pickHighlightTarget = (el) => {
            // пытаемся подняться до видимого предка с “нормальным” размером
            let cur = el;
            for (let i = 0; i < 8 && cur; i += 1) {
              if (isVisible(cur)) {
                const r = cur.getBoundingClientRect();
                const area = Math.max(0, r.width) * Math.max(0, r.height);
                if (area >= 120) return cur;
              }
              cur = cur.parentElement;
            }
            return el;
          };

          const list = Array.from(document.querySelectorAll('a[href]'));
          const scored = list.map((a) => {
            const href = norm(a && a.href);
            const hrefNoQuery = strip(href);
            let score = 0;
            if (href === target) score += 100;
            if (hrefNoQuery && targetNoQuery && hrefNoQuery === targetNoQuery) score += 60;
            if (href && target && href.includes(target)) score += 20;
            if (target && href && target.includes(href)) score += 10;
            if (isVisible(a)) score += 15;
            return { a, score };
          }).sort((x, y) => y.score - x.score);

          const best = scored.length > 0 ? scored[0].a : null;
          if (!best) return false;
          openDetailsChain(best);
          const el = pickHighlightTarget(best);

          const disableSmooth = () => {
            try {
              const existing = document.getElementById('__crawlite_scroll_fix');
              if (existing) existing.remove();
              const st = document.createElement('style');
              st.id = '__crawlite_scroll_fix';
              st.textContent = 'html,body,*{scroll-behavior:auto !important;}';
              document.documentElement.appendChild(st);
              return () => { try { st.remove(); } catch (e) { /* noop */ } };
            } catch (e) {
              return () => {};
            }
          };
          const waitStable = (el) => {
            return new Promise((resolve) => {
              try {
                let last = el.getBoundingClientRect();
                let stable = 0;
                const started = Date.now();
                const tick = () => {
                  const r = el.getBoundingClientRect();
                  const d = Math.abs(r.top - last.top) + Math.abs(r.left - last.left);
                  last = r;
                  if (d < 0.5) stable += 1;
                  else stable = 0;
                  if (stable >= 3 || (Date.now() - started) > 800) return resolve(true);
                  requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              } catch (e) {
                resolve(true);
              }
            });
          };

          (async () => {
            const restore = disableSmooth();
            el.style.scrollMarginTop = '120px';
            try { el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) { /* noop */ } }
            await waitStable(el);
            try { restore(); } catch (e) { /* noop */ }

            const ov = ensureOverlay();
            if (ov && ov.box) {
              positionBox(ov.box, el);
              setTimeout(() => { try { positionBox(ov.box, el); } catch (e) { /* noop */ } }, 120);
            }

            setTimeout(() => {
              clearOverlay();
            }, 1400);
          })();

          return true;
        } catch (e) {
          return false;
        }
      })()
    `
    const ok = await browserView.webContents.executeJavaScript(js, true)
    return { success: Boolean(ok) }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('browser:highlight-image', async (_event, url: string) => {
  if (!browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  const target = typeof url === 'string' ? url.trim() : ''
  if (!target) {
    return { success: false, error: 'Empty URL' }
  }
  try {
    const js = `
      (function() {
        try {
          const clearOverlay = () => {
            try {
              const dim = document.getElementById('__crawlite_overlay_dim');
              const box = document.getElementById('__crawlite_overlay_box');
              if (dim) dim.remove();
              if (box) box.remove();
            } catch (e) { /* noop */ }
          };
          const ensureOverlay = () => {
            try {
              clearOverlay();
              const dim = document.createElement('div');
              dim.id = '__crawlite_overlay_dim';
              dim.style.position = 'fixed';
              dim.style.inset = '0';
              dim.style.background = 'rgba(0,0,0,0.65)';
              dim.style.pointerEvents = 'none';
              dim.style.zIndex = '2147483646';

              const box = document.createElement('div');
              box.id = '__crawlite_overlay_box';
              box.style.position = 'fixed';
              box.style.pointerEvents = 'none';
              box.style.zIndex = '2147483647';
              box.style.border = '2px solid rgba(74, 163, 255, 0.95)';
              box.style.background = 'rgba(74, 163, 255, 0.10)';
              box.style.borderRadius = '10px';
              box.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.25)';

              document.documentElement.appendChild(dim);
              document.documentElement.appendChild(box);
              return { dim, box };
            } catch (e) {
              return null;
            }
          };
          const positionBox = (box, el) => {
            try {
              const r = el.getBoundingClientRect();
              const pad = 6;
              const left = Math.max(8, r.left - pad);
              const top = Math.max(8, r.top - pad);
              const w = Math.max(0, r.width + pad * 2);
              const h = Math.max(0, r.height + pad * 2);
              box.style.left = left + 'px';
              box.style.top = top + 'px';
              box.style.width = w + 'px';
              box.style.height = h + 'px';
            } catch (e) { /* noop */ }
          };

          const targetRaw = ${JSON.stringify(target)};
          const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ');
          const strip = (u) => {
            try { const x = new URL(u); x.hash = ''; x.search = ''; return x.toString(); } catch (e) { return ''; }
          };
          const target = norm(targetRaw);
          const targetNoQuery = strip(target);
          const filename = (u) => {
            try { const x = new URL(u); const p = String(x.pathname || '').split('/').filter(Boolean).pop() || ''; return p.toLowerCase(); } catch (e) { return ''; }
          };
          const targetFile = filename(target);

          const isVisible = (el) => {
            try {
              if (!el) return false;
              const rects = el.getClientRects();
              if (!rects || rects.length === 0) return false;
              const st = window.getComputedStyle(el);
              if (!st) return true;
              if (st.display === 'none' || st.visibility === 'hidden') return false;
              if (Number(st.opacity || '1') <= 0.01) return false;
              return true;
            } catch (e) {
              return true;
            }
          };

          const pickUrl = (img) => {
            try {
              const c = img && img.currentSrc ? String(img.currentSrc) : '';
              const s = img && img.src ? String(img.src) : '';
              const a = img && img.getAttribute ? String(img.getAttribute('src') || '') : '';
              const d = img && img.getAttribute ? String(img.getAttribute('data-src') || '') : '';
              return norm(c || s || a || d);
            } catch (e) {
              return '';
            }
          };

          const list = Array.from(document.querySelectorAll('img'));
          const scored = list.map((img) => {
            const u = pickUrl(img);
            const uNoQuery = strip(u);
            let score = 0;
            if (u === target) score += 120;
            if (uNoQuery && targetNoQuery && uNoQuery === targetNoQuery) score += 80;
            if (targetFile && filename(u) === targetFile) score += 35;
            if (u && target && (u.includes(target) || target.includes(u))) score += 15;
            if (isVisible(img)) score += 15;
            return { img, score };
          }).sort((a, b) => b.score - a.score);

          const best = scored.length > 0 ? scored[0].img : null;
          if (!best) return false;

          // highlight target: если img слишком маленькая/inline, подсвечиваем ближайший видимый контейнер
          let el = best;
          for (let i = 0; i < 6 && el; i += 1) {
            if (isVisible(el)) {
              const r = el.getBoundingClientRect();
              const area = Math.max(0, r.width) * Math.max(0, r.height);
              if (area >= 160) break;
            }
            el = el.parentElement;
          }
          el = el || best;

          const disableSmooth = () => {
            try {
              const existing = document.getElementById('__crawlite_scroll_fix');
              if (existing) existing.remove();
              const st = document.createElement('style');
              st.id = '__crawlite_scroll_fix';
              st.textContent = 'html,body,*{scroll-behavior:auto !important;}';
              document.documentElement.appendChild(st);
              return () => { try { st.remove(); } catch (e) { /* noop */ } };
            } catch (e) {
              return () => {};
            }
          };
          const waitStable = (el) => {
            return new Promise((resolve) => {
              try {
                let last = el.getBoundingClientRect();
                let stable = 0;
                const started = Date.now();
                const tick = () => {
                  const r = el.getBoundingClientRect();
                  const d = Math.abs(r.top - last.top) + Math.abs(r.left - last.left);
                  last = r;
                  if (d < 0.5) stable += 1;
                  else stable = 0;
                  if (stable >= 3 || (Date.now() - started) > 800) return resolve(true);
                  requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              } catch (e) {
                resolve(true);
              }
            });
          };

          (async () => {
            const restore = disableSmooth();
            el.style.scrollMarginTop = '120px';
            try { el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) { /* noop */ } }
            await waitStable(el);
            try { restore(); } catch (e) { /* noop */ }

            const ov = ensureOverlay();
            if (ov && ov.box) {
              positionBox(ov.box, el);
              setTimeout(() => { try { positionBox(ov.box, el); } catch (e) { /* noop */ } }, 120);
            }

            setTimeout(() => {
              clearOverlay();
            }, 1400);
          })();

          return true;
        } catch (e) {
          return false;
        }
      })()
    `
    const ok = await browserView.webContents.executeJavaScript(js, true)
    return { success: Boolean(ok) }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('page:analyze', async (_event, url: string) => {
  const u = safeParseUrl(url)
  if (!u) {
    return { success: false, error: 'Invalid URL' }
  }

  ensureCrawlView()
  if (!crawlView) {
    return { success: false, error: 'Crawler view not available' }
  }

  const startedAt = Date.now()
  let loadOk = true
  try {
    await crawlView.webContents.loadURL(u.toString())
  } catch {
    loadOk = false
  }

  // небольшой буфер для динамического DOM
  try {
    await crawlView.webContents.executeJavaScript(`
      (function() {
        return new Promise((resolve) => {
          try { requestAnimationFrame(() => setTimeout(resolve, 250)); } catch (e) { setTimeout(resolve, 250); }
        });
      })()
    `)
  } catch {
    void 0
  }

  const finishedAt = Date.now()

  let extracted: (Omit<CrawlPageData, 'statusCode' | 'contentLength' | 'loadTimeMs' | 'analysisTimeMs' | 'discoveredAt' | 'ipAddress'> & { htmlBytes: number | null }) | null = null
  try {
    extracted = await extractPageDataFromView(crawlView)
  } catch {
    extracted = null
  }

  const finalUrlRaw = (extracted?.url || crawlView.webContents.getURL() || u.toString())
  const finalNormalized = normalizeUrl(finalUrlRaw) || normalizeUrl(u.toString())
  const meta = finalNormalized ? crawlMainFrameMetaByUrl.get(finalNormalized) : undefined
  let ipAddress = ''
  try {
    const host = safeParseUrl(finalUrlRaw)?.hostname || u.hostname
    ipAddress = await resolveHostIp(host)
  } catch {
    ipAddress = ''
  }

  const page: CrawlPageData = {
    url: finalUrlRaw,
    normalizedUrl: finalNormalized,
    title: extracted?.title || '',
    h1: extracted?.h1 || '',
    hasViewport: Boolean((extracted as any)?.hasViewport),
    hasCanonical: Boolean((extracted as any)?.hasCanonical),
    canonicalUrl: typeof (extracted as any)?.canonicalUrl === 'string' ? (extracted as any).canonicalUrl : '',
    metaRobots: typeof (extracted as any)?.metaRobots === 'string' ? (extracted as any).metaRobots : '',
    ipAddress,
    headingsRawCount: (extracted as any)?.headingsRawCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    headingsEmptyCount: (extracted as any)?.headingsEmptyCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    nestedHeadings: (extracted as any)?.nestedHeadings || [],
    headingsText: extracted?.headingsText || { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
    headingsCount: extracted?.headingsCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    description: extracted?.description || '',
    keywords: extracted?.keywords || '',
    statusCode: meta?.statusCode ?? null,
    contentLength: meta?.contentLength ?? (extracted?.htmlBytes ?? null),
    loadTimeMs: loadOk ? (finishedAt - startedAt) : null,
    analysisTimeMs: Date.now() - startedAt,
    discoveredAt: startedAt,
    links: extracted?.links || [],
    linksDetailed: Array.isArray((extracted as any)?.linksDetailed) ? (extracted as any).linksDetailed : [],
    images: extracted?.images || [],
    scripts: extracted?.scripts || [],
    stylesheets: extracted?.stylesheets || [],
    misc: (extracted as any)?.misc || [],
  }

  return { success: true, page }
})

ipcMain.handle('resource:head', async (_event, url: string) => {
  const u = safeParseUrl(url)
  if (!u) {
    return { success: false, error: 'Invalid URL' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { success: false, error: 'Unsupported protocol' }
  }

  try {
    const startedAt = Date.now()
    const contentLength = await probeResourceSize(u.toString())
    const elapsedMs = Date.now() - startedAt
    return { success: true, contentLength, elapsedMs }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('sitemap:build', async (_event, startUrl: string) => {
  const u = safeParseUrl(startUrl)
  if (!u) {
    return { success: false, error: 'Invalid URL' }
  }
  try {
    const data = await buildSitemapUrls(u.toString())
    return { success: true, sitemaps: data.sitemaps, urls: data.urls }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

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

