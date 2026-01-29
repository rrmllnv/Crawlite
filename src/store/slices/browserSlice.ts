import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface BrowserState {
  currentUrl: string
  isReady: boolean
}

const initialState: BrowserState = {
  currentUrl: '',
  isReady: false,
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
  },
})

export const { setBrowserReady, setCurrentUrl } = browserSlice.actions
export default browserSlice.reducer

