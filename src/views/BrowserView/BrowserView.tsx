import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { browserService } from '../../services/BrowserService'
import { selectPage } from '../../store/slices/crawlSlice'
import { clearRequestedNavigate, setCurrentUrl } from '../../store/slices/browserSlice'
import type { CrawlPageData } from '../../electron'
import './BrowserView.scss'

type TabId = 'meta' | 'links' | 'images' | 'js' | 'css'

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

function ListItem({ page, isSelected, onClick }: { page: CrawlPageData; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`browser-view__page ${isSelected ? 'browser-view__page--active' : ''}`}
      onClick={onClick}
      title={page.url}
    >
      <div className="browser-view__page-title">{page.title || page.h1 || page.url}</div>
      <div className="browser-view__page-url">{page.url}</div>
    </button>
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

  const pages = useMemo(() => {
    return pageOrder
      .map((key) => pagesByUrl[key])
      .filter((p): p is CrawlPageData => Boolean(p))
  }, [pageOrder, pagesByUrl])

  const selectedPage = useMemo(() => {
    const key = selectedUrl
    if (!key) {
      return null
    }
    return pagesByUrl[key] || null
  }, [pagesByUrl, selectedUrl])

  useEffect(() => {
    if (!requestedUrl) {
      return
    }
    void (async () => {
      try {
        await browserService.navigate(requestedUrl)
        dispatch(setCurrentUrl(requestedUrl))
      } catch {
        void 0
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

  return (
    <div className="browser-view">
      <div className="browser-view__col browser-view__col--pages">
        <div className="browser-view__col-header">
          <div className="browser-view__col-title">Страницы</div>
          <div className="browser-view__col-subtitle">{pages.length}</div>
        </div>
        <div className="browser-view__pages">
          {pages.length === 0 && (
            <div className="browser-view__empty">
              Пока нет страниц. Запустите crawling в Header.
            </div>
          )}
          {pages.map((p) => (
            <ListItem
              key={p.normalizedUrl || p.url}
              page={p}
              isSelected={(p.normalizedUrl || p.url) === selectedUrl}
              onClick={() => void handleSelect(p)}
            />
          ))}
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
            Ссылки
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'images' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('images')}
          >
            Картинки
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'js' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('js')}
          >
            JS
          </button>
          <button
            type="button"
            className={`browser-view__tab ${activeTab === 'css' ? 'browser-view__tab--active' : ''}`}
            onClick={() => setActiveTab('css')}
          >
            CSS
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
            </div>
          )}

          {selectedPage && activeTab === 'links' && (
            <div className="browser-view__list">
              {selectedPage.links.length === 0 && <div className="browser-view__empty">Нет ссылок.</div>}
              {selectedPage.links.map((x) => (
                <div key={x} className="browser-view__list-item">
                  {x}
                </div>
              ))}
            </div>
          )}

          {selectedPage && activeTab === 'images' && (
            <div className="browser-view__list">
              {selectedPage.images.length === 0 && <div className="browser-view__empty">Нет картинок.</div>}
              {selectedPage.images.map((x) => (
                <div key={x} className="browser-view__list-item">
                  {x}
                </div>
              ))}
            </div>
          )}

          {selectedPage && activeTab === 'js' && (
            <div className="browser-view__list">
              {selectedPage.scripts.length === 0 && <div className="browser-view__empty">Нет JS.</div>}
              {selectedPage.scripts.map((x) => (
                <div key={x} className="browser-view__list-item">
                  {x}
                </div>
              ))}
            </div>
          )}

          {selectedPage && activeTab === 'css' && (
            <div className="browser-view__list">
              {selectedPage.stylesheets.length === 0 && <div className="browser-view__empty">Нет CSS.</div>}
              {selectedPage.stylesheets.map((x) => (
                <div key={x} className="browser-view__list-item">
                  {x}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

