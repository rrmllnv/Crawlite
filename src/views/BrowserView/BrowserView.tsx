import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { browserService } from '../../services/BrowserService'
import { crawlService } from '../../services/CrawlService'
import { selectPage, resetCrawl, setCrawlStatus, setRunId, setStartUrl } from '../../store/slices/crawlSlice'
import { clearRequestedNavigate, setCurrentUrl } from '../../store/slices/browserSlice'
import { setError, setLoading } from '../../store/slices/appSlice'
import type { CrawlPageData } from '../../electron'
import { Separate } from '../../components/Separate/Separate'
import { ImageModal } from '../../components/ImageModal/ImageModal'
import { ResourceModal } from '../../components/ResourceModal/ResourceModal'
import './BrowserView.scss'

type TabId = 'meta' | 'links' | 'images' | 'js' | 'css' | 'misc'

function formatNumber(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—'
  }
  return value.toString()
}

function useBrowserBounds() {
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
      const bounds = {
        x: Math.max(0, Math.floor(rect.left)),
        y: Math.max(0, Math.floor(rect.top)),
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
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
  }, [])

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
  const boundsRef = useBrowserBounds()

  const pagesByUrl = useAppSelector((s) => s.crawl.pagesByUrl)
  const pageOrder = useAppSelector((s) => s.crawl.pageOrder)
  const selectedUrl = useAppSelector((s) => s.crawl.selectedUrl)
  const requestedUrl = useAppSelector((s) => s.browser.requestedUrl)

  const [activeTab, setActiveTab] = useState<TabId>('meta')
  const [imageModalUrl, setImageModalUrl] = useState<string>('')
  const [resourceModal, setResourceModal] = useState<{ type: 'js' | 'css'; url: string } | null>(null)

  const pages = useMemo(() => {
    return pageOrder
      .map((key) => pagesByUrl[key])
      .filter((p): p is CrawlPageData => Boolean(p))
  }, [pageOrder, pagesByUrl])

  const tree = useMemo(() => buildUrlTree(pages, pagesByUrl), [pages, pagesByUrl])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['root']))

  useEffect(() => {
    // авто-раскрытие корня и хоста выбранной страницы
    const p = selectedUrl ? pagesByUrl[selectedUrl] : null
    if (!p?.url) {
      return
    }
    try {
      const u = new URL(p.url)
      const hostId = `host:${u.hostname}`
      setExpanded((prev) => {
        const next = new Set(prev)
        next.add('root')
        next.add(hostId)
        return next
      })
    } catch {
      void 0
    }
  }, [selectedUrl, pagesByUrl])

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedPage = useMemo(() => {
    const key = selectedUrl
    if (!key) {
      return null
    }
    return pagesByUrl[key] || null
  }, [pagesByUrl, selectedUrl])

  const startSinglePageCrawlAndOpen = async (url: string) => {
    const target = String(url || '').trim()
    if (!target) {
      return
    }

    dispatch(setError(null))
    dispatch(setLoading(true))
    dispatch(resetCrawl())
    dispatch(setStartUrl(target))
    dispatch(setCrawlStatus('running'))

    try {
      const navRes = await browserService.navigate(target)
      if (!navRes?.success) {
        throw new Error(navRes?.error || 'Browser navigate failed')
      }
      dispatch(setCurrentUrl(target))
    } catch {
      dispatch(setCrawlStatus('error'))
      dispatch(setError('Не удалось открыть URL (проверьте домен/DNS)'))
      dispatch(setLoading(false))
      return
    }

    try {
      const res = await crawlService.start({
        startUrl: target,
        options: {
          maxDepth: 0,
          maxPages: 1,
          delayMs: 0,
          jitterMs: 0,
        },
      })
      if (!res.success) {
        dispatch(setCrawlStatus('error'))
        dispatch(setError(res.error || 'Crawl start failed'))
        return
      }
      dispatch(setRunId(typeof (res as any).runId === 'string' ? (res as any).runId : null))
    } catch (error) {
      dispatch(setCrawlStatus('error'))
      dispatch(setError(String(error)))
    } finally {
      dispatch(setLoading(false))
    }
  }

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

  const tabsCount = useMemo(() => {
    if (!selectedPage) {
      return { links: 0, images: 0, js: 0, css: 0, misc: 0 }
    }
    const links = selectedPage.links?.length || 0
    const images = selectedPage.images?.length || 0
    const js = selectedPage.scripts?.length || 0
    const css = selectedPage.stylesheets?.length || 0
    const miscRaw = (selectedPage as any).misc as string[] | undefined
    const miscList = Array.isArray(miscRaw) ? miscRaw : []
    const seen = new Set<string>([...selectedPage.links, ...selectedPage.images, ...selectedPage.scripts, ...selectedPage.stylesheets].map((x) => String(x)))
    const misc = miscList.filter((x) => x && !seen.has(String(x))).length
    return { links, images, js, css, misc }
  }, [selectedPage])

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
              Пока нет страниц. Запустите crawling в Header.
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
          <div className="browser-view__col-title">Браузер</div>
          <div className="browser-view__col-subtitle">{selectedPage ? selectedPage.url : '—'}</div>
        </div>
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
            Ссылки <span className="browser-view__tab-count">{selectedPage ? tabsCount.links : '—'}</span>
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'images' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('images')}
          >
            Картинки <span className="browser-view__tab-count">{selectedPage ? tabsCount.images : '—'}</span>
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'js' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('js')}
          >
            JS <span className="browser-view__tab-count">{selectedPage ? tabsCount.js : '—'}</span>
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'css' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('css')}
          >
            CSS <span className="browser-view__tab-count">{selectedPage ? tabsCount.css : '—'}</span>
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'misc' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('misc')}
          >
            Разное <span className="browser-view__tab-count">{selectedPage ? tabsCount.misc : '—'}</span>
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
                <div className="browser-view__kv-key">Размер (bytes)</div>
                <div className="browser-view__kv-val">{formatNumber(selectedPage.contentLength)}</div>
              </div>
              <div className="browser-view__kv-row">
                <div className="browser-view__kv-key">Время открытия (ms)</div>
                <div className="browser-view__kv-val">{formatNumber(selectedPage.loadTimeMs)}</div>
              </div>

              <Separate title="Сводка по странице" />

              <details className="browser-view__details-block" open>
                <summary className="browser-view__details-summary">
                  <span className="browser-view__details-summary-title">Заголовки</span>
                  <span className="browser-view__details-summary-value">{summary ? `всего ${summary.totalHeadings}` : '—'}</span>
                </summary>

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
                          <div key={`h1:${t}`} className="browser-view__headings-item">
                            {t}
                          </div>
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
                        <details key={key} className="browser-view__headings-level">
                          <summary className="browser-view__headings-summary">
                            <span className="browser-view__headings-title">{label}</span>
                            <span className="browser-view__headings-count">{count}</span>
                          </summary>
                          <div className="browser-view__headings-list">
                            {items.length === 0 && <div className="browser-view__headings-empty">Нет</div>}
                            {items.map((t) => (
                              <div key={`${key}:${t}`} className="browser-view__headings-item">
                                {t}
                              </div>
                            ))}
                          </div>
                        </details>
                      )
                    })}
                  </div>
                )}

                {!summary && <div className="browser-view__empty">—</div>}
              </details>

            </div>
          )}

          {selectedPage && activeTab === 'links' && (
            <div className="browser-view__list">
              {selectedPage.links.length === 0 && <div className="browser-view__empty">Нет ссылок.</div>}
              {selectedPage.links.map((x) => (
                <button
                  type="button"
                  key={x}
                  className="browser-view__list-item browser-view__list-item--button"
                  onClick={() => void startSinglePageCrawlAndOpen(x)}
                >
                  {x}
                </button>
              ))}
            </div>
          )}

          {selectedPage && activeTab === 'images' && (
            <div className="browser-view__list">
              {selectedPage.images.length === 0 && <div className="browser-view__empty">Нет картинок.</div>}
              {selectedPage.images.map((x) => (
                <button type="button" key={x} className="browser-view__list-item browser-view__list-item--button" onClick={() => setImageModalUrl(x)}>
                  {x}
                </button>
              ))}
            </div>
          )}

          {selectedPage && activeTab === 'js' && (
            <div className="browser-view__list">
              {selectedPage.scripts.length === 0 && <div className="browser-view__empty">Нет JS.</div>}
              {selectedPage.scripts.map((x) => (
                <button
                  type="button"
                  key={x}
                  className="browser-view__list-item browser-view__list-item--button"
                  onClick={() => setResourceModal({ type: 'js', url: x })}
                >
                  {x}
                </button>
              ))}
            </div>
          )}

          {selectedPage && activeTab === 'css' && (
            <div className="browser-view__list">
              {selectedPage.stylesheets.length === 0 && <div className="browser-view__empty">Нет CSS.</div>}
              {selectedPage.stylesheets.map((x) => (
                <button
                  type="button"
                  key={x}
                  className="browser-view__list-item browser-view__list-item--button"
                  onClick={() => setResourceModal({ type: 'css', url: x })}
                >
                  {x}
                </button>
              ))}
            </div>
          )}

          {selectedPage && activeTab === 'misc' && (
            <div className="browser-view__list">
              {(() => {
                const miscRaw = (selectedPage as any).misc as string[] | undefined
                const miscList = Array.isArray(miscRaw) ? miscRaw : []
                const seen = new Set<string>([...selectedPage.links, ...selectedPage.images, ...selectedPage.scripts, ...selectedPage.stylesheets].map((x) => String(x)))
                const list = miscList.filter((x) => x && !seen.has(String(x)))
                if (list.length === 0) {
                  return <div className="browser-view__empty">Нет.</div>
                }
                return list.map((x) => (
                  <div key={x} className="browser-view__list-item">
                    {x}
                  </div>
                ))
              })()}
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

