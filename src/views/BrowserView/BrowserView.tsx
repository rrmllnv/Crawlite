import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { browserService } from '../../services/BrowserService'
import { crawlService } from '../../services/CrawlService'
import { selectPage, upsertPage } from '../../store/slices/crawlSlice'
import { clearRequestedNavigate, ensurePagesTreeExpanded, setCurrentUrl, setDeviceMode, setPageLoading, togglePagesTreeExpanded } from '../../store/slices/browserSlice'
import type { CrawlPageData } from '../../electron'
import { Separate } from '../../components/Separate/Separate'
import { ImageModal } from '../../components/ImageModal/ImageModal'
import { ResourceModal } from '../../components/ResourceModal/ResourceModal'
import './BrowserView.scss'

type TabId = 'meta' | 'links' | 'images' | 'resources' | 'errors'

type LinkDetailed = { url: string; anchor: string }

type ResourceHeadInfo = { sizeBytes: number | null; elapsedMs: number | null }

function formatSizeKB(valueBytes: number | null) {
  if (typeof valueBytes !== 'number' || !Number.isFinite(valueBytes)) {
    return '—'
  }
  const kb = valueBytes / 1024
  return `${kb.toFixed(2)} KB`
}

function formatResourceInfo(info: ResourceHeadInfo | undefined) {
  if (!info) return ''
  const parts: string[] = []
  if (typeof info.sizeBytes === 'number' && Number.isFinite(info.sizeBytes)) {
    parts.push(`${(info.sizeBytes / 1024).toFixed(2)} KB`)
  }
  if (typeof info.elapsedMs === 'number' && Number.isFinite(info.elapsedMs)) {
    if (info.elapsedMs < 1000) parts.push(`${Math.max(0, Math.round(info.elapsedMs))} ms`)
    else parts.push(`${(info.elapsedMs / 1000).toFixed(2)} s`)
  }
  return parts.join(' · ')
}

function formatSeconds(valueMs: number | null) {
  if (typeof valueMs !== 'number' || !Number.isFinite(valueMs)) {
    return '—'
  }
  const sec = valueMs / 1000
  return `${sec.toFixed(2)} s`
}

function isMailtoOrTel(value: string) {
  const v = String(value || '').trim().toLowerCase()
  return v.startsWith('mailto:') || v.startsWith('tel:')
}

function normalizeContactValue(value: string) {
  const raw = String(value || '').trim()
  const lower = raw.toLowerCase()
  if (lower.startsWith('tel:')) {
    return { label: 'Телефон', value: raw.slice(4).split('?')[0].trim() }
  }
  if (lower.startsWith('mailto:')) {
    return { label: 'Email', value: raw.slice(7).split('?')[0].trim() }
  }
  return { label: 'Контакт', value: raw }
}

function normalizeHostname(hostname: string): string {
  const h = String(hostname || '').trim().toLowerCase()
  return h.startsWith('www.') ? h.slice(4) : h
}

const EMULATED_WIDTH_MOBILE = 390
const EMULATED_WIDTH_TABLET = 768

function useBrowserBounds(deviceMode: 'desktop' | 'mobile' | 'tablet') {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }

    let rafId: number | null = null

    const apply = async () => {
      if (!ref.current) {
        return
      }
      const rect = ref.current.getBoundingClientRect()
      const fullWidth = Math.max(0, Math.floor(rect.width))
      const fullHeight = Math.max(0, Math.floor(rect.height))
      const left = Math.max(0, Math.floor(rect.left))
      const top = Math.max(0, Math.floor(rect.top))

      let width: number
      let x: number
      if (deviceMode === 'mobile') {
        width = Math.min(EMULATED_WIDTH_MOBILE, fullWidth)
        x = left + Math.max(0, Math.floor((fullWidth - width) / 2))
      } else if (deviceMode === 'tablet') {
        width = Math.min(EMULATED_WIDTH_TABLET, fullWidth)
        x = left + Math.max(0, Math.floor((fullWidth - width) / 2))
      } else {
        width = fullWidth
        x = left
      }

      const bounds = {
        x,
        y: top,
        width,
        height: fullHeight,
      }
      await browserService.ensure(bounds)
      await browserService.resize(bounds)
    }

    const schedule = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        void apply()
      })
    }

    const ro = new ResizeObserver(() => schedule())
    ro.observe(el)
    window.addEventListener('resize', schedule)
    schedule()

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
      window.removeEventListener('resize', schedule)
      ro.disconnect()
    }
  }, [deviceMode])

  return ref
}

