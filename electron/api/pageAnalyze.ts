import type { WebContents } from 'electron'
import type { CrawlPageData, CrawlStartParams } from '../types'
import { appState } from '../state'
import { safeParseUrl, normalizeUrl } from './urlUtils'
import { resolveHostIp } from './dns'
import { ensureCrawlView } from './browserView'
import { extractPageDataFromView, type ExtractedPageData } from './crawlExtract'

async function loadUrlWithTimeout(
  wc: WebContents,
  url: string,
  timeoutMs: number
): Promise<{ ok: boolean; timedOut: boolean }> {
  const timeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : 0
  const loadPromise = wc.loadURL(url).then(
    () => true,
    () => false,
  )
  if (timeout <= 0) {
    return { ok: await loadPromise, timedOut: false }
  }
  let timedOut = false
  let timer: any = null
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      try {
        wc.stop()
      } catch {
        void 0
      }
      resolve(false)
    }, timeout)
  })

  const ok = await Promise.race([loadPromise, timeoutPromise])
  if (timer) {
    try {
      clearTimeout(timer)
    } catch {
      void 0
    }
  }
  return { ok: Boolean(ok) && !timedOut, timedOut }
}

function parseAcceptLanguagePrimary(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  const first = s.split(',')[0] || ''
  const cleaned = first.split(';')[0] || ''
  return cleaned.trim()
}

function buildStealthScript(opts: { overrideWebdriver: boolean; acceptLanguage: string; platform: string }): string {
  const overrideWebdriver = Boolean(opts.overrideWebdriver)
  const langPrimary = parseAcceptLanguagePrimary(opts.acceptLanguage)
  const platform = String(opts.platform || '').trim()
  if (!overrideWebdriver && !langPrimary && !platform) {
    return ''
  }
  return `
    (function() {
      try {
        var overrideWebdriver = ${overrideWebdriver ? 'true' : 'false'};
        var langPrimary = ${JSON.stringify(langPrimary)};
        var platform = ${JSON.stringify(platform)};

        if (overrideWebdriver) {
          try {
            Object.defineProperty(navigator, 'webdriver', { get: function() { return false; }, configurable: true });
          } catch (e) {}
        }

        if (langPrimary) {
          try {
            Object.defineProperty(navigator, 'language', { get: function() { return langPrimary; }, configurable: true });
          } catch (e) {}
          try {
            Object.defineProperty(navigator, 'languages', { get: function() { return [langPrimary]; }, configurable: true });
          } catch (e) {}
        }

        if (platform) {
          try {
            Object.defineProperty(navigator, 'platform', { get: function() { return platform; }, configurable: true });
          } catch (e) {}
        }
      } catch (e) {}
    })();
  `
}

async function ensureEarlyOverridesViaCDP(
  wc: WebContents,
  opts: { userAgent: string; acceptLanguage: string; platform: string; overrideWebdriver: boolean }
): Promise<void> {
  const userAgent = String(opts.userAgent || '').trim()
  const acceptLanguage = String(opts.acceptLanguage || '').trim()
  const platform = String(opts.platform || '').trim()
  const overrideWebdriver = Boolean(opts.overrideWebdriver)

  const script = buildStealthScript({ overrideWebdriver, acceptLanguage, platform })
  const needsCdp = Boolean(userAgent || acceptLanguage || platform || script)
  if (!needsCdp) {
    return
  }

  try {
    const wcId = (wc as any)?.id
    if (typeof wcId === 'number' && appState.crawlDebuggerAttachedForWebContentsId !== wcId) {
      try {
        if ((wc as any).debugger?.isAttached?.()) {
          ;(wc as any).debugger.detach()
        }
      } catch {
        void 0
      }
      try {
        ;(wc as any).debugger.attach('1.3')
        appState.crawlDebuggerAttachedForWebContentsId = wcId
      } catch {
        return
      }
    }

    const dbg = (wc as any).debugger
    if (!dbg) return

    try {
      await dbg.sendCommand('Page.enable')
    } catch {
      void 0
    }
    try {
      await dbg.sendCommand('Network.enable')
    } catch {
      void 0
    }

    if (userAgent || acceptLanguage || platform) {
      try {
        await dbg.sendCommand('Network.setUserAgentOverride', {
          userAgent: userAgent || undefined,
          acceptLanguage: acceptLanguage || undefined,
          platform: platform || undefined,
        })
      } catch {
        void 0
      }
    }

    if (appState.crawlStealthScriptId) {
      try {
        await dbg.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: appState.crawlStealthScriptId })
      } catch {
        void 0
      }
      appState.crawlStealthScriptId = null
    }

    if (script) {
      try {
        const res = await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: script })
        const id = res && typeof res === 'object' ? (res as any).identifier : null
        appState.crawlStealthScriptId = typeof id === 'string' ? id : null
      } catch {
        appState.crawlStealthScriptId = null
      }
    }
  } catch {
    void 0
  }
}

