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

  ensureCrawlView()
  if (!appState.crawlView) {
    return { success: false, error: 'Crawler view not available' }
  }

  const crawlView = appState.crawlView
  const baseHost = normalizeHostname(start.hostname)
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
    try {
      await crawlView.webContents.loadURL(u.toString())
    } catch {
      loadOk = false
    }

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

    const loadFinishedAt = Date.now()

    let extracted: ExtractedPageData | null = null
    try {
      extracted = await extractPageDataFromView(crawlView)
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