type TreeNode = {
  id: string
  label: string
  children: TreeNode[]
  pageKey?: string
  url?: string
}

function buildUrlTree(pages: CrawlPageData[], pagesByUrl: Record<string, CrawlPageData>) {
  const root: TreeNode = { id: 'root', label: 'root', children: [] }
  const byId = new Map<string, TreeNode>()
  byId.set(root.id, root)

  const ensureNode = (parent: TreeNode, id: string, label: string): TreeNode => {
    const existing = byId.get(id)
    if (existing) {
      // гарантируем что parent содержит ссылку на node
      if (!parent.children.includes(existing)) {
        parent.children.push(existing)
      }
      return existing
    }
    const node: TreeNode = { id, label, children: [] }
    byId.set(id, node)
    parent.children.push(node)
    return node
  }

  for (const page of pages) {
    const key = page.normalizedUrl || page.url
    const p = pagesByUrl[key]
    const urlStr = p?.url || page.url
    if (!urlStr) continue

    let u: URL | null = null
    try {
      u = new URL(urlStr)
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
      leaf.pageKey = key
      leaf.url = urlStr
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
        node.pageKey = key
        node.url = urlStr
      }
      parent = node
    }
  }

  const sortNode = (node: TreeNode) => {
    node.children.sort((a, b) => {
      const aIsLeaf = Boolean(a.pageKey)
      const bIsLeaf = Boolean(b.pageKey)
      if (aIsLeaf !== bIsLeaf) {
        return aIsLeaf ? 1 : -1
      }
      return a.label.localeCompare(b.label)
    })
    for (const c of node.children) sortNode(c)
  }
  sortNode(root)
  return root
}

