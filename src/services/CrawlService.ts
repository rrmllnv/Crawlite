import type { CrawlStartParams, CrawlEvent } from '../electron'

class CrawlService {
  async start(params: CrawlStartParams) {
    return await window.electronAPI.crawlStart(params)
  }

  async cancel(runId: string) {
    return await window.electronAPI.crawlCancel(runId)
  }

  onEvent(listener: (event: CrawlEvent) => void) {
    return window.electronAPI.onCrawlEvent(listener)
  }
}

export const crawlService = new CrawlService()

