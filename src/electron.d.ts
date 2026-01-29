export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export type CrawlStartParams = {
  startUrl: string
  options?: {
    maxPages?: number
    delayMs?: number
    jitterMs?: number
  }
}

export type ElectronResult<T = unknown> = {
  success: boolean
  error?: string
} & T

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

export interface ElectronAPI {
  browserEnsure: (bounds: BrowserBounds) => Promise<ElectronResult>
  browserResize: (bounds: BrowserBounds) => Promise<ElectronResult>
  browserNavigate: (url: string) => Promise<ElectronResult>

  crawlStart: (params: CrawlStartParams) => Promise<ElectronResult<{ runId?: string }>>
  crawlCancel: (runId: string) => Promise<ElectronResult>

  loadUserConfig: () => Promise<any>
  saveUserConfig: (userConfig: any) => Promise<boolean>

  onCrawlEvent: (listener: (event: CrawlEvent) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

