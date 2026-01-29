import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setCurrentView, setError as setAppError, setLoading } from '../../store/slices/appSlice'
import { ensurePagesTreeExpanded, requestNavigate } from '../../store/slices/browserSlice'
import { crawlService } from '../../services/CrawlService'
import { selectPage, upsertPage } from '../../store/slices/crawlSlice'
import { setScrollTop, toggleExpanded } from '../../store/slices/sitemapSlice'
import './SiteMapView.scss'

type TreeNode = {
  id: string
  label: string
  children: TreeNode[]
  url?: string
}

function buildUrlTree(urls: string[]) {
  const root: TreeNode = { id: 'root', label: 'root', children: [] }
  const byId = new Map<string, TreeNode>()
  byId.set(root.id, root)

  const ensureNode = (parent: TreeNode, id: string, label: string): TreeNode => {
    const existing = byId.get(id)
    if (existing) {
      if (!parent.children.includes(existing)) parent.children.push(existing)
      return existing
    }
    const node: TreeNode = { id, label, children: [] }
    byId.set(id, node)
    parent.children.push(node)
    return node
  }

  for (const raw of urls) {
    const uStr = String(raw || '').trim()
    if (!uStr) continue
    let u: URL | null = null
    try {
      u = new URL(uStr)
    } catch {
      u = null
    }
    if (!u) continue

    const hostId = `host:${u.hostname}`
    const hostNode = ensureNode(root, hostId, u.hostname)
    const segments = u.pathname.split('/').filter(Boolean)
    let parent = hostNode
    if (segments.length === 0) {
      const leafId = `${hostId}:/`
      const leaf = ensureNode(parent, leafId, '/')
      leaf.url = uStr
      continue
    }
    let acc = ''
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]
      acc += `/${seg}`
      const isLast = i === segments.length - 1
      const nodeId = `${hostId}:${acc}`
      const node = ensureNode(parent, nodeId, seg)
      if (isLast) {
        node.url = uStr
      }
      parent = node
    }
  }

  const sortNode = (node: TreeNode) => {
    node.children.sort((a, b) => {
      const aIsLeaf = Boolean(a.url)
      const bIsLeaf = Boolean(b.url)
      if (aIsLeaf !== bIsLeaf) return aIsLeaf ? 1 : -1
      return a.label.localeCompare(b.label)
    })
    for (const c of node.children) sortNode(c)
  }
  sortNode(root)
  return root
}

function buildPagesTreeExpandChain(urlStr: string): string[] {
  const raw = String(urlStr || '').trim()
  if (!raw) return ['root']
  let u: URL | null = null
  try {
    u = new URL(raw)
  } catch {
    u = null
  }
  if (!u) return ['root']

  const ids: string[] = []
  ids.push('root')
  const hostId = `host:${u.hostname}`
  ids.push(hostId)

  const segments = u.pathname.split('/').filter(Boolean)
  if (segments.length === 0) {
    ids.push(`${hostId}:/`)
    return ids
  }
  let acc = ''
  for (let i = 0; i < segments.length; i += 1) {
    acc += `/${segments[i]}`
    ids.push(`${hostId}:${acc}`)
  }
  return ids
}

