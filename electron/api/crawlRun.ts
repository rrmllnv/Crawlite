import type { WebContents } from 'electron'
import type { CrawlPageData, CrawlStartParams } from '../types'
import { appState } from '../state'
import { safeParseUrl, normalizeUrl, normalizeHostname, isInternalByHost, isDocumentOrMediaUrl } from './urlUtils'
import { resolveHostIp } from './dns'
import { ensureCrawlView } from './browserView'
import { extractPageDataFromView, type ExtractedPageData } from './crawlExtract'

function sendCrawlEvent(payload: any): void {
  if (!appState.mainWindow) {
    return
  }
  appState.mainWindow.webContents.send('crawl:event', payload)
}

const EMPTY_PAGE_STUB: CrawlPageData = {
  url: '',
  normalizedUrl: '',
  title: '',
  h1: '',
  hasViewport: false,
  hasCanonical: false,
  canonicalUrl: '',
  metaRobots: '',
  ipAddress: '',
  headingsRawCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
  headingsEmptyCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
  nestedHeadings: [],
  headingsText: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
  headingsCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
  description: '',
  keywords: '',
  statusCode: null,
  contentLength: null,
  loadTimeMs: null,
  analysisTimeMs: null,
  discoveredAt: 0,
  links: [],
  linksDetailed: [],
  images: [],
  scripts: [],
  stylesheets: [],
  misc: [],
}

function makeDiscoveredStub(url: string, normalizedUrl: string): CrawlPageData {
  return {
    ...EMPTY_PAGE_STUB,
    url,
    normalizedUrl,
    discoveredAt: Date.now(),
  }
}

function parseAcceptLanguagePrimary(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  const first = s.split(',')[0] || ''
  const cleaned = first.split(';')[0] || ''
  return cleaned.trim()
}

function normalizePathBoundaryForFolderRestriction(pathname: string): string {
  const raw = String(pathname || '/')
  if (raw === '/') {
    return '/'
  }
  const trimmed = raw.replace(/\/+$/, '')
  return trimmed ? trimmed : '/'
}

function getFolderPathnameForFolderRestriction(startPathname: string): string {
  const raw = String(startPathname || '/')
  if (!raw || raw === '/') {
    return '/'
  }
  if (raw.endsWith('/')) {
    return raw
  }
  const lastSlashIdx = raw.lastIndexOf('/')
  const lastSegment = lastSlashIdx >= 0 ? raw.slice(lastSlashIdx + 1) : raw
  const looksLikeFile = Boolean(lastSegment) && lastSegment.includes('.')
  if (looksLikeFile) {
    const dir = lastSlashIdx >= 0 ? raw.slice(0, lastSlashIdx + 1) : '/'
    return dir || '/'
  }
  return `${raw}/`
}

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

