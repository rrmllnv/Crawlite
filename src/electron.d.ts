export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export type CrawlStartParams = {
  startUrl: string
  options?: {
    maxDepth?: number
    maxPages?: number
    delayMs?: number
    jitterMs?: number
    /** true = убирать дубликаты ссылок по URL; false = сохранять все (по умолчанию) */
    deduplicateLinks?: boolean
    userAgent?: string
    acceptLanguage?: string
    platform?: string
    overrideWebdriver?: boolean
  }
}

export type ElectronResult<T = unknown> = {
  success: boolean
  error?: string
} & T

export type BrowserDeviceMode = 'desktop' | 'mobile' | 'tablet'

export type BrowserEvent =
  | { type: 'loading'; isLoading: boolean }
  | { type: 'nav'; canGoBack: boolean; canGoForward: boolean; url?: string }

export type CrawlEvent =
  | {
      type: 'started'
      runId: string
      startedAt: number
      startUrl: string
      options: { maxPages: number; delayMs: number; jitterMs: number }
    }
  | { type: 'cancelled'; runId: string; processed: number; finishedAt: number; queued: number }
  | { type: 'finished'; runId: string; processed: number; finishedAt: number; queued: number }
  | { type: 'page:loading'; runId: string; url: string; processed: number; queued: number }
  | { type: 'page:discovered'; runId: string; page: CrawlPageData; processed: number; queued: number }
  | {
      type: 'page:done'
      runId: string
      processed: number
      queued: number
      ok: boolean
      page: CrawlPageData
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

export interface ElectronAPI {
  browserEnsure: (bounds: BrowserBounds) => Promise<ElectronResult>
  browserResize: (bounds: BrowserBounds) => Promise<ElectronResult>
  browserSetVisible: (visible: boolean) => Promise<ElectronResult>
  browserNavigate: (url: string) => Promise<ElectronResult>
  browserGoBack: () => Promise<ElectronResult>
  browserGoForward: () => Promise<ElectronResult>
  browserReload: () => Promise<ElectronResult>
  browserSetDeviceMode: (mode: BrowserDeviceMode) => Promise<ElectronResult>
  browserHighlightHeading: (payload: { level: number; text: string }) => Promise<ElectronResult>
  browserHighlightLink: (url: string) => Promise<ElectronResult>
  browserHighlightImage: (url: string) => Promise<ElectronResult>

  crawlStart: (params: CrawlStartParams) => Promise<ElectronResult<{ runId?: string }>>
  crawlCancel: (runId: string) => Promise<ElectronResult>

  pageAnalyze: (url: string) => Promise<ElectronResult<{ page?: CrawlPageData }>>

  loadUserConfig: () => Promise<any>
  saveUserConfig: (userConfig: any) => Promise<boolean>

  downloadFile: (url: string) => Promise<ElectronResult>
  resourceHead: (url: string) => Promise<ElectronResult<{ contentLength?: number | null; elapsedMs?: number | null }>>

  sitemapBuild: (startUrl: string, options?: { maxUrls?: number }) => Promise<
    ElectronResult<{
      sitemaps?: string[]
      urls?: string[]
      urlMetaByUrl?: Record<string, { lastmod?: string; changefreq?: string; priority?: string }>
      truncated?: boolean
      maxUrlsUsed?: number
    }>
  >

  onBrowserEvent: (listener: (event: BrowserEvent) => void) => () => void
  onCrawlEvent: (listener: (event: CrawlEvent) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

