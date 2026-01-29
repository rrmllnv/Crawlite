import type { CrawlPageData } from '../types'
import { appState } from '../state'
import { safeParseUrl, normalizeUrl } from './urlUtils'
import { resolveHostIp } from './dns'
import { ensureCrawlView } from './browserView'
import { extractPageDataFromView, type ExtractedPageData } from './crawlExtract'

export async function handlePageAnalyze(
  url: string
): Promise<{ success: true; page: CrawlPageData } | { success: false; error: string }> {
  const u = safeParseUrl(url)
  if (!u) {
    return { success: false, error: 'Invalid URL' }
  }

  ensureCrawlView()
  if (!appState.crawlView) {
    return { success: false, error: 'Crawler view not available' }
  }

  const crawlView = appState.crawlView
  const startedAt = Date.now()
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
          try { requestAnimationFrame(() => setTimeout(resolve, 250)); } catch (e) { setTimeout(resolve, 250); }
        });
      })()
    `)
  } catch {
    void 0
  }

  const finishedAt = Date.now()

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

  return { success: true, page }
}