function buildStealthScript(opts: { overrideWebdriver: boolean; acceptLanguage: string; platform: string }): string {
  const overrideWebdriver = Boolean(opts.overrideWebdriver)
  const langPrimary = parseAcceptLanguagePrimary(opts.acceptLanguage)
  const platform = String(opts.platform || '').trim()
  if (!overrideWebdriver && !langPrimary && !platform) {
    return ''
  }
  // Выполняется в новом документе ДО скриптов страницы (через CDP Page.addScriptToEvaluateOnNewDocument).
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
    // Подключаем debugger один раз к crawlView.
    const wcId = (wc as any)?.id
    if (typeof wcId === 'number' && appState.crawlDebuggerAttachedForWebContentsId !== wcId) {
      try {
        // На всякий случай отцепляем старое подключение.
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
        // attach может быть запрещён/упасть — тогда просто выходим.
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

export async function crawlStart(
  params: CrawlStartParams
): Promise<{ success: true; runId: string } | { success: false; error: string }> {
  const startedAt = Date.now()

  const start = safeParseUrl(params?.startUrl)
  if (!start) {
    return { success: false, error: 'Invalid URL' }
  }

  const runId = `run_${startedAt}_${Math.random().toString(16).slice(2)}`
  appState.activeCrawl = { runId, cancelled: false }

  const maxPages =
    typeof params?.options?.maxPages === 'number' && Number.isFinite(params.options.maxPages)
      ? Math.max(1, Math.floor(params.options.maxPages))
      : 200

  const maxDepth =
    typeof params?.options?.maxDepth === 'number' && Number.isFinite(params.options.maxDepth)
      ? Math.max(0, Math.floor(params.options.maxDepth))
      : 2

  const delayMs =
    typeof params?.options?.delayMs === 'number' && Number.isFinite(params.options.delayMs)
      ? Math.max(0, Math.floor(params.options.delayMs))
      : 650

  const jitterMs =
    typeof params?.options?.jitterMs === 'number' && Number.isFinite(params.options.jitterMs)
      ? Math.max(0, Math.floor(params.options.jitterMs))
      : 350

  const pageLoadTimeoutMs =
    typeof (params?.options as any)?.pageLoadTimeoutMs === 'number' && Number.isFinite((params?.options as any).pageLoadTimeoutMs)
      ? Math.max(1000, Math.min(300000, Math.floor((params?.options as any).pageLoadTimeoutMs)))
      : 10000

  const analyzeWaitMs =
    typeof (params?.options as any)?.analyzeWaitMs === 'number' && Number.isFinite((params?.options as any).analyzeWaitMs)
      ? Math.max(0, Math.min(60000, Math.floor((params?.options as any).analyzeWaitMs)))
      : 0

  const userAgentRaw = typeof params?.options?.userAgent === 'string' ? params.options.userAgent : ''
  const acceptLanguageRaw = typeof params?.options?.acceptLanguage === 'string' ? params.options.acceptLanguage : ''
  const platformRaw = typeof params?.options?.platform === 'string' ? params.options.platform : ''
  const overrideWebdriver = Boolean((params?.options as any)?.overrideWebdriver)
  const restrictToCurrentFolderRaw = (params?.options as any)?.restrictToCurrentFolder
  const restrictToCurrentFolder = typeof restrictToCurrentFolderRaw === 'boolean' ? restrictToCurrentFolderRaw : true

  ensureCrawlView()
  if (!appState.crawlView) {
    return { success: false, error: 'Crawler view not available' }
  }

  const crawlView = appState.crawlView
  appState.crawlRequestHeadersOverride = {
    userAgent: userAgentRaw && userAgentRaw.trim() ? userAgentRaw.trim() : undefined,
    acceptLanguage: acceptLanguageRaw && acceptLanguageRaw.trim() ? acceptLanguageRaw.trim() : undefined,
  }

  // Более ранние overrides: CDP (до скриптов страницы).
  // Если не удалось — остаётся fallback ниже (executeJavaScript после loadURL).
  void ensureEarlyOverridesViaCDP(crawlView.webContents, {
    userAgent: userAgentRaw,
    acceptLanguage: acceptLanguageRaw,
    platform: platformRaw,
    overrideWebdriver,
  }).catch(() => void 0)

  try {
    const ua = userAgentRaw && userAgentRaw.trim() ? userAgentRaw.trim() : ''
    if (ua) {
      crawlView.webContents.setUserAgent(ua)
    }
  } catch {
    void 0
  }
  const baseHost = normalizeHostname(start.hostname)
  const startFolderPathname = getFolderPathnameForFolderRestriction(start.pathname)
  const startPathBoundary = normalizePathBoundaryForFolderRestriction(startFolderPathname)
  const startPathPrefix = startPathBoundary === '/' ? '/' : `${startPathBoundary}/`
  const queue: Array<{ url: string; depth: number }> = [{ url: start.toString(), depth: 0 }]
  const seen = new Set<string>()
  const enqueued = new Set<string>()
  enqueued.add(normalizeUrl(start.toString()))

  sendCrawlEvent({
    type: 'started',
    runId,
    startedAt,
    startUrl: start.toString(),
    options: { maxPages, delayMs, jitterMs },
  })

  let processed = 0

  sendCrawlEvent({
    type: 'page:discovered',
    runId,
    processed,
    queued: queue.length,
    page: makeDiscoveredStub(start.toString(), normalizeUrl(start.toString())),
  })

  while (queue.length > 0) {
    if (!appState.activeCrawl || appState.activeCrawl.runId !== runId || appState.activeCrawl.cancelled) {
      sendCrawlEvent({ type: 'cancelled', runId, processed, queued: queue.length, finishedAt: Date.now() })
      appState.crawlRequestHeadersOverride = null
      cleanupCrawlDebugger(crawlView.webContents)
      return { success: true, runId }
    }

    if (processed >= maxPages) {
      break
    }

    const next = queue.shift()
    if (!next) {
      continue
    }
    const nextUrl = next.url
    const depth = next.depth
    const normalized = normalizeUrl(nextUrl)
    if (!normalized) {
      continue
    }
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)

    const u = safeParseUrl(normalized)
    if (!u) {
      continue
    }
    if (!isInternalByHost(u, baseHost)) {
      continue
    }

    const pageStartedAt = Date.now()
    sendCrawlEvent({ type: 'page:loading', runId, url: u.toString(), processed, queued: queue.length })

    let loadOk = true
    const loadRes = await loadUrlWithTimeout(crawlView.webContents, u.toString(), pageLoadTimeoutMs)
    if (!loadRes.ok) {
      loadOk = false
    }

    // Пытаемся применить JS-override на navigator.* (после загрузки).
    // ВАЖНО: это не гарантирует обход антибота (часть проверок выполняется раньше), но помогает для части сайтов.
    void tryApplyNavigatorOverrides(crawlView.webContents, {
      overrideWebdriver,
      acceptLanguage: acceptLanguageRaw,
      platform: platformRaw,
    }).catch(() => void 0)

    try {
      await crawlView.webContents.executeJavaScript(`
        (function() {
          return new Promise((resolve) => {
            try {
              requestAnimationFrame(() => setTimeout(resolve, 250));
            } catch (e) {
              setTimeout(resolve, 250);
            }
          });
        })()
      `)
    } catch {
      void 0
    }

    if (analyzeWaitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, analyzeWaitMs))
    }

    const loadFinishedAt = Date.now()

    const deduplicateLinks = Boolean(params?.options?.deduplicateLinks)
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
      loadTimeMs: loadOk ? loadFinishedAt - pageStartedAt : null,
      analysisTimeMs: Date.now() - pageStartedAt,
      discoveredAt: pageStartedAt,
      links: extracted?.links || [],
      linksDetailed: Array.isArray((extracted as any)?.linksDetailed) ? (extracted as any).linksDetailed : [],
      images: extracted?.images || [],
      scripts: extracted?.scripts || [],
      stylesheets: extracted?.stylesheets || [],
      misc: (extracted as any)?.misc || [],
    }

    sendCrawlEvent({
      type: 'page:done',
      runId,
      page,
      processed: processed + 1,
      queued: queue.length,
      ok: loadOk,
    })

    if (depth >= maxDepth) {
      processed += 1
      const sleepFor = delayMs + Math.floor(Math.random() * (jitterMs + 1))
      if (sleepFor > 0) {
        await new Promise((resolve) => setTimeout(resolve, sleepFor))
      }
      continue
    }

    for (const link of page.links) {
      const normalizedLink = normalizeUrl(link)
      if (!normalizedLink) {
        continue
      }
      if (isDocumentOrMediaUrl(normalizedLink)) {
        continue
      }
      if (seen.has(normalizedLink) || enqueued.has(normalizedLink)) {
        continue
      }
      if (enqueued.size >= maxPages) {
        continue
      }
      const lu = safeParseUrl(normalizedLink)
      if (!lu) {
        continue
      }
      if (!isInternalByHost(lu, baseHost)) {
        continue
      }
      if (restrictToCurrentFolder && startPathBoundary !== '/') {
        const linkPathBoundary = normalizePathBoundaryForFolderRestriction(lu.pathname)
        const okByFolder = linkPathBoundary === startPathBoundary || linkPathBoundary.startsWith(startPathPrefix)
        if (!okByFolder) {
          continue
        }
      }
      enqueued.add(normalizedLink)
      queue.push({ url: lu.toString(), depth: depth + 1 })

      sendCrawlEvent({
        type: 'page:discovered',
        runId,
        processed,
        queued: queue.length,
        page: makeDiscoveredStub(lu.toString(), normalizedLink),
      })
    }

    processed += 1
    const sleepFor = delayMs + Math.floor(Math.random() * (jitterMs + 1))
    if (sleepFor > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepFor))
    }
  }

  sendCrawlEvent({ type: 'finished', runId, processed, finishedAt: Date.now(), queued: queue.length })
  appState.crawlRequestHeadersOverride = null
  cleanupCrawlDebugger(crawlView.webContents)
  return { success: true, runId }
}

export function cancelCrawl(runId: string): void {
  if (!appState.activeCrawl) {
    return
  }
  if (typeof runId === 'string' && runId && appState.activeCrawl.runId === runId) {
    appState.activeCrawl.cancelled = true
  }
}
