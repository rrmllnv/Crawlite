import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { CrawlPageData } from '../../electron'
import type { UserConfig } from '../../types/userConfig'

export type CrawlStatus = 'idle' | 'running' | 'finished' | 'cancelled' | 'error'

interface CrawlState {
  status: CrawlStatus
  runId: string | null
  startUrl: string
  processed: number
  queued: number
  settings: {
    maxDepth: number
    maxPages: number
  }
  pagesByUrl: Record<string, CrawlPageData>
  pageOrder: string[]
  selectedUrl: string
}

const initialState: CrawlState = {
  status: 'idle',
  runId: null,
  startUrl: '',
  processed: 0,
  queued: 0,
  settings: {
    maxDepth: 2,
    maxPages: 200,
  },
  pagesByUrl: {},
  pageOrder: [],
  selectedUrl: '',
}

export const crawlSlice = createSlice({
  name: 'crawl',
  initialState,
  reducers: {
    resetCrawl: () => initialState,
    setCrawlStatus: (state, action: PayloadAction<CrawlStatus>) => {
      state.status = action.payload
    },
    setRunId: (state, action: PayloadAction<string | null>) => {
      state.runId = action.payload
    },
    setStartUrl: (state, action: PayloadAction<string>) => {
      state.startUrl = action.payload
    },
    setProgress: (state, action: PayloadAction<{ processed: number; queued: number }>) => {
      state.processed = action.payload.processed
      state.queued = action.payload.queued
    },
    setCrawlSettings: (state, action: PayloadAction<Partial<CrawlState['settings']>>) => {
      state.settings = {
        ...state.settings,
        ...(action.payload || {}),
      }
    },
    hydrateFromConfig: (state, action: PayloadAction<UserConfig | null>) => {
      const cfg = action.payload
      if (!cfg || !cfg.crawling) {
        return
      }
      const maxDepthRaw = (cfg.crawling as any).maxDepth
      const maxPagesRaw = (cfg.crawling as any).maxPages
      const maxDepth = typeof maxDepthRaw === 'number' && Number.isFinite(maxDepthRaw) ? Math.max(0, Math.floor(maxDepthRaw)) : state.settings.maxDepth
      const maxPages = typeof maxPagesRaw === 'number' && Number.isFinite(maxPagesRaw) ? Math.max(1, Math.floor(maxPagesRaw)) : state.settings.maxPages
      state.settings.maxDepth = maxDepth
      state.settings.maxPages = maxPages
    },
    upsertPage: (state, action: PayloadAction<CrawlPageData>) => {
      const page = action.payload
      const key = page.normalizedUrl || page.url
      if (!key) {
        return
      }
      const exists = Boolean(state.pagesByUrl[key])
      state.pagesByUrl[key] = page
      if (!exists) {
        state.pageOrder.push(key)
      }
      if (!state.selectedUrl) {
        state.selectedUrl = key
      }
    },
    selectPage: (state, action: PayloadAction<string>) => {
      state.selectedUrl = action.payload
    },
  },
})

export const {
  resetCrawl,
  setCrawlStatus,
  setRunId,
  setStartUrl,
  setProgress,
  setCrawlSettings,
  hydrateFromConfig,
  upsertPage,
  selectPage,
} = crawlSlice.actions

export default crawlSlice.reducer

