import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setCurrentView, setError as setAppError, setLoading } from '../../store/slices/appSlice'
import { ensurePagesTreeExpanded, requestNavigate } from '../../store/slices/browserSlice'
import { crawlService } from '../../services/CrawlService'
import { selectPage, upsertPage } from '../../store/slices/crawlSlice'
import { setScrollTop, toggleExpanded } from '../../store/slices/sitemapSlice'
import { PanelResizer } from '../PanelResizer/PanelResizer'
import './SiteMapView.scss'

type TreeNode = {
  id: string
  label: string
  children: TreeNode[]
  url?: string
  leafCount?: number
}

function buildUrlTree(urls: string[]) {
  const root: TreeNode = { id: 'root', label: 'Хосты', children: [] }
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

  const computeLeafCounts = (node: TreeNode): number => {
    let total = node.url ? 1 : 0
    for (const c of node.children) {
      total += computeLeafCounts(c)
    }
    node.leafCount = total
    return total
  }
  computeLeafCounts(root)

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
  getUrlMeta,
}: {
  node: TreeNode
  level: number
  expanded: Set<string>
  toggle: (id: string) => void
  onOpen: (url: string) => void
  getUrlMeta: (url: string) => { lastmod?: string; changefreq?: string; priority?: string } | null
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(node.id)
  const isLeaf = Boolean(node.url)
  const nestedUrlsCount = (() => {
    if (!hasChildren) return 0
    const total = typeof node.leafCount === 'number' ? node.leafCount : node.children.length
    // если узел сам является URL (например /blog) — не считаем его как “вложенный”
    const self = node.url ? 1 : 0
    return Math.max(0, total - self)
  })()
  const meta = isLeaf && node.url ? getUrlMeta(node.url) : null
  const metaText = (() => {
    if (!meta) return ''
    const parts: string[] = []
    const lastmod = String(meta.lastmod || '').trim()
    const changefreq = String(meta.changefreq || '').trim()
    const priority = String(meta.priority || '').trim()
    if (lastmod) parts.push(lastmod)
    if (priority) parts.push(`prio ${priority}`)
    if (changefreq) parts.push(changefreq)
    return parts.join(' · ')
  })()

  const titleText = (() => {
    if (!isLeaf) {
      const lines: string[] = [node.label]
      if (hasChildren) {
        lines.push(`URL: ${nestedUrlsCount}`)
      }
      return lines.join('\n')
    }
    if (!node.url) return node.label
    const m = getUrlMeta(node.url)
    const lines: string[] = [node.url]
    if (hasChildren) {
      lines.push(`URL: ${nestedUrlsCount}`)
    }
    if (!m) return lines.join('\n')
    const lastmod = String(m.lastmod || '').trim()
    const changefreq = String(m.changefreq || '').trim()
    const priority = String(m.priority || '').trim()
    if (lastmod) lines.push(`lastmod: ${lastmod}`)
    if (changefreq) lines.push(`changefreq: ${changefreq}`)
    if (priority) lines.push(`priority: ${priority}`)
    return lines.join('\n')
  })()
  return (
    <div>
      <div className="sitemap-tree__row" style={{ paddingLeft: 8 + level * 14 }}>
        {hasChildren ? (
          <button
            type="button"
            className="sitemap-tree__toggle"
            onClick={() => toggle(node.id)}
            title={`${isExpanded ? 'Свернуть' : 'Раскрыть'} · URL: ${nestedUrlsCount}`}
          >
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
          title={titleText}
        >
          <div className="sitemap-tree__label-main">
            <div className="sitemap-tree__label-title" style={{ fontWeight: isLeaf ? 600 : 700 }}>
              {node.label}
            </div>
            {isLeaf && node.url && <div className="sitemap-tree__url">{node.url}</div>}
            {isLeaf && node.url && metaText ? <div className="sitemap-tree__meta">{metaText}</div> : null}
          </div>
          <div className="sitemap-tree__label-count">
            {hasChildren ? <span className="sitemap-tree__count">{nestedUrlsCount}</span> : null}
          </div>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="sitemap-tree__children">
          {node.children.map((c) => (
            <TreeItem
              key={c.id}
              node={c}
              level={level + 1}
              expanded={expanded}
              toggle={toggle}
              onOpen={onOpen}
              getUrlMeta={getUrlMeta}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SiteMapView() {
  const dispatch = useAppDispatch()
  const crawlStartUrl = useAppSelector((s) => s.crawl.startUrl)
  const browserCurrentUrl = useAppSelector((s) => s.browser.currentUrl)
  const startUrl = crawlStartUrl || browserCurrentUrl

  const isBuilding = useAppSelector((s) => s.sitemap.isBuilding)
  const error = useAppSelector((s) => s.sitemap.error)
  const urls = useAppSelector((s) => s.sitemap.urls)
  const sitemaps = useAppSelector((s) => s.sitemap.sitemaps)
  const urlMetaByUrl = useAppSelector((s) => s.sitemap.urlMetaByUrl)
  const truncated = useAppSelector((s) => s.sitemap.truncated)
  const maxUrlsUsed = useAppSelector((s) => s.sitemap.maxUrlsUsed)
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

  const filteredUrls = useMemo(() => {
    const q = String(searchQuery || '').trim().toLowerCase()
    if (!q) return urls
    return urls.filter((u) => String(u || '').toLowerCase().includes(q))
  }, [urls, searchQuery])

  const tree = useMemo(() => buildUrlTree(filteredUrls), [filteredUrls])
  const expanded = useMemo(() => new Set(expandedIds || []), [expandedIds])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  const [sidebarWidthPx, setSidebarWidthPx] = useState<number>(260)

  const clamp = useMemo(() => {
    return (value: number, min: number, max: number) => {
      const v = Math.floor(Number(value))
      if (!Number.isFinite(v)) return min
      if (v < min) return min
      if (v > max) return max
      return v
    }
  }, [])

  const getContainerWidth = () => {
    try {
      return Math.floor(rootRef.current?.getBoundingClientRect().width || 0)
    } catch {
      return 0
    }
  }

  const onSidebarResizerDeltaX = (deltaX: number) => {
    const containerWidth = getContainerWidth()
    const resizerWidthPx = 10
    const minSidebarPx = 300
    const minContentPx = 400
    const maxSidebarPx =
      containerWidth > 0
        ? Math.max(minSidebarPx, containerWidth - minContentPx - resizerWidthPx)
        : 520

    setSidebarWidthPx((prev) => clamp(prev + deltaX, minSidebarPx, maxSidebarPx))
  }

  const getUrlMeta = useMemo(() => {
    return (url: string) => {
      const key = String(url || '').trim()
      if (!key) return null
      const meta = (urlMetaByUrl as any)[key]
      if (!meta || typeof meta !== 'object') return null
      return {
        lastmod: typeof (meta as any).lastmod === 'string' ? (meta as any).lastmod : undefined,
        changefreq: typeof (meta as any).changefreq === 'string' ? (meta as any).changefreq : undefined,
        priority: typeof (meta as any).priority === 'string' ? (meta as any).priority : undefined,
      }
    }
  }, [urlMetaByUrl])

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
    <div
      className="sitemap-view"
      ref={rootRef}
      style={{ gridTemplateColumns: `${sidebarWidthPx}px 10px 1fr` }}
    >
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
      </div>

      <PanelResizer
        ariaLabel="Изменение ширины колонок: сайдбар/карта сайта"
        onDeltaX={onSidebarResizerDeltaX}
      />

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
           <div className="sitemap-view__subtitle">
              {isBuilding ? 'Построение… · ' : ''}
              {urls.length === 0 ? 'URL: 0' : searchQuery.trim() ? `URL: ${filteredUrls.length} из ${urls.length}` : `URL: ${urls.length}`}
              {truncated && urls.length > 0 ? ` · достигнут лимит ${maxUrlsUsed.toLocaleString('ru-RU')}` : ''}
            </div>
            <div className="sitemap-view__search-wrap">
              <input
                type="text"
                className="sitemap-view__search"
                placeholder="Поиск по URL…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={urls.length === 0}
              />
              {searchQuery.trim() && (
                <button
                  type="button"
                  className="sitemap-view__search-clear"
                  onClick={() => setSearchQuery('')}
                  title="Очистить"
                  aria-label="Очистить"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>

        {!error && truncated && urls.length > 0 && (
          <div className="sitemap-view__warning">
            Достигнут лимит URL: <b>{maxUrlsUsed.toLocaleString('ru-RU')}</b>. Результат может быть неполным — увеличьте лимит в настройках.
          </div>
        )}

        {error && <div className="sitemap-view__empty">Ошибка: {error}</div>}
        {!error && urls.length === 0 && <div className="sitemap-view__empty">Карта сайта будет построена после “Перейти” или “Запустить”.</div>}
        {!error && urls.length > 0 && filteredUrls.length === 0 && (
          <div className="sitemap-view__empty">Нет URL по запросу «{searchQuery.trim()}».</div>
        )}
        {!error && urls.length > 0 && filteredUrls.length > 0 && (
          <TreeItem
            node={tree}
            level={0}
            expanded={expanded}
            toggle={toggle}
            onOpen={(u) => void openInBrowser(u)}
            getUrlMeta={getUrlMeta}
          />
        )}
      </div>
    </div>
  )
}

