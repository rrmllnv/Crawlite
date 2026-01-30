import type { BrowserWindow, WebContentsView } from 'electron'

export type BrowserBounds = { x: number; y: number; width: number; height: number }
export type DeviceMode = 'desktop' | 'mobile' | 'tablet'

export type CrawlStartParams = {
  startUrl: string
  options?: {
    maxDepth?: number
    maxPages?: number
    delayMs?: number
    jitterMs?: number
    /** true = убирать дубликаты ссылок по URL; false = сохранять все */
    deduplicateLinks?: boolean
    /** Доп. ожидание (ms) перед извлечением данных при анализе страницы */
    analyzeWaitMs?: number
    /** Таймаут (ms) загрузки страницы */
    pageLoadTimeoutMs?: number
    /** Переопределить User-Agent (пусто = не трогать) */
    userAgent?: string
    /** Переопределить Accept-Language (пусто = не трогать) */
    acceptLanguage?: string
    /** Переопределить navigator.platform (пусто = не трогать) */
    platform?: string
    /** Попытаться скрыть navigator.webdriver (JS-override) */
    overrideWebdriver?: boolean
  }
}

export type CrawlPageData = {
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

export type ActiveCrawl = { runId: string; cancelled: boolean } | null

export type AppState = {
  mainWindow: BrowserWindow | null
  browserView: WebContentsView | null
  crawlView: WebContentsView | null
  browserViewLastBounds: BrowserBounds | null
  browserViewIsVisible: boolean
  browserViewDesktopUserAgent: string | null
  browserViewDeviceMode: DeviceMode
  activeCrawl: ActiveCrawl
  crawlMainFrameMetaByUrl: Map<string, { statusCode: number | null; contentLength: number | null }>
  crawlWebRequestAttachedForWebContentsId: number | null
  crawlRequestHeadersOverride: { userAgent?: string; acceptLanguage?: string } | null
  crawlDebuggerAttachedForWebContentsId: number | null
  crawlStealthScriptId: string | null
}
