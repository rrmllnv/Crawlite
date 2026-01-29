import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { browserService } from '../../services/BrowserService'
import { crawlService } from '../../services/CrawlService'
import { selectPage, upsertPage } from '../../store/slices/crawlSlice'
import { clearRequestedNavigate, ensurePagesTreeExpanded, setCurrentUrl, setDeviceMode, setPageLoading, togglePagesTreeExpanded } from '../../store/slices/browserSlice'
import type { CrawlPageData } from '../../electron'
import { TreeItem, type TreeNode } from '../TreeItem/TreeItem'
import { BrowserProperties, type TabId } from '../BrowserProperties/BrowserProperties'
import { ImageModal } from '../ImageModal/ImageModal'
import { ResourceModal } from '../ResourceModal/ResourceModal'
import './BrowserView.scss'

type LinkDetailed = { url: string; anchor: string }

type ResourceHeadInfo = { sizeBytes: number | null; elapsedMs: number | null }

function isMailtoOrTel(value: string) {
  const v = String(value || '').trim().toLowerCase()
  return v.startsWith('mailto:') || v.startsWith('tel:')
}

function normalizeHostname(hostname: string): string {
  const h = String(hostname || '').trim().toLowerCase()
  return h.startsWith('www.') ? h.slice(4) : h
}

const EMULATED_WIDTH_MOBILE = 390
const EMULATED_WIDTH_TABLET = 768
const EMULATED_HEIGHT_MOBILE = 844
const EMULATED_HEIGHT_TABLET = 1024

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
      let height: number
      let x: number
      let y: number
      if (deviceMode === 'mobile') {
        width = Math.min(EMULATED_WIDTH_MOBILE, fullWidth)
        height = Math.min(EMULATED_HEIGHT_MOBILE, fullHeight)
        x = left + Math.max(0, Math.floor((fullWidth - width) / 2))
        y = top + Math.max(0, Math.floor((fullHeight - height) / 2))
      } else if (deviceMode === 'tablet') {
        width = Math.min(EMULATED_WIDTH_TABLET, fullWidth)
        height = Math.min(EMULATED_HEIGHT_TABLET, fullHeight)
        x = left + Math.max(0, Math.floor((fullWidth - width) / 2))
        y = top + Math.max(0, Math.floor((fullHeight - height) / 2))
      } else {
        width = fullWidth
        height = fullHeight
        x = left
        y = top
      }

      const bounds = {
        x,
        y,
        width,
        height,
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
  const [viewSize, setViewSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  const pages = useMemo(() => {
    return pageOrder
      .map((key) => pagesByUrl[key])
      .filter((p): p is CrawlPageData => Boolean(p))
  }, [pageOrder, pagesByUrl])

  const tree = useMemo(() => buildUrlTree(pages, pagesByUrl), [pages, pagesByUrl])
  const expanded = useMemo(() => new Set(pagesTreeExpandedIds || []), [pagesTreeExpandedIds])

  useEffect(() => {
    const el = boundsRef.current
    if (!el) {
      return
    }
    const update = () => {
      if (!boundsRef.current) return
      const r = boundsRef.current.getBoundingClientRect()
      setViewSize({
        width: Math.max(0, Math.floor(r.width)),
        height: Math.max(0, Math.floor(r.height)),
      })
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    update()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [deviceMode])

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
          <div className="browser-view__browser-header-row">
            <div className="browser-view__col-subtitle browser-view__browser-url">
              {selectedPage ? selectedPage.url : '—'}
            </div>
            <div className="browser-view__col-subtitle browser-view__browser-size" title="Размер экрана (viewport)">
              {deviceMode === 'desktop'
                ? (viewSize.width > 0 || viewSize.height > 0 ? `${viewSize.width} × ${viewSize.height}` : '—')
                : deviceMode === 'mobile'
                  ? `${EMULATED_WIDTH_MOBILE} × ${viewSize.height > 0 ? Math.min(viewSize.height, EMULATED_HEIGHT_MOBILE) : EMULATED_HEIGHT_MOBILE}`
                  : `${EMULATED_WIDTH_TABLET} × ${viewSize.height > 0 ? Math.min(viewSize.height, EMULATED_HEIGHT_TABLET) : EMULATED_HEIGHT_TABLET}`}
            </div>
          </div>
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
        <div className="browser-view__details-wrap">
        <BrowserProperties
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          tabsCount={tabsCount}
          selectedPage={selectedPage}
          seoIssues={seoIssues}
          summary={summary}
          openHeadingLevels={openHeadingLevels}
          setOpenHeadingLevels={setOpenHeadingLevels}
          isPageLoading={isPageLoading}
          contacts={contacts}
          linkGroups={linkGroups}
          headInfoByUrl={headInfoByUrl}
          errors={errors}
          onOpenLink={openLinkSafely}
          onOpenImage={setImageModalUrl}
          onOpenResource={(type, url) => setResourceModal({ type, url })}
        />
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

