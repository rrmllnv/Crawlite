import { WebContentsView } from 'electron'
import type { BrowserBounds } from '../types'
import { appState } from '../state'
import { attachCrawlWebRequestListeners } from './crawlWebRequest'
import { buildMobileUserAgent } from './userAgent'

export const BROWSER_SCROLLBAR_CSS = `
  /* App-injected scrollbar styling (WebContentsView) */
  :root {
    color-scheme: dark;
  }
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  ::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.04);
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.16);
    border-radius: 10px;
    border: 2px solid rgba(0, 0, 0, 0);
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.22);
    border: 2px solid rgba(0, 0, 0, 0);
    background-clip: padding-box;
  }
`

export function ensureBrowserView(bounds: BrowserBounds): void {
  const mainWindow = appState.mainWindow
  if (!mainWindow) {
    return
  }
  if (!appState.browserView) {
    appState.browserView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })
    const browserView = appState.browserView
    mainWindow.contentView.addChildView(browserView)
    try {
      appState.browserViewDesktopUserAgent = browserView.webContents.getUserAgent()
    } catch {
      appState.browserViewDesktopUserAgent = null
    }
    try {
      const sendNavState = () => {
        try {
          if (!appState.browserView) return
          const wc = appState.browserView.webContents
          appState.mainWindow?.webContents.send('browser:event', {
            type: 'nav',
            canGoBack: wc.canGoBack(),
            canGoForward: wc.canGoForward(),
            url: wc.getURL(),
          })
        } catch {
          void 0
        }
      }

      const INSPECT_LOG_PREFIX = '__CRAWLITE_INSPECTOR_ELEMENT__:'
      browserView.webContents.on('console-message', (_event, _level, message) => {
        try {
          const msg = typeof message === 'string' ? message : ''
          if (!msg.startsWith(INSPECT_LOG_PREFIX)) return
          const requestId = msg.slice(INSPECT_LOG_PREFIX.length).trim()
          if (!requestId) return

          void (async () => {
            try {
              if (!appState.browserView) return
              const wc = appState.browserView.webContents
              if (wc.isDestroyed()) return
              const payload = await wc.executeJavaScript(
                `
                  (function() {
                    try {
                      const KEY = '__crawlite_inspector_selected_element';
                      const v = window[KEY] || null;
                      if (v && v.requestId && String(v.requestId) === ${JSON.stringify(requestId)}) {
                        try { window[KEY] = null; } catch (e) { /* noop */ }
                        return v;
                      }
                      return null;
                    } catch (e) {
                      return null;
                    }
                  })()
                `,
                true
              )
              if (!payload) return
              appState.mainWindow?.webContents.send('browser:event', {
                type: 'inspector:element',
                element: payload,
              })
            } catch {
              void 0
            }
          })()
        } catch {
          void 0
        }
      })

      browserView.webContents.on('did-start-loading', () => {
        try {
          appState.mainWindow?.webContents.send('browser:event', { type: 'loading', isLoading: true })
        } catch {
          void 0
        }
      })
      const stop = () => {
        try {
          appState.mainWindow?.webContents.send('browser:event', { type: 'loading', isLoading: false })
        } catch {
          void 0
        }
        sendNavState()
      }
      browserView.webContents.on('did-stop-loading', stop)
      browserView.webContents.on('did-fail-load', stop)

      browserView.webContents.on('did-navigate', sendNavState)
      browserView.webContents.on('did-navigate-in-page', sendNavState)
      browserView.webContents.on('did-start-navigation', sendNavState)

      const injectScrollbarCSS = () => {
        try {
          const wc = appState.browserView?.webContents
          if (!wc || wc.isDestroyed()) return
          void wc.insertCSS(BROWSER_SCROLLBAR_CSS, { cssOrigin: 'user' }).catch(() => void 0)
        } catch {
          void 0
        }
      }
      browserView.webContents.on('did-finish-load', () => {
        injectScrollbarCSS()
        setTimeout(injectScrollbarCSS, 150)
      })
      injectScrollbarCSS()
      sendNavState()
    } catch {
      void 0
    }
  }
  appState.browserViewLastBounds = bounds
  if (!appState.browserViewIsVisible) {
    appState.browserView.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    return
  }
  appState.browserView.setBounds(bounds)
  if (appState.browserViewDeviceMode === 'mobile' || appState.browserViewDeviceMode === 'tablet') {
    try {
      const size = { width: bounds.width, height: bounds.height }
      appState.browserView.webContents.enableDeviceEmulation({
        screenPosition: 'mobile',
        screenSize: size,
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 0,
        viewSize: size,
        scale: 1,
      })
    } catch {
      void 0
    }
  }
}

