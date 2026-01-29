import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface BrowserState {
  currentUrl: string
  isReady: boolean
  requestedUrl: string
}

const initialState: BrowserState = {
  currentUrl: '',
  isReady: false,
  requestedUrl: '',
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
  },
})

export const { setBrowserReady, setCurrentUrl, requestNavigate, clearRequestedNavigate } = browserSlice.actions
export default browserSlice.reducer

