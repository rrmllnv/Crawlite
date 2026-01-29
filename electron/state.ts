import type { BrowserWindow, WebContentsView } from 'electron'
import type { AppState, BrowserBounds } from './types'

export const appState: AppState = {
  mainWindow: null as BrowserWindow | null,
  browserView: null as WebContentsView | null,
  crawlView: null as WebContentsView | null,
  browserViewLastBounds: null as BrowserBounds | null,
  browserViewIsVisible: true,
  browserViewDesktopUserAgent: null as string | null,
  browserViewDeviceMode: 'desktop',
  activeCrawl: null,
  crawlMainFrameMetaByUrl: new Map(),
  crawlWebRequestAttachedForWebContentsId: null,
}
