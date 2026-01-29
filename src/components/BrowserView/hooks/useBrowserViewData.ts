import { useMemo } from 'react'
import { useAppSelector } from '../../../store/hooks'
import type { CrawlPageData } from '../../../electron'
import type { LinkDetailed } from '../types'
import type { BrowserPropertiesSummary } from '../../BrowserProperties/BrowserProperties'
import { buildUrlTree } from '../utils/buildUrlTree'
import { isMailtoOrTel, normalizeHostname } from '../utils/url'

export function useBrowserViewData() {
  const pagesByUrl = useAppSelector((s) => s.crawl.pagesByUrl)
  const pageOrder = useAppSelector((s) => s.crawl.pageOrder)
  const selectedUrl = useAppSelector((s) => s.crawl.selectedUrl)
  const errors = useAppSelector((s) => s.crawl.errors)
  const pagesTreeExpandedIds = useAppSelector((s) => s.browser.pagesTreeExpandedIds)

  const selectedPage = useMemo(() => {
    if (!selectedUrl) return null
    return pagesByUrl[selectedUrl] || null
  }, [pagesByUrl, selectedUrl])

  const pages = useMemo(() => {
    return pageOrder
      .map((key) => pagesByUrl[key])
      .filter((p): p is CrawlPageData => Boolean(p))
  }, [pageOrder, pagesByUrl])

  const tree = useMemo(() => buildUrlTree(pages, pagesByUrl), [pages, pagesByUrl])

  const expanded = useMemo(() => new Set(pagesTreeExpandedIds || []), [pagesTreeExpandedIds])

  const resourceMiscList = useMemo(() => {
    if (!selectedPage) return [] as string[]
    const miscList = Array.isArray(selectedPage.misc) ? selectedPage.misc : []
    const seen = new Set<string>(
      [...selectedPage.links, ...selectedPage.images, ...selectedPage.scripts, ...selectedPage.stylesheets].map(
        (x) => String(x)
      )
    )
    return miscList.map((x) => String(x || '').trim()).filter((x) => x && !seen.has(String(x)))
  }, [selectedPage])

  const linkGroups = useMemo(() => {
    if (!selectedPage?.url) {
      return { internal: [] as LinkDetailed[], external: [] as LinkDetailed[] }
    }
    let base: URL | null = null
    try {
      base = new URL(selectedPage.url)
    } catch {
      base = null
    }
    const baseHost = base ? normalizeHostname(base.hostname) : ''
    const internal: LinkDetailed[] = []
    const external: LinkDetailed[] = []

    const detailed: LinkDetailed[] =
      Array.isArray((selectedPage as any).linksDetailed) && (selectedPage as any).linksDetailed.length > 0
        ? (selectedPage as any).linksDetailed
            .map((x: any) => ({ url: String(x?.url || '').trim(), anchor: String(x?.anchor || '').trim() }))
            .filter((x: LinkDetailed) => Boolean(x.url))
        : (selectedPage.links || []).map((x) => ({ url: String(x || '').trim(), anchor: '' }))

    for (const it of detailed) {
      const href = String(it.url || '').trim()
      if (!href) continue
      try {
        const u = new URL(href)
        const host = normalizeHostname(u.hostname)
        const isHttp = u.protocol === 'http:' || u.protocol === 'https:'
        if (isHttp && baseHost && host === baseHost) internal.push(it)
        else external.push(it)
      } catch {
        external.push(it)
      }
    }
    return { internal, external }
  }, [selectedPage])

  const summary = useMemo((): BrowserPropertiesSummary | null => {
    if (!selectedPage) return null
    const ht = selectedPage.headingsText || { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] }
    const hc = selectedPage.headingsCount || {
      h1: ht.h1.length,
      h2: ht.h2.length,
      h3: ht.h3.length,
      h4: ht.h4.length,
      h5: ht.h5.length,
      h6: ht.h6.length,
    }
    const totalHeadings =
      (ht.h1.length || hc.h1) +
      (ht.h2.length || hc.h2) +
      (ht.h3.length || hc.h3) +
      (ht.h4.length || hc.h4) +
      (ht.h5.length || hc.h5) +
      (ht.h6.length || hc.h6)
    return {
      totalHeadings,
      headingsText: ht,
      headings: hc,
    }
  }, [selectedPage])

  const contacts = useMemo(() => {
    const miscList = Array.isArray(selectedPage?.misc) ? selectedPage!.misc : []
    const list = miscList.map((x) => String(x || '').trim()).filter(Boolean).filter(isMailtoOrTel)
    return Array.from(new Set(list))
  }, [selectedPage])

  const seoIssues = useMemo(() => {
    if (!selectedPage) {
      return []
    }
    const issues: string[] = []
    const title = String(selectedPage.title || '').trim().replace(/\s+/g, ' ')
    const h1 = String(selectedPage.h1 || '').trim().replace(/\s+/g, ' ')

    const raw = selectedPage.headingsRawCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 }
    const empty = selectedPage.headingsEmptyCount || { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 }
    const nested = Array.isArray(selectedPage.nestedHeadings) ? selectedPage.nestedHeadings : []

    if ((raw.h1 || 0) === 0) {
      issues.push('Отсутствие H1: На странице вообще нет главного заголовка')
    }
    if ((raw.h1 || 0) > 1) {
      issues.push('Дублирование H1: Несколько тегов H1 на одной странице')
    }
    if (title && h1 && title.toLowerCase() === h1.toLowerCase()) {
      issues.push('Одинаковый H1 и Title: Лучше их различать для расширения семантики')
    }
    const emptyParts: string[] = []
    ;(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).forEach((k) => {
      const n = empty[k] || 0
      if (n > 0) {
        emptyParts.push(`${k.toUpperCase()}: ${n}`)
      }
    })
    if (emptyParts.length > 0) {
      issues.push(`Пустые заголовки: ${emptyParts.join(', ')}`)
    }
    if (nested.length > 0) {
      issues.push(`Вложенные заголовки: ${nested.join(', ')}`)
    }
    if (!String(selectedPage.description || '').trim()) {
      issues.push('Отсутствие Description: Поисковик сам соберет кусок текста')
    }
    if (!selectedPage.hasViewport) {
      issues.push('Отсутствие тега Viewport: Сайт может не адаптироваться под мобильные устройства')
    }
    if (!selectedPage.hasCanonical) {
      issues.push('Отсутствие Canonical: Поисковик может не понимать главную страницу при дублях')
    }

    return issues
  }, [selectedPage])

  const tabsCount = useMemo(() => {
    if (!selectedPage) {
      return { links: 0, images: 0, resources: 0, errors: errors.length }
    }
    const links = selectedPage.links?.length || 0
    const images = selectedPage.images?.length || 0
    const js = selectedPage.scripts?.length || 0
    const css = selectedPage.stylesheets?.length || 0
    const misc = resourceMiscList.filter((x) => x && !isMailtoOrTel(x)).length
    return { links, images, resources: js + css + misc, errors: errors.length }
  }, [selectedPage, errors.length, resourceMiscList])

  return {
    pagesByUrl,
    pageOrder,
    selectedUrl,
    selectedPage,
    errors,
    pages,
    tree,
    expanded,
    resourceMiscList,
    linkGroups,
    summary,
    contacts,
    seoIssues,
    tabsCount,
  }
}
