import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface BrowserState {
  currentUrl: string
  isReady: boolean
  requestedUrl: string
  isPageLoading: boolean
}

const initialState: BrowserState = {
  currentUrl: '',
  isReady: false,
  requestedUrl: '',
  isPageLoading: false,
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
  },
})

export const { setBrowserReady, setCurrentUrl, requestNavigate, clearRequestedNavigate, setPageLoading } = browserSlice.actions
export default browserSlice.reducer