function cleanupCrawlDebugger(wc: WebContents): void {
  try {
    const dbg = (wc as any).debugger
    if (dbg && typeof dbg.isAttached === 'function' && dbg.isAttached()) {
      try {
        dbg.detach()
      } catch {
        void 0
      }
    }
  } catch {
    void 0
  }
  appState.crawlDebuggerAttachedForWebContentsId = null
  appState.crawlStealthScriptId = null
}

async function tryApplyNavigatorOverrides(
  wc: WebContents,
  opts: { overrideWebdriver: boolean; acceptLanguage: string; platform: string }
): Promise<void> {
  try {
    const overrideWebdriver = Boolean(opts.overrideWebdriver)
    const langPrimary = parseAcceptLanguagePrimary(opts.acceptLanguage)
    const platform = String(opts.platform || '').trim()

    if (!overrideWebdriver && !langPrimary && !platform) {
      return
    }

    const js = `
      (function() {
        try {
          var overrideWebdriver = ${overrideWebdriver ? 'true' : 'false'};
          var langPrimary = ${JSON.stringify(langPrimary)};
          var platform = ${JSON.stringify(platform)};

          if (overrideWebdriver) {
            try {
              Object.defineProperty(navigator, 'webdriver', { get: function() { return false; }, configurable: true });
            } catch (e) {}
          }

          if (langPrimary) {
            try {
              Object.defineProperty(navigator, 'language', { get: function() { return langPrimary; }, configurable: true });
            } catch (e) {}
            try {
              Object.defineProperty(navigator, 'languages', { get: function() { return [langPrimary]; }, configurable: true });
            } catch (e) {}
          }

          if (platform) {
            try {
              Object.defineProperty(navigator, 'platform', { get: function() { return platform; }, configurable: true });
            } catch (e) {}
          }
        } catch (e) {}
      })();
      true;
    `
    await wc.executeJavaScript(js, true)
  } catch {
    void 0
  }
}

