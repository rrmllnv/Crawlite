import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { CrawlPageData } from '../../electron'
import type { UserConfig } from '../../types/userConfig'

export type CrawlStatus = 'idle' | 'running' | 'finished' | 'cancelled' | 'error'

export type CrawlErrorItem = {
  url: string
  at: number
}

interface CrawlState {
  status: CrawlStatus
  runId: string | null
  startUrl: string
  processed: number
  queued: number
  settings: {
    maxDepth: number
    maxPages: number
    deduplicateLinks: boolean
    delayMs: number
    jitterMs: number
    userAgent: string
    acceptLanguage: string
    platform: string
    overrideWebdriver: boolean
    analyzeWaitMs: number
    pageLoadTimeoutMs: number
  }
  pagesByUrl: Record<string, CrawlPageData>
  pageOrder: string[]
  selectedUrl: string
  errors: CrawlErrorItem[]
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
    deduplicateLinks: false,
    delayMs: 650,
    jitterMs: 350,
    userAgent: '',
    acceptLanguage: '',
    platform: '',
    overrideWebdriver: false,
    analyzeWaitMs: 0,
    pageLoadTimeoutMs: 10000,
  },
  pagesByUrl: {},
  pageOrder: [],
  selectedUrl: '',
  errors: [],
}

export const crawlSlice = createSlice({
  name: 'crawl',
  initialState,
  reducers: {
    resetCrawl: (state) => {
      // ВАЖНО: настройки crawling (maxDepth/maxPages) не сбрасываем,
      // иначе “лимиты” и сохранение в UserConfig ломаются при любом запуске.
      const preservedSettings = state.settings
      state.status = 'idle'
      state.runId = null
      state.startUrl = ''
      state.processed = 0
      state.queued = 0
      state.pagesByUrl = {}
      state.pageOrder = []
      state.selectedUrl = ''
      state.errors = []
      state.settings = preservedSettings
    },
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
      const deduplicateLinksRaw = (cfg.crawling as any).deduplicateLinks
      const delayMsRaw = (cfg.crawling as any).delayMs
      const jitterMsRaw = (cfg.crawling as any).jitterMs
      const userAgentRaw = (cfg.crawling as any).userAgent
      const acceptLanguageRaw = (cfg.crawling as any).acceptLanguage
      const platformRaw = (cfg.crawling as any).platform
      const overrideWebdriverRaw = (cfg.crawling as any).overrideWebdriver
      const analyzeWaitMsRaw = (cfg.crawling as any).analyzeWaitMs
      const pageLoadTimeoutMsRaw = (cfg.crawling as any).pageLoadTimeoutMs
      const maxDepth = typeof maxDepthRaw === 'number' && Number.isFinite(maxDepthRaw) ? Math.max(0, Math.floor(maxDepthRaw)) : state.settings.maxDepth
      const maxPages = typeof maxPagesRaw === 'number' && Number.isFinite(maxPagesRaw) ? Math.max(1, Math.floor(maxPagesRaw)) : state.settings.maxPages
      const deduplicateLinks = typeof deduplicateLinksRaw === 'boolean' ? deduplicateLinksRaw : state.settings.deduplicateLinks
      state.settings.maxDepth = maxDepth
      state.settings.maxPages = maxPages
      state.settings.deduplicateLinks = deduplicateLinks
      if (typeof delayMsRaw === 'number' && Number.isFinite(delayMsRaw)) {
        state.settings.delayMs = Math.max(0, Math.min(60000, Math.floor(delayMsRaw)))
      }
      if (typeof jitterMsRaw === 'number' && Number.isFinite(jitterMsRaw)) {
        state.settings.jitterMs = Math.max(0, Math.min(60000, Math.floor(jitterMsRaw)))
      }
      state.settings.userAgent = typeof userAgentRaw === 'string' ? userAgentRaw : state.settings.userAgent
      state.settings.acceptLanguage = typeof acceptLanguageRaw === 'string' ? acceptLanguageRaw : state.settings.acceptLanguage
      state.settings.platform = typeof platformRaw === 'string' ? platformRaw : state.settings.platform
      state.settings.overrideWebdriver = typeof overrideWebdriverRaw === 'boolean' ? overrideWebdriverRaw : state.settings.overrideWebdriver
      if (typeof analyzeWaitMsRaw === 'number' && Number.isFinite(analyzeWaitMsRaw)) {
        state.settings.analyzeWaitMs = Math.max(0, Math.min(60000, Math.floor(analyzeWaitMsRaw)))
      }
      if (typeof pageLoadTimeoutMsRaw === 'number' && Number.isFinite(pageLoadTimeoutMsRaw)) {
        state.settings.pageLoadTimeoutMs = Math.max(1000, Math.min(300000, Math.floor(pageLoadTimeoutMsRaw)))
      }
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
    addError: (state, action: PayloadAction<CrawlErrorItem>) => {
      const item = action.payload
      if (!item || typeof item.url !== 'string' || !item.url.trim()) {
        return
      }
      state.errors.push({
        url: item.url.trim(),
        at: typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : Date.now(),
      })
      if (state.errors.length > 500) {
        state.errors = state.errors.slice(state.errors.length - 500)
      }
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
  addError,
} = crawlSlice.actions

export default crawlSlice.reducer

