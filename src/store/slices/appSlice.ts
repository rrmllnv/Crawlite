import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { Theme, UserConfig } from '../../types/userConfig'

export type AppView = 'dashboard' | 'browser' | 'sitemap' | 'settings'

interface AppState {
  isLoading: boolean
  error: string | null
  currentView: AppView
  theme: Theme
  locale: string
  browserViewLayout: {
    pagesColWidthPx: number
    detailsColWidthPx: number
  }
}

const initialState: AppState = {
  isLoading: false,
  error: null,
  currentView: 'browser',
  theme: 'dark',
  locale: 'ru',
  browserViewLayout: {
    pagesColWidthPx: 320,
    detailsColWidthPx: 420,
  },
}

export const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
    setCurrentView: (state, action: PayloadAction<AppView>) => {
      state.currentView = action.payload
    },
    setBrowserViewLayout: (state, action: PayloadAction<Partial<AppState['browserViewLayout']>>) => {
      state.browserViewLayout = {
        ...state.browserViewLayout,
        ...(action.payload || {}),
      }
    },
    commitBrowserViewLayout: (state, action: PayloadAction<AppState['browserViewLayout']>) => {
      const payload = action.payload
      if (!payload || typeof payload !== 'object') {
        return
      }
      state.browserViewLayout = {
        ...state.browserViewLayout,
        ...payload,
      }
    },
    hydrateFromConfig: (state, action: PayloadAction<UserConfig | null>) => {
      const cfg = action.payload
      if (!cfg) {
        return
      }
      if (cfg?.app?.theme) {
        state.theme = cfg.app.theme
      }
      if (typeof cfg?.app?.locale === 'string' && cfg.app.locale.trim()) {
        state.locale = cfg.app.locale.trim()
      }
      if (cfg?.app?.currentView) {
        state.currentView = cfg.app.currentView
      }
      const layout = (cfg?.app as any)?.browserViewLayout
      if (layout && typeof layout === 'object') {
        const pagesRaw = (layout as any).pagesColWidthPx
        const detailsRaw = (layout as any).detailsColWidthPx
        if (typeof pagesRaw === 'number' && Number.isFinite(pagesRaw) && pagesRaw > 0) {
          state.browserViewLayout.pagesColWidthPx = Math.floor(pagesRaw)
        }
        if (typeof detailsRaw === 'number' && Number.isFinite(detailsRaw) && detailsRaw > 0) {
          state.browserViewLayout.detailsColWidthPx = Math.floor(detailsRaw)
        }
      }
    },
  },
})

export const {
  setLoading,
  setError,
  setCurrentView,
  setBrowserViewLayout,
  commitBrowserViewLayout,
  hydrateFromConfig,
} = appSlice.actions
export default appSlice.reducer

