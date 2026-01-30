import type { WebContentsView } from 'electron'
import { appState } from '../state'
import { normalizeUrl } from './urlUtils'
import { parseContentLength } from './httpUtils'

export function attachCrawlWebRequestListeners(view: WebContentsView): void {
  const wcId = view.webContents.id
  if (appState.crawlWebRequestAttachedForWebContentsId === wcId) {
    return
  }

  appState.crawlWebRequestAttachedForWebContentsId = wcId

  try {
    const webRequest = view.webContents.session.webRequest
    webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details: any, callback: any) => {
      try {
        if (!details || typeof details !== 'object') {
          callback({ cancel: false })
          return
        }
        if (typeof details.webContentsId === 'number' && details.webContentsId !== wcId) {
          callback({ cancel: false })
          return
        }
        const overrides = appState.crawlRequestHeadersOverride
        if (!overrides || typeof overrides !== 'object') {
          callback({ cancel: false })
          return
        }
        const headers = (details.requestHeaders && typeof details.requestHeaders === 'object') ? details.requestHeaders : {}
        const ua = typeof overrides.userAgent === 'string' ? overrides.userAgent.trim() : ''
        const al = typeof overrides.acceptLanguage === 'string' ? overrides.acceptLanguage.trim() : ''
        if (ua) {
          headers['User-Agent'] = ua
        }
        if (al) {
          headers['Accept-Language'] = al
        }
        callback({ cancel: false, requestHeaders: headers })
      } catch {
        try {
          callback({ cancel: false })
        } catch {
          void 0
        }
      }
    })
    webRequest.onCompleted({ urls: ['*://*/*'] }, (details: any) => {
      try {
        if (!details || typeof details !== 'object') {
          return
        }
        if (typeof details.webContentsId === 'number' && details.webContentsId !== wcId) {
          return
        }
        if (details.resourceType !== 'mainFrame') {
          return
        }

        const url = typeof details.url === 'string' ? details.url : ''
        const normalized = normalizeUrl(url)
        if (!normalized) {
          return
        }

        const statusCode =
          typeof details.statusCode === 'number' && Number.isFinite(details.statusCode)
            ? Math.trunc(details.statusCode)
            : null
        const contentLength = parseContentLength(
          details.responseHeaders as Record<string, unknown> | undefined
        )
        appState.crawlMainFrameMetaByUrl.set(normalized, { statusCode, contentLength })
      } catch {
        void 0
      }
    })
  } catch {
    void 0
  }
}