export async function handlePageAnalyze(
  url: string,
  options?: CrawlStartParams['options']
): Promise<{ success: true; page: CrawlPageData } | { success: false; error: string }> {
  const u = safeParseUrl(url)
  if (!u) {
    return { success: false, error: 'Invalid URL' }
  }

  const analyzeWaitMsRaw = (options as any)?.analyzeWaitMs
  const analyzeWaitMs =
    typeof analyzeWaitMsRaw === 'number' && Number.isFinite(analyzeWaitMsRaw)
      ? Math.max(0, Math.min(60000, Math.floor(analyzeWaitMsRaw)))
      : null

  // Backward-compat: если analyzeWaitMs не задан — используем старую схему delay+jitter.
  const delayMsFallback =
    typeof options?.delayMs === 'number' && Number.isFinite(options.delayMs)
      ? Math.max(0, Math.min(60000, Math.floor(options.delayMs)))
      : 0

  const jitterMsFallback =
    typeof options?.jitterMs === 'number' && Number.isFinite(options.jitterMs)
      ? Math.max(0, Math.min(60000, Math.floor(options.jitterMs)))
      : 0

  const deduplicateLinks = Boolean((options as any)?.deduplicateLinks)
  const userAgentRaw = typeof (options as any)?.userAgent === 'string' ? String((options as any).userAgent) : ''
  const acceptLanguageRaw =
    typeof (options as any)?.acceptLanguage === 'string' ? String((options as any).acceptLanguage) : ''
  const platformRaw = typeof (options as any)?.platform === 'string' ? String((options as any).platform) : ''
  const overrideWebdriver = Boolean((options as any)?.overrideWebdriver)
  const pageLoadTimeoutMsRaw = (options as any)?.pageLoadTimeoutMs
  const pageLoadTimeoutMs =
    typeof pageLoadTimeoutMsRaw === 'number' && Number.isFinite(pageLoadTimeoutMsRaw)
      ? Math.max(1000, Math.min(300000, Math.floor(pageLoadTimeoutMsRaw)))
      : 10000

  ensureCrawlView()
  if (!appState.crawlView) {
    return { success: false, error: 'Crawler view not available' }
  }

  const crawlView = appState.crawlView
  appState.crawlRequestHeadersOverride = {
    userAgent: userAgentRaw && userAgentRaw.trim() ? userAgentRaw.trim() : undefined,
    acceptLanguage: acceptLanguageRaw && acceptLanguageRaw.trim() ? acceptLanguageRaw.trim() : undefined,
  }

  // Ранние overrides: CDP (до скриптов страницы).
  await ensureEarlyOverridesViaCDP(crawlView.webContents, {
    userAgent: userAgentRaw,
    acceptLanguage: acceptLanguageRaw,
    platform: platformRaw,
    overrideWebdriver,
  })

  try {
    const ua = userAgentRaw && userAgentRaw.trim() ? userAgentRaw.trim() : ''
    if (ua) {
      crawlView.webContents.setUserAgent(ua)
    }
  } catch {
    void 0
  }

  const startedAt = Date.now()
  let loadOk = true
  const loadRes = await loadUrlWithTimeout(crawlView.webContents, u.toString(), pageLoadTimeoutMs)
  if (!loadRes.ok) {
    loadOk = false
  }

  // Фолбэк: post-load override (если CDP не сработал/часть полей не применилась)
  void tryApplyNavigatorOverrides(crawlView.webContents, {
    overrideWebdriver,
    acceptLanguage: acceptLanguageRaw,
    platform: platformRaw,
  }).catch(() => void 0)

  try {
    await crawlView.webContents.executeJavaScript(`
      (function() {
        return new Promise((resolve) => {
          try { requestAnimationFrame(() => setTimeout(resolve, 250)); } catch (e) { setTimeout(resolve, 250); }
        });
      })()
    `)
  } catch {
    void 0
  }

  const sleepFor =
    analyzeWaitMs !== null
      ? analyzeWaitMs
      : (delayMsFallback + Math.floor(Math.random() * (jitterMsFallback + 1)))
  if (sleepFor > 0) {
    await new Promise((resolve) => setTimeout(resolve, sleepFor))
  }

  const finishedAt = Date.now()

  let extracted: ExtractedPageData | null = null
  try {
    extracted = await extractPageDataFromView(crawlView, { deduplicateLinks })
  } catch {
    extracted = null
  }

  const finalUrlRaw = extracted?.url || crawlView.webContents.getURL() || u.toString()
  const finalNormalized = normalizeUrl(finalUrlRaw) || normalizeUrl(u.toString())
  const meta = finalNormalized ? appState.crawlMainFrameMetaByUrl.get(finalNormalized) : undefined
  let ipAddress = ''
  try {
    const host = safeParseUrl(finalUrlRaw)?.hostname || u.hostname
    ipAddress = await resolveHostIp(host)
  } catch {
    ipAddress = ''
  }

  const page: CrawlPageData = {
    url: finalUrlRaw,
    normalizedUrl: finalNormalized,
    title: extracted?.title || '',
    h1: extracted?.h1 || '',
    hasViewport: Boolean((extracted as any)?.hasViewport),
    hasCanonical: Boolean((extracted as any)?.hasCanonical),
    canonicalUrl: typeof (extracted as any)?.canonicalUrl === 'string' ? (extracted as any).canonicalUrl : '',
    metaRobots: typeof (extracted as any)?.metaRobots === 'string' ? (extracted as any).metaRobots : '',
    ipAddress,
    headingsRawCount: (extracted as any)?.headingsRawCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    headingsEmptyCount: (extracted as any)?.headingsEmptyCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    nestedHeadings: (extracted as any)?.nestedHeadings || [],
    headingsText: extracted?.headingsText || { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
    headingsCount: extracted?.headingsCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    description: extracted?.description || '',
    keywords: extracted?.keywords || '',
    statusCode: meta?.statusCode ?? null,
    contentLength: meta?.contentLength ?? (extracted?.htmlBytes ?? null),
    loadTimeMs: loadOk ? finishedAt - startedAt : null,
    analysisTimeMs: Date.now() - startedAt,
    discoveredAt: startedAt,
    links: extracted?.links || [],
    linksDetailed: Array.isArray((extracted as any)?.linksDetailed) ? (extracted as any).linksDetailed : [],
    images: extracted?.images || [],
    scripts: extracted?.scripts || [],
    stylesheets: extracted?.stylesheets || [],
    misc: (extracted as any)?.misc || [],
  }

  appState.crawlRequestHeadersOverride = null
  cleanupCrawlDebugger(crawlView.webContents)
  return { success: true, page }
}
