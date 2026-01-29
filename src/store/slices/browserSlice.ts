import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface BrowserState {
  currentUrl: string
  isReady: boolean
  requestedUrl: string
  isPageLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  pagesTreeExpandedIds: string[]
  deviceMode: 'desktop' | 'mobile' | 'tablet'
}

const initialState: BrowserState = {
  currentUrl: '',
  isReady: false,
  requestedUrl: '',
  isPageLoading: false,
  canGoBack: false,
  canGoForward: false,
  pagesTreeExpandedIds: ['root'],
  deviceMode: 'desktop',
}

export const browserSlice = createSlice({
  name: 'browser',
  initialState,
  reducers: {
    setBrowserReady: (state, action: PayloadAction<boolean>) => {
      state.isReady = action.payload
    },
    setCurrentUrl: (state, action: PayloadAction<string>) => {
      state.currentUrl = action.payload
    },
    requestNavigate: (state, action: PayloadAction<string>) => {
      state.requestedUrl = action.payload
    },
    clearRequestedNavigate: (state) => {
      state.requestedUrl = ''
    },
    setPageLoading: (state, action: PayloadAction<boolean>) => {
      state.isPageLoading = action.payload
    },
    setNavState: (state, action: PayloadAction<{ canGoBack: boolean; canGoForward: boolean; url?: string }>) => {
      state.canGoBack = Boolean(action.payload?.canGoBack)
      state.canGoForward = Boolean(action.payload?.canGoForward)
      if (typeof action.payload?.url === 'string') {
        state.currentUrl = action.payload.url
      }
    },
    setDeviceMode: (state, action: PayloadAction<'desktop' | 'mobile' | 'tablet'>) => {
      const mode = action.payload
      if (mode !== 'desktop' && mode !== 'mobile' && mode !== 'tablet') {
        return
      }
      state.deviceMode = mode
    },
    togglePagesTreeExpanded: (state, action: PayloadAction<string>) => {
      const id = String(action.payload || '')
      if (!id) return
      const set = new Set(state.pagesTreeExpandedIds || [])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      // корень всегда держим раскрытым
      set.add('root')
      state.pagesTreeExpandedIds = Array.from(set)
    },
    ensurePagesTreeExpanded: (state, action: PayloadAction<string[]>) => {
      const ids = Array.isArray(action.payload) ? action.payload.map((x) => String(x || '')).filter(Boolean) : []
      if (ids.length === 0) return
      const set = new Set(state.pagesTreeExpandedIds || [])
      set.add('root')
      ids.forEach((id) => set.add(id))
      state.pagesTreeExpandedIds = Array.from(set)
    },
  },
})

export const {
  setBrowserReady,
  setCurrentUrl,
  requestNavigate,
  clearRequestedNavigate,
  setPageLoading,
  setNavState,
  setDeviceMode,
  togglePagesTreeExpanded,
  ensurePagesTreeExpanded,
} = browserSlice.actions
export default browserSlice.reducer

