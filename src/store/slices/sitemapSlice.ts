import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { UserConfig } from '../../types/userConfig'

export interface SiteMapSettings {
  maxUrls: number
  virtualChildrenThreshold: number
  virtualListHeightPx: number
}

export interface SiteMapState {
  isBuilding: boolean
  error: string
  urls: string[]
  sitemaps: string[]
  urlMetaByUrl: Record<string, { lastmod?: string; changefreq?: string; priority?: string }>
  truncated: boolean
  maxUrlsUsed: number
  expandedIds: string[]
  scrollTop: number
  settings: SiteMapSettings
}

const DEFAULT_MAX_URLS = 200000
const DEFAULT_VIRTUAL_THRESHOLD = 40
const DEFAULT_VIRTUAL_LIST_HEIGHT_PX = 400

const initialState: SiteMapState = {
  isBuilding: false,
  error: '',
  urls: [],
  sitemaps: [],
  urlMetaByUrl: {},
  truncated: false,
  maxUrlsUsed: DEFAULT_MAX_URLS,
  expandedIds: ['root'],
  scrollTop: 0,
  settings: {
    maxUrls: DEFAULT_MAX_URLS,
    virtualChildrenThreshold: DEFAULT_VIRTUAL_THRESHOLD,
    virtualListHeightPx: DEFAULT_VIRTUAL_LIST_HEIGHT_PX,
  },
}

export const sitemapSlice = createSlice({
  name: 'sitemap',
  initialState,
  reducers: {
    setBuilding: (state, action: PayloadAction<boolean>) => {
      state.isBuilding = action.payload
    },
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload || ''
    },
    setData: (
      state,
      action: PayloadAction<{
        urls: string[]
        sitemaps: string[]
        urlMetaByUrl?: Record<string, { lastmod?: string; changefreq?: string; priority?: string }>
        truncated?: boolean
        maxUrlsUsed?: number
      }>
    ) => {
      const urls = Array.isArray(action.payload?.urls) ? action.payload.urls : []
      const sitemaps = Array.isArray(action.payload?.sitemaps) ? action.payload.sitemaps : []
      const urlMetaByUrl =
        action.payload?.urlMetaByUrl && typeof action.payload.urlMetaByUrl === 'object'
          ? (action.payload.urlMetaByUrl as Record<string, { lastmod?: string; changefreq?: string; priority?: string }>)
          : {}
      const truncated = Boolean(action.payload?.truncated)
      const maxUrlsUsedRaw = action.payload?.maxUrlsUsed
      const maxUrlsUsed =
        typeof maxUrlsUsedRaw === 'number' && Number.isFinite(maxUrlsUsedRaw)
          ? Math.max(1000, Math.min(2000000, Math.floor(maxUrlsUsedRaw)))
          : state.settings.maxUrls
      state.urls = urls
      state.sitemaps = sitemaps
      state.urlMetaByUrl = urlMetaByUrl
      state.truncated = truncated
      state.maxUrlsUsed = maxUrlsUsed
      state.expandedIds = ['root']
      state.scrollTop = 0
    },
    clear: (state) => {
      state.isBuilding = false
      state.error = ''
      state.urls = []
      state.sitemaps = []
      state.urlMetaByUrl = {}
      state.truncated = false
      state.maxUrlsUsed = state.settings.maxUrls
      state.expandedIds = ['root']
      state.scrollTop = 0
    },
    setSitemapSettings: (state, action: PayloadAction<Partial<SiteMapSettings>>) => {
      if (!action.payload || typeof action.payload !== 'object') return
      const maxUrlsRaw = action.payload.maxUrls
      if (typeof maxUrlsRaw === 'number' && Number.isFinite(maxUrlsRaw)) {
        const v = Math.max(1000, Math.min(2000000, Math.floor(maxUrlsRaw)))
        state.settings.maxUrls = v
      }
      const thresholdRaw = (action.payload as any).virtualChildrenThreshold
      if (typeof thresholdRaw === 'number' && Number.isFinite(thresholdRaw)) {
        // 0 = виртуализация всегда; верхнюю границу держим разумной
        state.settings.virtualChildrenThreshold = Math.max(0, Math.min(10000, Math.floor(thresholdRaw)))
      }
      const heightRaw = (action.payload as any).virtualListHeightPx
      if (typeof heightRaw === 'number' && Number.isFinite(heightRaw)) {
        state.settings.virtualListHeightPx = Math.max(120, Math.min(2000, Math.floor(heightRaw)))
      }
    },
    hydrateFromConfig: (state, action: PayloadAction<UserConfig | null>) => {
      const cfg = action.payload
      if (!cfg || !cfg.sitemap) return
      const maxUrlsRaw = cfg.sitemap.maxUrls
      if (typeof maxUrlsRaw === 'number' && Number.isFinite(maxUrlsRaw)) {
        const v = Math.max(1000, Math.min(2000000, Math.floor(maxUrlsRaw)))
        state.settings.maxUrls = v
      }
      const thresholdRaw = (cfg.sitemap as any).virtualChildrenThreshold
      if (typeof thresholdRaw === 'number' && Number.isFinite(thresholdRaw)) {
        state.settings.virtualChildrenThreshold = Math.max(0, Math.min(10000, Math.floor(thresholdRaw)))
      }
      const heightRaw = (cfg.sitemap as any).virtualListHeightPx
      if (typeof heightRaw === 'number' && Number.isFinite(heightRaw)) {
        state.settings.virtualListHeightPx = Math.max(120, Math.min(2000, Math.floor(heightRaw)))
      }
    },
    toggleExpanded: (state, action: PayloadAction<string>) => {
      const id = String(action.payload || '')
      if (!id) return
      const set = new Set(state.expandedIds)
      if (set.has(id)) set.delete(id)
      else set.add(id)
      state.expandedIds = Array.from(set)
    },
    setExpandedIds: (state, action: PayloadAction<string[]>) => {
      const ids = Array.isArray(action.payload) ? action.payload.map((x) => String(x || '')).filter(Boolean) : []
      state.expandedIds = ids.length > 0 ? Array.from(new Set(ids)) : ['root']
    },
    setScrollTop: (state, action: PayloadAction<number>) => {
      const v = typeof action.payload === 'number' && Number.isFinite(action.payload) ? action.payload : 0
      state.scrollTop = v < 0 ? 0 : v
    },
  },
})

export const {
  setBuilding,
  setError,
  setData,
  clear,
  toggleExpanded,
  setExpandedIds,
  setScrollTop,
  setSitemapSettings,
  hydrateFromConfig,
} = sitemapSlice.actions
export default sitemapSlice.reducer

