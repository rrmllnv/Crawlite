import { fetchUrlText } from './httpUtils'
import { normalizeUrl, safeParseUrl } from './urlUtils'

export type SitemapUrlMeta = {
  lastmod?: string
  changefreq?: string
  priority?: string
}

export function decodeXmlEntities(value: string): string {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function extractFirstTagValue(block: string, tagName: string): string {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i')
  const m = re.exec(block)
  if (!m || !m[1]) return ''
  return decodeXmlEntities(String(m[1] || '')).trim()
}

export function extractXmlLocs(xml: string): string[] {
  const out: string[] = []
  const re = /<loc[^>]*>([\s\S]*?)<\/loc>/gi
  let m: RegExpExecArray | null = null
  while ((m = re.exec(xml))) {
    const raw = decodeXmlEntities(String(m[1] || '')).trim()
    if (!raw) continue
    out.push(raw)
    if (out.length >= 200000) break
  }
  return out
}

export function extractXmlUrlEntries(xml: string): Array<{ loc: string; meta: SitemapUrlMeta }> {
  const out: Array<{ loc: string; meta: SitemapUrlMeta }> = []
  const re = /<url\b[^>]*>([\s\S]*?)<\/url>/gi
  let m: RegExpExecArray | null = null
  while ((m = re.exec(xml))) {
    const block = String(m[1] || '')
    const loc = extractFirstTagValue(block, 'loc')
    if (!loc) continue
    const lastmod = extractFirstTagValue(block, 'lastmod')
    const changefreq = extractFirstTagValue(block, 'changefreq')
    const priority = extractFirstTagValue(block, 'priority')
    const meta: SitemapUrlMeta = {}
    if (lastmod) meta.lastmod = lastmod
    if (changefreq) meta.changefreq = changefreq
    if (priority) meta.priority = priority
    out.push({ loc, meta })
    if (out.length >= 200000) break
  }
  return out
}

export async function buildSitemapUrls(
  startUrl: string
): Promise<{ sitemaps: string[]; urls: string[]; urlMetaByUrl: Record<string, SitemapUrlMeta> }> {
  const start = safeParseUrl(startUrl)
  if (!start) {
    return { sitemaps: [], urls: [], urlMetaByUrl: {} }
  }

  const origin = start.origin
  const robotsUrl = `${origin}/robots.txt`
  const candidates = new Set<string>()
  candidates.add(`${origin}/sitemap.xml`)
  candidates.add(`${origin}/sitemap_index.xml`)

  const robots = await fetchUrlText(robotsUrl, 512 * 1024)
  if (robots.ok && robots.body) {
    const lines = robots.body.split(/\r?\n/)
    for (const line of lines) {
      const t = String(line || '').trim()
      if (!t) continue
      const m = /^sitemap:\s*(.+)$/i.exec(t)
      if (m && m[1]) {
        const s = String(m[1]).trim()
        if (s) candidates.add(s)
      }
    }
  }

  const sitemapQueue: string[] = Array.from(candidates)
  const sitemapSeen = new Set<string>()
  const urlsSeen = new Set<string>()
  const allSitemaps: string[] = []
  const allUrls: string[] = []
  const urlMetaByUrl: Record<string, SitemapUrlMeta> = {}

  while (sitemapQueue.length > 0) {
    const next = sitemapQueue.shift()
    if (!next) break
    const norm = normalizeUrl(next)
    if (!norm || sitemapSeen.has(norm)) continue
    sitemapSeen.add(norm)
    allSitemaps.push(next)

    const res = await fetchUrlText(next, 5 * 1024 * 1024)
    if (!res.ok || !res.body) {
      continue
    }
    const xml = res.body
    const isIndex = /<sitemapindex\b/i.test(xml)
    const locs = extractXmlLocs(xml)

    if (isIndex) {
      if (locs.length === 0) continue
      for (const loc of locs) {
        const n = normalizeUrl(loc)
        if (!n || sitemapSeen.has(n)) continue
        if (sitemapSeen.size + sitemapQueue.length >= 200) break
        sitemapQueue.push(loc)
      }
    } else {
      const entries = extractXmlUrlEntries(xml)
      const list = entries.length > 0 ? entries : locs.map((loc) => ({ loc, meta: {} as SitemapUrlMeta }))
      if (list.length === 0) continue
      for (const it of list) {
        const loc = String(it.loc || '').trim()
        if (!loc) continue
        const n = normalizeUrl(loc)
        if (!n || urlsSeen.has(n)) continue
        urlsSeen.add(n)
        allUrls.push(loc)
        if (it.meta && (it.meta.lastmod || it.meta.changefreq || it.meta.priority)) {
          urlMetaByUrl[loc] = it.meta
        }
        if (allUrls.length >= 200000) break
      }
    }
  }

  return { sitemaps: allSitemaps, urls: allUrls, urlMetaByUrl }
}
