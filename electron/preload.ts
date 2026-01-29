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

  crawlStart: (params: CrawlStartParams) => ipcRenderer.invoke('crawl:start', params),
  crawlCancel: (runId: string) => ipcRenderer.invoke('crawl:cancel', runId),

  loadUserConfig: () => ipcRenderer.invoke('load-user-config'),
  saveUserConfig: (userConfig: any) => ipcRenderer.invoke('save-user-config', userConfig),

  downloadFile: (url: string) => ipcRenderer.invoke('download:file', url),

  onCrawlEvent: (listener: (event: unknown) => void) => {
    const handler = (_evt: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on('crawl:event', handler)
    return () => {
      ipcRenderer.removeListener('crawl:event', handler)
    }
  },
})

