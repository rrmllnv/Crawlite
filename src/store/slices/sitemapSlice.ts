import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface SiteMapState {
  isBuilding: boolean
  error: string
  urls: string[]
  sitemaps: string[]
  expandedIds: string[]
}

const initialState: SiteMapState = {
  isBuilding: false,
  error: '',
  urls: [],
  sitemaps: [],
  expandedIds: ['root'],
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
    setData: (state, action: PayloadAction<{ urls: string[]; sitemaps: string[] }>) => {
      const urls = Array.isArray(action.payload?.urls) ? action.payload.urls : []
      const sitemaps = Array.isArray(action.payload?.sitemaps) ? action.payload.sitemaps : []
      state.urls = urls
      state.sitemaps = sitemaps
      state.expandedIds = ['root']
    },
    clear: () => initialState,
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
  },
})

export const { setBuilding, setError, setData, clear, toggleExpanded, setExpandedIds } = sitemapSlice.actions
export default sitemapSlice.reducer

