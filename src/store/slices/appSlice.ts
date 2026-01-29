import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export type AppView = 'dashboard' | 'browser' | 'sitemap' | 'settings'

interface AppState {
  isLoading: boolean
  error: string | null
  currentView: AppView
}

const initialState: AppState = {
  isLoading: false,
  error: null,
  currentView: 'browser',
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
  },
})

export const { setLoading, setError, setCurrentView } = appSlice.actions
export default appSlice.reducer