function TreeItem({
  node,
  level,
  expanded,
  toggle,
  onOpen,
}: {
  node: TreeNode
  level: number
  expanded: Set<string>
  toggle: (id: string) => void
  onOpen: (url: string) => void
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(node.id)
  const isLeaf = Boolean(node.url)
  return (
    <div>
      <div className="sitemap-tree__row" style={{ paddingLeft: 8 + level * 14 }}>
        {hasChildren ? (
          <button type="button" className="sitemap-tree__toggle" onClick={() => toggle(node.id)} title={isExpanded ? 'Свернуть' : 'Раскрыть'}>
            <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true" />
          </button>
        ) : (
          <span className="sitemap-tree__toggle-spacer" />
        )}
        <button
          type="button"
          className="sitemap-tree__label"
          onClick={() => {
            if (isLeaf && node.url) onOpen(node.url)
            else if (hasChildren) toggle(node.id)
          }}
          title={node.url || node.label}
        >
          <div style={{ fontWeight: isLeaf ? 600 : 700 }}>{node.label}</div>
          {isLeaf && node.url && <div className="sitemap-tree__url">{node.url}</div>}
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="sitemap-tree__children">
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} level={level + 1} expanded={expanded} toggle={toggle} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

export function SiteMapView() {
  const dispatch = useAppDispatch()
  const startUrl = useAppSelector((s) => s.crawl.startUrl) || useAppSelector((s) => s.browser.currentUrl)

  const isBuilding = useAppSelector((s) => s.sitemap.isBuilding)
  const error = useAppSelector((s) => s.sitemap.error)
  const urls = useAppSelector((s) => s.sitemap.urls)
  const sitemaps = useAppSelector((s) => s.sitemap.sitemaps)
  const expandedIds = useAppSelector((s) => s.sitemap.expandedIds)
  const scrollTop = useAppSelector((s) => s.sitemap.scrollTop)

  const [searchQuery, setSearchQuery] = useState('')

  const hostsList = useMemo(() => {
    const hosts = new Set<string>()
    for (const raw of urls) {
      const uStr = String(raw || '').trim()
      if (!uStr) continue
      try {
        const u = new URL(uStr)
        hosts.add(u.hostname.toLowerCase())
      } catch {
        void 0
      }
    }
    return Array.from(hosts).sort((a, b) => a.localeCompare(b))
  }, [urls])

  const uniqueHostsCount = hostsList.length

  const sectionSummary = useMemo(() => {
    const bySegment = new Map<string, number>()
    for (const raw of urls) {
      const uStr = String(raw || '').trim()
      if (!uStr) continue
      try {
        const u = new URL(uStr)
        const segments = u.pathname.split('/').filter(Boolean)
        const segment = segments.length === 0 ? '/' : `/${segments[0]}`
        bySegment.set(segment, (bySegment.get(segment) || 0) + 1)
      } catch {
        void 0
      }
    }
    return Array.from(bySegment.entries())
      .map(([segment, count]) => ({ segment, count }))
      .sort((a, b) => b.count - a.count)
  }, [urls])

  const filteredUrls = useMemo(() => {
    const q = String(searchQuery || '').trim().toLowerCase()
    if (!q) return urls
    return urls.filter((u) => String(u || '').toLowerCase().includes(q))
  }, [urls, searchQuery])

  const tree = useMemo(() => buildUrlTree(filteredUrls), [filteredUrls])
  const expanded = useMemo(() => new Set(expandedIds || []), [expandedIds])
  const contentRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  const toggle = (id: string) => {
    dispatch(toggleExpanded(id))
  }

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    if (scrollTop > 0) {
      try {
        el.scrollTop = scrollTop
      } catch {
        void 0
      }
    }
  }, [scrollTop, urls.length])

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        try {
          cancelAnimationFrame(rafRef.current)
        } catch {
          void 0
        }
      }
    }
  }, [])

  const openInBrowser = async (url: string) => {
    const target = String(url || '').trim()
    if (!target) return
    // открываем как “безопасную ссылку”: переключаемся в BrowserView, навигацию отдаём через requestNavigate
    dispatch(setAppError(null))
    dispatch(setLoading(true))
    dispatch(setCurrentView('browser'))
    dispatch(requestNavigate(target))
    // и параллельно подтягиваем анализ страницы без crawl, чтобы в данных сразу было заполнено
    try {
      const res = await crawlService.analyzePage(target)
      if (res?.success && (res as any).page) {
        const page = (res as any).page
        dispatch(upsertPage(page))
        const expandChain = buildPagesTreeExpandChain(String(page.url || target))
        dispatch(ensurePagesTreeExpanded(expandChain))
        const key = page.normalizedUrl || page.url
        if (key) dispatch(selectPage(key))
      }
    } catch {
      void 0
    } finally {
      dispatch(setLoading(false))
    }
  }

  return (
    <div className="sitemap-view">
      <div className="sitemap-view__sidebar">
        {urls.length > 0 && (
          <details className="sitemap-view__group" open>
            <summary className="sitemap-view__group-summary">
              <span className="sitemap-view__group-title">Хостов</span>
              <span className="sitemap-view__group-count">{uniqueHostsCount}</span>
            </summary>
            <div className="sitemap-view__group-body">
              {hostsList.map((host) => (
                <div key={host} className="sitemap-view__group-item" title={host}>
                  {host}
                </div>
              ))}
            </div>
          </details>
        )}

        {sitemaps.length > 0 && (
          <details className="sitemap-view__group">
            <summary className="sitemap-view__group-summary">
              <span className="sitemap-view__group-title">Sitemap файлов</span>
              <span className="sitemap-view__group-count">{sitemaps.length}</span>
            </summary>
            <div className="sitemap-view__group-body">
              {sitemaps.map((sm, idx) => (
                <div key={`${sm}-${idx}`} className="sitemap-view__group-item" title={sm}>
                  {sm}
                </div>
              ))}
            </div>
          </details>
        )}

        {sectionSummary.length > 0 && (
          <details className="sitemap-view__group">
            <summary className="sitemap-view__group-summary">
              <span className="sitemap-view__group-title">Разделы</span>
              <span className="sitemap-view__group-count">{sectionSummary.length}</span>
            </summary>
            <div className="sitemap-view__group-body">
              {sectionSummary.map(({ segment, count }) => (
                <div key={segment} className="sitemap-view__group-item sitemap-view__group-item--row" title={segment}>
                  <span className="sitemap-view__group-item-text">{segment}</span>
                  <span className="sitemap-view__group-item-badge">{count}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div
        className="sitemap-view__content"
        ref={contentRef}
        onScroll={() => {
          const el = contentRef.current
          if (!el) return
          if (rafRef.current) return
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            dispatch(setScrollTop(el.scrollTop))
          })
        }}
      >
        <div className="sitemap-view__header">
          <div className="sitemap-view__title-wrap">
            <div className="sitemap-view__title">Карта сайта</div>
            <div className="sitemap-view__base-url" title={startUrl || ''}>
              Базовый URL: <span className="sitemap-view__base-url-val">{startUrl || '—'}</span>
            </div>
          </div>
          <div className="sitemap-view__header-right">
            <input
              type="text"
              className="sitemap-view__search"
              placeholder="Поиск по URL…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={urls.length === 0}
            />
            <div className="sitemap-view__subtitle">
              {isBuilding ? 'Построение… · ' : ''}
              {urls.length === 0 ? 'URL: 0' : searchQuery.trim() ? `URL: ${filteredUrls.length} из ${urls.length}` : `URL: ${urls.length}`}
            </div>
          </div>
        </div>

        {error && <div className="sitemap-view__empty">Ошибка: {error}</div>}
        {!error && urls.length === 0 && <div className="sitemap-view__empty">Карта сайта будет построена после “Перейти” или “Запустить”.</div>}
        {!error && urls.length > 0 && filteredUrls.length === 0 && (
          <div className="sitemap-view__empty">Нет URL по запросу «{searchQuery.trim()}».</div>
        )}
        {!error && urls.length > 0 && filteredUrls.length > 0 && (
          <TreeItem node={tree} level={0} expanded={expanded} toggle={toggle} onOpen={(u) => void openInBrowser(u)} />
        )}
      </div>
    </div>
  )
}

