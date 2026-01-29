import { configureStore } from '@reduxjs/toolkit'
import appReducer from './slices/appSlice'
import crawlReducer from './slices/crawlSlice'
import browserReducer from './slices/browserSlice'
import sitemapReducer from './slices/sitemapSlice'
import { userConfigMiddleware } from './middleware/userConfigMiddleware'

export const store = configureStore({
  reducer: {
    app: appReducer,
    crawl: crawlReducer,
    browser: browserReducer,
    sitemap: sitemapReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(userConfigMiddleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

