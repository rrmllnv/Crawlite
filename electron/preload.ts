import { ipcRenderer, contextBridge } from 'electron'

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

contextBridge.exposeInMainWorld('electronAPI', {
  browserEnsure: (bounds: BrowserBounds) => ipcRenderer.invoke('browser:ensure', bounds),
  browserResize: (bounds: BrowserBounds) => ipcRenderer.invoke('browser:resize', bounds),
  browserSetVisible: (visible: boolean) => ipcRenderer.invoke('browser:set-visible', visible),
  browserNavigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
  browserGoBack: () => ipcRenderer.invoke('browser:go-back'),
  browserGoForward: () => ipcRenderer.invoke('browser:go-forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  browserSetDeviceMode: (mode: 'desktop' | 'mobile' | 'tablet') => ipcRenderer.invoke('browser:set-device-mode', mode),
  browserHighlightHeading: (payload: { level: number; text: string }) => ipcRenderer.invoke('browser:highlight-heading', payload),
  browserHighlightLink: (url: string) => ipcRenderer.invoke('browser:highlight-link', url),
  browserHighlightImage: (url: string) => ipcRenderer.invoke('browser:highlight-image', url),

  crawlStart: (params: CrawlStartParams) => ipcRenderer.invoke('crawl:start', params),
  crawlCancel: (runId: string) => ipcRenderer.invoke('crawl:cancel', runId),

  pageAnalyze: (url: string, options?: CrawlStartParams['options']) => ipcRenderer.invoke('page:analyze', url, options),

  loadUserConfig: () => ipcRenderer.invoke('load-user-config'),
  saveUserConfig: (userConfig: any) => ipcRenderer.invoke('save-user-config', userConfig),

  downloadFile: (url: string) => ipcRenderer.invoke('download:file', url),
  resourceHead: (url: string) => ipcRenderer.invoke('resource:head', url),

  sitemapBuild: (startUrl: string, options?: { maxUrls?: number }) =>
    ipcRenderer.invoke('sitemap:build', startUrl, options),

  onBrowserEvent: (listener: (event: unknown) => void) => {
    const handler = (_evt: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('browser:event', handler)
    return () => {
      ipcRenderer.removeListener('browser:event', handler)
    }
  },

  onCrawlEvent: (listener: (event: unknown) => void) => {
    const handler = (_evt: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('crawl:event', handler)
    return () => {
      ipcRenderer.removeListener('crawl:event', handler)
    }
  },
})

