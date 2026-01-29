import { useEffect, useMemo, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setCurrentView, setError as setAppError, setLoading } from '../../store/slices/appSlice'
import { ensurePagesTreeExpanded, requestNavigate } from '../../store/slices/browserSlice'
import { crawlService } from '../../services/CrawlService'
import { selectPage, upsertPage } from '../../store/slices/crawlSlice'
import { setBuilding, setData, setError as setSitemapError, setScrollTop, toggleExpanded } from '../../store/slices/sitemapSlice'
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

  const tree = useMemo(() => buildUrlTree(urls), [urls])
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

  const handleBuild = async () => {
    if (!startUrl) {
      dispatch(setSitemapError('Нет стартового URL. Сначала открой страницу через "Перейти".'))
      return
    }
    dispatch(setSitemapError(''))
    dispatch(setBuilding(true))
    try {
      const res = await window.electronAPI.sitemapBuild(startUrl)
      if (!res?.success) {
        dispatch(setSitemapError(res?.error || 'Не удалось построить sitemap'))
        dispatch(setData({ urls: [], sitemaps: [] }))
        return
      }
      const list = Array.isArray((res as any).urls) ? (res as any).urls : []
      const sm = Array.isArray((res as any).sitemaps) ? (res as any).sitemaps : []
      dispatch(setData({ urls: list, sitemaps: sm }))
    } catch (e) {
      dispatch(setSitemapError(String(e)))
    } finally {
      dispatch(setBuilding(false))
    }
  }

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
        <button type="button" className="sitemap-view__button" onClick={() => void handleBuild()} disabled={isBuilding}>
          {isBuilding ? 'Построение…' : 'Построить карту сайта'}
        </button>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
          Базовый URL: <span style={{ color: '#fff' }}>{startUrl || '—'}</span>
        </div>
        {sitemaps.length > 0 && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
            Sitemap файлов: <span style={{ color: '#fff' }}>{sitemaps.length}</span>
          </div>
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
          <div className="sitemap-view__title">Карта сайта</div>
          <div className="sitemap-view__subtitle">URL: {urls.length}</div>
        </div>

        {error && <div className="sitemap-view__empty">Ошибка: {error}</div>}
        {!error && urls.length === 0 && <div className="sitemap-view__empty">Нажми “Построить карту сайта”.</div>}
        {!error && urls.length > 0 && (
          <TreeItem node={tree} level={0} expanded={expanded} toggle={toggle} onOpen={(u) => void openInBrowser(u)} />
        )}
      </div>
    </div>
  )
}