export function ensureCrawlView(): void {
  if (!appState.crawlView) {
    appState.crawlView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })
    try {
      appState.crawlView.webContents.setAudioMuted(true)
    } catch {
      void 0
    }
  }

  if (appState.mainWindow) {
    try {
      if (appState.crawlView && !appState.mainWindow.contentView.children.includes(appState.crawlView)) {
        appState.mainWindow.contentView.addChildView(appState.crawlView)
      }
      appState.crawlView.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    } catch {
      void 0
    }
  }

  if (appState.crawlView) {
    attachCrawlWebRequestListeners(appState.crawlView)
  }
}

export function setBrowserViewVisible(visible: boolean): { success: boolean; error?: string } {
  appState.browserViewIsVisible = Boolean(visible)
  if (!appState.browserView) {
    return { success: true }
  }
  try {
    if (!appState.browserViewIsVisible) {
      appState.browserView.setBounds({ x: 0, y: 0, width: 1, height: 1 })
      return { success: true }
    }
    if (appState.browserViewLastBounds) {
      appState.browserView.setBounds(appState.browserViewLastBounds)
      return { success: true }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export function browserNavigate(url: string, safeParseUrl: (raw: string) => URL | null): { success: boolean; error?: string } {
  if (!appState.browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  const u = safeParseUrl(url)
  if (!u) {
    return { success: false, error: 'Invalid URL' }
  }
  try {
    appState.browserView.webContents.loadURL(u.toString())
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export function browserGoBack(): { success: boolean; error?: string } {
  if (!appState.browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  try {
    if (appState.browserView.webContents.canGoBack()) {
      appState.browserView.webContents.goBack()
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export function browserGoForward(): { success: boolean; error?: string } {
  if (!appState.browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  try {
    if (appState.browserView.webContents.canGoForward()) {
      appState.browserView.webContents.goForward()
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export function browserReload(): { success: boolean; error?: string } {
  if (!appState.browserView) {
    return { success: false, error: 'Browser view not created' }
  }
  try {
    appState.browserView.webContents.reload()
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export function setBrowserDeviceMode(rawMode: unknown): { success: boolean; error?: string } {
  if (!appState.browserView) {
    return { success: false, error: 'Browser view not created' }
  }

  const mode = typeof rawMode === 'string' ? rawMode : ''
  if (mode !== 'desktop' && mode !== 'mobile' && mode !== 'tablet') {
    return { success: false, error: 'Invalid device mode' }
  }

  const applyUserAgent = (ua: string | null) => {
    const next = typeof ua === 'string' ? ua : ''
    if (!next) return
    try {
      appState.browserView?.webContents.setUserAgent(next)
    } catch {
      void 0
    }
  }

  appState.browserViewDeviceMode = mode

  try {
    if (mode === 'desktop') {
      try {
        appState.browserView.webContents.disableDeviceEmulation()
      } catch {
        void 0
      }
      applyUserAgent(appState.browserViewDesktopUserAgent)
      try {
        appState.browserView.webContents.reload()
      } catch {
        void 0
      }
      return { success: true }
    }

    const fallback =
      mode === 'mobile'
        ? { width: 390, height: 844 }
        : { width: 768, height: 1024 }
    const size =
      appState.browserViewLastBounds &&
      appState.browserViewLastBounds.width > 0 &&
      appState.browserViewLastBounds.height > 0
        ? { width: appState.browserViewLastBounds.width, height: appState.browserViewLastBounds.height }
        : fallback

    try {
      appState.browserView.webContents.enableDeviceEmulation({
        screenPosition: 'mobile',
        screenSize: size,
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 0,
        viewSize: size,
        scale: 1,
      })
    } catch {
      void 0
    }

    const baseUa =
      appState.browserViewDesktopUserAgent ||
      (() => {
        try {
          return appState.browserView!.webContents.getUserAgent()
        } catch {
          return ''
        }
      })()
    applyUserAgent(buildMobileUserAgent(baseUa))

    try {
      appState.browserView.webContents.reload()
    } catch {
      void 0
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
