import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { Theme, UserConfig } from '../../types/userConfig'

export type AppView = 'dashboard' | 'browser' | 'sitemap' | 'settings'

interface AppState {
  isLoading: boolean
  error: string | null
  currentView: AppView
  theme: Theme
  locale: string
}

const initialState: AppState = {
  isLoading: false,
  error: null,
  currentView: 'browser',
  theme: 'dark',
  locale: 'ru',
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
    },
  },
})

export const { setLoading, setError, setCurrentView, hydrateFromConfig } = appSlice.actions
export default appSlice.reducer