function TreeItem({
  node,
  level,
  expanded,
  toggle,
  onSelect,
  selectedKey,
  pagesByUrl,
}: {
  node: TreeNode
  level: number
  expanded: Set<string>
  toggle: (id: string) => void
  onSelect: (key: string) => void
  selectedKey: string
  pagesByUrl: Record<string, CrawlPageData>
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(node.id)
  const isLeaf = Boolean(node.pageKey)
  const isSelected = isLeaf && node.pageKey === selectedKey

  const leafPage = isLeaf && node.pageKey ? pagesByUrl[node.pageKey] : null
  const leafTitle = isLeaf
    ? (leafPage?.title || leafPage?.h1 || node.label || '—')
    : node.label
  const leafUrl = isLeaf ? (leafPage?.url || node.url || '') : ''

  return (
    <div className="browser-tree__item">
      <div
        className={`browser-tree__row ${isSelected ? 'browser-tree__row--active' : ''}`}
        style={{ paddingLeft: 8 + level * 14 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="browser-tree__toggle"
            onClick={() => toggle(node.id)}
            aria-label={isExpanded ? 'Свернуть' : 'Раскрыть'}
            title={isExpanded ? 'Свернуть' : 'Раскрыть'}
          >
            <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true" />
          </button>
        ) : (
          <span className="browser-tree__toggle-spacer" />
        )}

        <button
          type="button"
          className={`browser-tree__label ${isLeaf ? 'browser-tree__label--leaf' : ''}`}
          onClick={() => {
            if (isLeaf && node.pageKey) onSelect(node.pageKey)
            else if (hasChildren) toggle(node.id)
          }}
          title={leafUrl || node.url || node.label}
        >
          {!isLeaf && <span className="browser-tree__text">{node.label}</span>}
          {isLeaf && (
            <span className="browser-tree__leaf">
              <span className="browser-tree__leaf-title">{leafTitle}</span>
              <span className="browser-tree__leaf-url">{leafUrl}</span>
            </span>
          )}
        </button>
      </div>

      {hasChildren && isExpanded && (
        <div className="browser-tree__children">
          {node.children.map((c) => (
            <TreeItem
              key={c.id}
              node={c}
              level={level + 1}
              expanded={expanded}
              toggle={toggle}
              onSelect={onSelect}
              selectedKey={selectedKey}
              pagesByUrl={pagesByUrl}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function BrowserView() {
  const dispatch = useAppDispatch()
  const deviceMode = useAppSelector((s) => s.browser.deviceMode)
  const boundsRef = useBrowserBounds(deviceMode)

  const pagesByUrl = useAppSelector((s) => s.crawl.pagesByUrl)
  const pageOrder = useAppSelector((s) => s.crawl.pageOrder)
  const selectedUrl = useAppSelector((s) => s.crawl.selectedUrl)
  const requestedUrl = useAppSelector((s) => s.browser.requestedUrl)
  const errors = useAppSelector((s) => s.crawl.errors)
  const isPageLoading = useAppSelector((s) => s.browser.isPageLoading)
  const pagesTreeExpandedIds = useAppSelector((s) => s.browser.pagesTreeExpandedIds)

  const [activeTab, setActiveTab] = useState<TabId>('meta')
  const [imageModalUrl, setImageModalUrl] = useState<string>('')
  const [resourceModal, setResourceModal] = useState<{ type: 'js' | 'css'; url: string } | null>(null)
  const [openHeadingLevels, setOpenHeadingLevels] = useState<Set<string>>(() => new Set())
  const [headInfoByUrl, setHeadInfoByUrl] = useState<Record<string, ResourceHeadInfo>>({})

  const pages = useMemo(() => {
    return pageOrder
      .map((key) => pagesByUrl[key])
      .filter((p): p is CrawlPageData => Boolean(p))
  }, [pageOrder, pagesByUrl])

  const tree = useMemo(() => buildUrlTree(pages, pagesByUrl), [pages, pagesByUrl])
  const expanded = useMemo(() => new Set(pagesTreeExpandedIds || []), [pagesTreeExpandedIds])

  useEffect(() => {
    // авто-раскрытие корня и хоста выбранной страницы
    const p = selectedUrl ? pagesByUrl[selectedUrl] : null
    if (!p?.url) {
      return
    }
    try {
      const u = new URL(p.url)
      const hostId = `host:${u.hostname}`
      dispatch(ensurePagesTreeExpanded([hostId]))
    } catch {
      void 0
    }
  }, [dispatch, selectedUrl, pagesByUrl])

  const toggle = (id: string) => {
    dispatch(togglePagesTreeExpanded(id))
  }

  const handleSetDeviceMode = async (mode: 'desktop' | 'mobile' | 'tablet') => {
    if (mode === deviceMode) {
      return
    }
    try {
      const res = await browserService.setDeviceMode(mode)
      if (res?.success) {
        dispatch(setDeviceMode(mode))
      }
    } catch {
      void 0
    }
  }

  const selectedPage = useMemo(() => {
    const key = selectedUrl
    if (!key) {
      return null
    }
    return pagesByUrl[key] || null
  }, [pagesByUrl, selectedUrl])

  const resourceMiscList = useMemo(() => {
    if (!selectedPage) return [] as string[]
    const miscList = Array.isArray(selectedPage.misc) ? selectedPage.misc : []
    const seen = new Set<string>([...selectedPage.links, ...selectedPage.images, ...selectedPage.scripts, ...selectedPage.stylesheets].map((x) => String(x)))
    return miscList
      .map((x) => String(x || '').trim())
      .filter((x) => x && !seen.has(String(x)))
  }, [selectedPage])

  const openLinkSafely = async (url: string) => {
    if (isPageLoading) {
      return
    }
    const target = String(url || '').trim()
    if (!target) {
      return
    }

    try {
      const navRes = await browserService.navigate(target)
      if (!navRes?.success) {
        throw new Error(navRes?.error || 'Browser navigate failed')
      }
      dispatch(setCurrentUrl(target))
    } catch {
      return
    }

    // “Безопасный” анализ: без resetCrawl, без событий crawl, без изменения processed/queued.
    try {
      const res = await crawlService.analyzePage(target)
      if (res?.success && res.page) {
        dispatch(upsertPage(res.page))
        const key = res.page.normalizedUrl || res.page.url
        if (key) {
          dispatch(selectPage(key))
        }
      }
    } catch {
      void 0
    }
  }

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

  useEffect(() => {
    if (!selectedPage) return
    if (activeTab !== 'images' && activeTab !== 'resources') return

    const list: string[] = []
    if (activeTab === 'images') {
      list.push(...(selectedPage.images || []))
    } else {
      list.push(...(selectedPage.scripts || []), ...(selectedPage.stylesheets || []), ...(resourceMiscList || []))
    }

    const uniq = Array.from(new Set(list.map((x) => String(x || '').trim()).filter(Boolean)))
    if (uniq.length === 0) return

    let cancelled = false
    void (async () => {
      // ограничим чтобы не спамить сетью на больших списках
      const max = 50
      let processed = 0
      for (const url of uniq) {
        if (cancelled) return
        if (processed >= max) return
        if (headInfoByUrl[url]) continue
        processed += 1
        try {
          const res = await window.electronAPI.resourceHead(url)
          if (!res?.success) continue
          const sizeBytes = typeof (res as any).contentLength === 'number' ? (res as any).contentLength : null
          const elapsedMs = typeof (res as any).elapsedMs === 'number' ? (res as any).elapsedMs : null
          setHeadInfoByUrl((prev) => ({
            ...prev,
            [url]: { sizeBytes, elapsedMs },
          }))
        } catch {
          void 0
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeTab, selectedPage, resourceMiscList, headInfoByUrl])

  useEffect(() => {
    if (!requestedUrl) {
      return
    }
    void (async () => {
      try {
        const res = await browserService.navigate(requestedUrl)
        if (res?.success) {
          dispatch(setCurrentUrl(requestedUrl))
        }
      } finally {
        dispatch(clearRequestedNavigate())
      }
    })()
  }, [requestedUrl, dispatch])

  useEffect(() => {
    if (!window.electronAPI?.onBrowserEvent) {
      return
    }
    const unsub = window.electronAPI.onBrowserEvent((evt: any) => {
      if (!evt || typeof evt !== 'object') return
      if (evt.type === 'loading') {
        dispatch(setPageLoading(Boolean((evt as any).isLoading)))
      }
    })
    return () => {
      try {
        unsub()
      } catch {
        void 0
      }
    }
  }, [dispatch])

  const handleSelect = async (page: CrawlPageData) => {
    const key = page.normalizedUrl || page.url
    dispatch(selectPage(key))
    try {
      await browserService.navigate(page.url)
      dispatch(setCurrentUrl(page.url))
    } catch {
      void 0
    }
  }

  const handleSelectKey = async (key: string) => {
    const page = pagesByUrl[key]
    if (!page) {
      return
    }
    await handleSelect(page)
  }

  const summary = useMemo(() => {
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
    const totalHeadings = (ht.h1.length || hc.h1) + (ht.h2.length || hc.h2) + (ht.h3.length || hc.h3) + (ht.h4.length || hc.h4) + (ht.h5.length || hc.h5) + (ht.h6.length || hc.h6)
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

  return (
    <div className="browser-view">
      <div className="browser-view__col browser-view__col--pages">
        <div className="browser-view__col-header">
          <div className="browser-view__col-title">Страницы</div>
          <div className="browser-view__col-subtitle">{pages.length}</div>
        </div>
        <div className="browser-view__pages browser-tree">
          {pages.length === 0 && (
            <div className="browser-view__empty">
              Пока нет страниц. Запустите crawling.
            </div>
          )}
          {pages.length > 0 && (
            <TreeItem
              node={tree}
              level={0}
              expanded={expanded}
              toggle={toggle}
              onSelect={(key) => void handleSelectKey(key)}
              selectedKey={selectedUrl}
              pagesByUrl={pagesByUrl}
            />
          )}
        </div>
      </div>

      <div className="browser-view__col browser-view__col--browser">
        <div className="browser-view__browser-header">
          <div className="browser-view__browser-header-top">
            <div className="browser-view__col-title">Браузер</div>
            <div className="browser-view__device-toggle" role="group" aria-label="Режим отображения">
              <button
                type="button"
                className={`browser-view__device-button ${deviceMode === 'desktop' ? 'browser-view__device-button--active' : ''}`}
                onClick={() => void handleSetDeviceMode('desktop')}
                title="Десктоп"
                aria-label="Десктоп"
              >
                <i className="fa-solid fa-desktop" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`browser-view__device-button ${deviceMode === 'mobile' ? 'browser-view__device-button--active' : ''}`}
                onClick={() => void handleSetDeviceMode('mobile')}
                title="Мобильная"
                aria-label="Мобильная"
              >
                <i className="fa-solid fa-mobile-screen" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`browser-view__device-button ${deviceMode === 'tablet' ? 'browser-view__device-button--active' : ''}`}
                onClick={() => void handleSetDeviceMode('tablet')}
                title="Планшет"
                aria-label="Планшет"
              >
                <i className="fa-solid fa-tablet" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="browser-view__col-subtitle">{selectedPage ? selectedPage.url : '—'}</div>
        </div>
        {isPageLoading && <div className="browser-view__loading-bar">Загрузка страницы…</div>}
        <div className="browser-view__browser-surface" ref={boundsRef}>
          {/* WebContentsView рисуется нативно поверх этого прямоугольника */}
        </div>
      </div>

      <div className="browser-view__col browser-view__col--details">
        <div className="browser-view__col-header">
          <div className="browser-view__col-title">Данные</div>
          <div className="browser-view__col-subtitle">{selectedPage ? 'выбрана' : 'нет'}</div>
        </div>

        <div className="browser-view__tabs">
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'meta' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('meta')}
          >
            Мета
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'links' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('links')}
          >
            {selectedPage && tabsCount.links > 0 ? `Ссылки ${tabsCount.links}` : 'Ссылки'}
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'images' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('images')}
          >
            {selectedPage && tabsCount.images > 0 ? `Картинки ${tabsCount.images}` : 'Картинки'}
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'resources' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('resources')}
          >
            {selectedPage && tabsCount.resources > 0 ? `Ресурсы ${tabsCount.resources}` : 'Ресурсы'}
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'errors' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('errors')}
          >
            {tabsCount.errors > 0 ? `Ошибки ${tabsCount.errors}` : 'Ошибки'}
          </button>
        </div>

        <div className="browser-view__details">
          {!selectedPage && (
            <div className="browser-view__empty">
              Выберите страницу слева.
            </div>
          )}

          {selectedPage && activeTab === 'meta' && (
            <div className="browser-view__kv">
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">URL</div>
                <div className="browser-view__kv-val">{selectedPage.url}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">Rel canonical</div>
                <div className="browser-view__kv-val">{String((selectedPage as any).canonicalUrl || '').trim() || '—'}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">Meta robots</div>
                <div className="browser-view__kv-val">{String((selectedPage as any).metaRobots || '').trim() || '—'}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">IP сайта</div>
                <div className="browser-view__kv-val">{String((selectedPage as any).ipAddress || '').trim() || '—'}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">Title</div>
                <div className="browser-view__kv-val">{selectedPage.title || '—'}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">H1</div>
                <div className="browser-view__kv-val">{selectedPage.h1 || '—'}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">Description</div>
                <div className="browser-view__kv-val">{selectedPage.description || '—'}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">Keywords</div>
                <div className="browser-view__kv-val">{selectedPage.keywords || '—'}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">Ответ сервера</div>
                <div className="browser-view__kv-val">{selectedPage.statusCode === null ? '—' : String(selectedPage.statusCode)}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">Размер (KB)</div>
                <div className="browser-view__kv-val">{formatSizeKB(selectedPage.contentLength)}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">Время открытия (s)</div>
                <div className="browser-view__kv-val">{formatSeconds(selectedPage.loadTimeMs)}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">Время анализа (s)</div>
                <div className="browser-view__kv-val">{formatSeconds((selectedPage as any).analysisTimeMs)}</div>
              </div>

              {contacts.length > 0 && (
                <>
                  <Separate title="Контакты на странице" />
                  {contacts.map((x) => (
                    <div key={x} className="browser-view__kv-row">
                      <div className="browser-view__kv-key">{normalizeContactValue(x).label}</div>
                      <div className="browser-view__kv-val">{normalizeContactValue(x).value}</div>
                    </div>
                  ))}
                </>
              )}

              {seoIssues.length > 0 && (
                <>
                  <Separate title="Проверки" />
                  {seoIssues.map((x) => (
                    <div key={x} className="browser-view__list-item">
                      {x}
                    </div>
                  ))}
                </>
              )}

              <Separate title="Сводка по странице" />

              <div className="browser-view__details-block">
                <div className="browser-view__details-summary">
                  <span className="browser-view__details-summary-title">Заголовки</span>
                  <span className="browser-view__details-summary-value">{summary ? `всего ${summary.totalHeadings}` : '—'}</span>
                  <span className="browser-view__details-summary-actions">
                    <button
                      type="button"
                      className="browser-view__headings-control"
                      onClick={() => {
                        setOpenHeadingLevels((prev) => {
                          const isOpen = prev.size > 0
                          return isOpen ? new Set() : new Set(['h2', 'h3', 'h4', 'h5', 'h6'])
                        })
                      }}
                      disabled={isPageLoading}
                    >
                      {openHeadingLevels.size > 0 ? 'Скрыть' : 'Раскрыть'}
                    </button>
                  </span>
                </div>

                {summary && (
                  <div className="browser-view__headings">
                    <div className="browser-view__headings-level browser-view__headings-level--open">
                      <div className="browser-view__headings-summary">
                        <span className="browser-view__headings-title">H1</span>
                        <span className="browser-view__headings-count">{summary.headingsText.h1.length || summary.headings.h1}</span>
                      </div>
                      <div className="browser-view__headings-list">
                        {summary.headingsText.h1.length === 0 && <div className="browser-view__headings-empty">Нет</div>}
                        {summary.headingsText.h1.map((t) => (
                          <button
                            type="button"
                            key={`h1:${t}`}
                            className="browser-view__headings-item browser-view__headings-item--button"
                            onClick={() => void browserService.highlightHeading(1, t)}
                            disabled={isPageLoading}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    {([
                      ['h2', 'H2'],
                      ['h3', 'H3'],
                      ['h4', 'H4'],
                      ['h5', 'H5'],
                      ['h6', 'H6'],
                    ] as const).map(([key, label]) => {
                      const items = summary.headingsText[key]
                      const count = items.length || summary.headings[key]
                      return (
                        <details
                          key={key}
                          className="browser-view__headings-level"
                          open={openHeadingLevels.has(key)}
                          onToggle={(e) => {
                            const nextOpen = (e.currentTarget as HTMLDetailsElement).open
                            setOpenHeadingLevels((prev) => {
                              const next = new Set(prev)
                              if (nextOpen) next.add(key)
                              else next.delete(key)
                              return next
                            })
                          }}
                        >
                          <summary className="browser-view__headings-summary">
                            <span className="browser-view__headings-title">{label}</span>
                            <span className="browser-view__headings-count">{count}</span>
                          </summary>
                          <div className="browser-view__headings-list">
                            {items.length === 0 && <div className="browser-view__headings-empty">Нет</div>}
                            {items.map((t) => (
                              <button
                                type="button"
                                key={`${key}:${t}`}
                                className="browser-view__headings-item browser-view__headings-item--button"
                                onClick={() => void browserService.highlightHeading(Number(key.slice(1)), t)}
                                disabled={isPageLoading}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </details>
                      )
                    })}
                  </div>
                )}

                {!summary && <div className="browser-view__empty">—</div>}
              </div>

            </div>
          )}

          {selectedPage && activeTab === 'links' && (
            <div className="browser-view__list">
              {selectedPage.links.length === 0 && <div className="browser-view__empty">Нет ссылок.</div>}

              {selectedPage.links.length > 0 && (
                <details className="browser-view__group" open>
                  <summary className="browser-view__group-summary">
                    <span className="browser-view__group-title">Внутренние</span>
                    <span className="browser-view__group-count">{linkGroups.internal.length}</span>
                  </summary>
                  <div className="browser-view__group-body">
                    {linkGroups.internal.length === 0 && <div className="browser-view__empty">Нет.</div>}
                    {linkGroups.internal.map((it) => (
                      <div key={it.url} className="browser-view__row">
                      <button
                        type="button"
                        className="browser-view__row-main browser-view__row-main--two-lines"
                        onClick={() => void browserService.highlightLink(it.url).catch(() => void 0)}
                        title="Подсветить в браузере"
                        disabled={isPageLoading}
                      >
                        <div className="browser-view__row-main-text">{it.url}</div>
                        {it.anchor ? <div className="browser-view__row-subtext">{it.anchor}</div> : null}
                      </button>
                        <div className="browser-view__row-actions">
                        <button
                          type="button"
                          className="browser-view__action browser-view__action--primary"
                          onClick={() => void openLinkSafely(it.url)}
                          title="Открыть"
                          disabled={isPageLoading}
                        >
                          Открыть
                        </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {selectedPage.links.length > 0 && (
                <details className="browser-view__group">
                  <summary className="browser-view__group-summary">
                    <span className="browser-view__group-title">Внешние</span>
                    <span className="browser-view__group-count">{linkGroups.external.length}</span>
                  </summary>
                  <div className="browser-view__group-body">
                    {linkGroups.external.length === 0 && <div className="browser-view__empty">Нет.</div>}
                    {linkGroups.external.map((it) => (
                      <div key={it.url} className="browser-view__row">
                      <button
                        type="button"
                        className="browser-view__row-main browser-view__row-main--two-lines"
                        onClick={() => void browserService.highlightLink(it.url).catch(() => void 0)}
                        title="Подсветить в браузере"
                        disabled={isPageLoading}
                      >
                        <div className="browser-view__row-main-text">{it.url}</div>
                        {it.anchor ? <div className="browser-view__row-subtext">{it.anchor}</div> : null}
                      </button>
                        <div className="browser-view__row-actions">
                        <button
                          type="button"
                          className="browser-view__action browser-view__action--primary"
                          onClick={() => void openLinkSafely(it.url)}
                          title="Открыть"
                          disabled={isPageLoading}
                        >
                          Открыть
                        </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {selectedPage && activeTab === 'images' && (
            <div className="browser-view__list">
              {selectedPage.images.length === 0 && <div className="browser-view__empty">Нет картинок.</div>}
              {selectedPage.images.map((x) => (
                <div key={x} className="browser-view__row">
                  <button
                    type="button"
                    className="browser-view__row-main browser-view__row-main--with-thumb"
                    onClick={() => void browserService.highlightImage(x).catch(() => void 0)}
                    title="Подсветить в браузере"
                    disabled={isPageLoading}
                  >
                    <img className="browser-view__thumb" src={x} alt="" loading="lazy" />
                    <div className="browser-view__row-main-two">
                      <div className="browser-view__row-main-text">{x}</div>
                      {formatResourceInfo(headInfoByUrl[x]) ? <div className="browser-view__row-subtext">{formatResourceInfo(headInfoByUrl[x])}</div> : null}
                    </div>
                  </button>
                  <div className="browser-view__row-actions">
                    <button
                      type="button"
                      className="browser-view__action browser-view__action--primary"
                      onClick={() => setImageModalUrl(x)}
                      title="Открыть"
                      disabled={isPageLoading}
                    >
                      Открыть
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedPage && activeTab === 'resources' && (
            <div className="browser-view__list">
              <details className="browser-view__group" open>
                <summary className="browser-view__group-summary">
                  <span className="browser-view__group-title">JS</span>
                  <span className="browser-view__group-count">{selectedPage.scripts.length}</span>
                </summary>
                <div className="browser-view__group-body">
                  {selectedPage.scripts.length === 0 && <div className="browser-view__empty">Нет.</div>}
                  {selectedPage.scripts.map((x) => (
                    <button
                      type="button"
                      key={x}
                      className="browser-view__list-item browser-view__list-item--button browser-view__list-item--with-meta"
                      onClick={() => setResourceModal({ type: 'js', url: x })}
                      disabled={isPageLoading}
                    >
                      <div className="browser-view__list-item-title">{x}</div>
                      {formatResourceInfo(headInfoByUrl[x]) ? <div className="browser-view__list-item-meta">{formatResourceInfo(headInfoByUrl[x])}</div> : null}
                    </button>
                  ))}
                </div>
              </details>

              <details className="browser-view__group">
                <summary className="browser-view__group-summary">
                  <span className="browser-view__group-title">CSS</span>
                  <span className="browser-view__group-count">{selectedPage.stylesheets.length}</span>
                </summary>
                <div className="browser-view__group-body">
                  {selectedPage.stylesheets.length === 0 && <div className="browser-view__empty">Нет.</div>}
                  {selectedPage.stylesheets.map((x) => (
                    <button
                      type="button"
                      key={x}
                      className="browser-view__list-item browser-view__list-item--button browser-view__list-item--with-meta"
                      onClick={() => setResourceModal({ type: 'css', url: x })}
                      disabled={isPageLoading}
                    >
                      <div className="browser-view__list-item-title">{x}</div>
                      {formatResourceInfo(headInfoByUrl[x]) ? <div className="browser-view__list-item-meta">{formatResourceInfo(headInfoByUrl[x])}</div> : null}
                    </button>
                  ))}
                </div>
              </details>

              <details className="browser-view__group">
                <summary className="browser-view__group-summary">
                  <span className="browser-view__group-title">Разное</span>
                  <span className="browser-view__group-count">{tabsCount.resources - selectedPage.scripts.length - selectedPage.stylesheets.length}</span>
                </summary>
                <div className="browser-view__group-body">
                  {(() => {
                    const miscList = Array.isArray(selectedPage.misc) ? selectedPage.misc : []
                    const seen = new Set<string>([...selectedPage.links, ...selectedPage.images, ...selectedPage.scripts, ...selectedPage.stylesheets].map((x) => String(x)))
                    const list = miscList.filter((x) => x && !seen.has(String(x)))
                    if (list.length === 0) {
                      return <div className="browser-view__empty">Нет.</div>
                    }
                    return list.map((x) => (
                      <div key={x} className="browser-view__list-item">
                        <div className="browser-view__list-item-title">{x}</div>
                        {formatResourceInfo(headInfoByUrl[x]) ? <div className="browser-view__list-item-meta">{formatResourceInfo(headInfoByUrl[x])}</div> : null}
                      </div>
                    ))
                  })()}
                </div>
              </details>
            </div>
          )}

          {activeTab === 'errors' && (
            <div className="browser-view__list">
              {errors.length === 0 && <div className="browser-view__empty">Нет ошибок.</div>}
              {errors.map((e, idx) => (
                <div key={`${e.url}:${e.at}:${idx}`} className="browser-view__row">
                  <button
                    type="button"
                    className="browser-view__row-main"
                    onClick={() => void browserService.highlightLink(e.url).catch(() => void 0)}
                    title="Подсветить в браузере"
                    disabled={isPageLoading}
                  >
                    {e.url}
                  </button>
                  <div className="browser-view__row-actions">
                    <button
                      type="button"
                      className="browser-view__action browser-view__action--primary"
                      onClick={() => void openLinkSafely(e.url)}
                      title="Открыть"
                      disabled={isPageLoading}
                    >
                      Открыть
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ImageModal isOpen={Boolean(imageModalUrl)} url={imageModalUrl} onClose={() => setImageModalUrl('')} />
      <ResourceModal
        isOpen={Boolean(resourceModal)}
        type={resourceModal?.type || 'js'}
        url={resourceModal?.url || ''}
        onClose={() => setResourceModal(null)}
      />
    </div>
  )
}

