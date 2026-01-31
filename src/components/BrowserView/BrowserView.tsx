import { useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { commitBrowserViewLayout, setBrowserViewLayout } from '../../store/slices/appSlice'
import { browserService } from '../../services/BrowserService'
import { TreeItem } from '../TreeItem/TreeItem'
import { BrowserProperties, type TabId } from '../BrowserProperties/BrowserProperties'
import { BrowserInspector } from '../BrowserInspector'
import { ImageModal } from '../ImageModal/ImageModal'
import { ResourceModal } from '../ResourceModal/ResourceModal'
import { PanelResizer } from '../PanelResizer/PanelResizer'
import { useBrowserBounds } from './hooks/useBrowserBounds'
import { useBrowserViewData } from './hooks/useBrowserViewData'
import { useBrowserEffects } from './hooks/useBrowserEffects'
import { useBrowserHandlers } from './hooks/useBrowserHandlers'
import { EMULATED_HEIGHT_MOBILE, EMULATED_HEIGHT_TABLET, EMULATED_WIDTH_MOBILE, EMULATED_WIDTH_TABLET } from './types'
import type { ResourceHeadInfo } from './types'
import './BrowserView.scss'

export function BrowserView() {
  const dispatch = useAppDispatch()
  const deviceMode = useAppSelector((s) => s.browser.deviceMode)
  const isPageLoading = useAppSelector((s) => s.browser.isPageLoading)
  const canGoBack = useAppSelector((s) => s.browser.canGoBack)
  const canGoForward = useAppSelector((s) => s.browser.canGoForward)
  const pagesColWidthPx = useAppSelector((s) => s.app.browserViewLayout.pagesColWidthPx)
  const detailsColWidthPx = useAppSelector((s) => s.app.browserViewLayout.detailsColWidthPx)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const resizerWidthPx = 10
  const minBrowserPx = 360
  const minPagesPx = 220
  const minDetailsPx = 280

  const [activeTab, setActiveTab] = useState<TabId>('meta')
  const [imageModalUrl, setImageModalUrl] = useState<string>('')
  const [resourceModal, setResourceModal] = useState<{ type: 'js' | 'css'; url: string } | null>(null)
  const [openHeadingLevels, setOpenHeadingLevels] = useState<Set<string>>(() => new Set())
  const [headInfoByUrl, setHeadInfoByUrl] = useState<Record<string, ResourceHeadInfo>>({})
  const [viewSize, setViewSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [isInspectorElementsAllEnabled, setIsInspectorElementsAllEnabled] = useState<boolean>(false)
  const [isInspectorElementsHoverEnabled, setIsInspectorElementsHoverEnabled] = useState<boolean>(false)
  const [isInspectorPanelOpen, setIsInspectorPanelOpen] = useState<boolean>(false)

  const boundsRef = useBrowserBounds(deviceMode)

  const {
    pagesByUrl,
    selectedUrl,
    selectedPage,
    errors,
    pages,
    tree,
    expanded,
    resourceMiscList,
    anchorsList,
    linkGroups,
    summary,
    contacts,
    seoIssues,
    tabsCount,
  } = useBrowserViewData()

  useBrowserEffects({
    boundsRef,
    deviceMode,
    setViewSize,
    selectedUrl,
    pagesByUrl,
    selectedPage,
    activeTab,
    resourceMiscList,
    headInfoByUrl,
    setHeadInfoByUrl,
  })

  const { toggle, handleSetDeviceMode, openLinkSafely, handleSelectKey } = useBrowserHandlers({
    deviceMode,
    isPageLoading,
    pagesByUrl,
  })

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

  const onLeftResizerDeltaX = (deltaX: number) => {
    const containerWidth = getContainerWidth()
    const resizersTotal = resizerWidthPx * 2
    const maxPagesPx =
      containerWidth > 0
        ? Math.max(minPagesPx, containerWidth - detailsColWidthPx - minBrowserPx - resizersTotal)
        : Math.max(minPagesPx, pagesColWidthPx + 800)
    const nextPages = clamp(pagesColWidthPx + deltaX, minPagesPx, maxPagesPx)
    dispatch(setBrowserViewLayout({ pagesColWidthPx: nextPages }))
  }

  const onRightResizerDeltaX = (deltaX: number) => {
    const containerWidth = getContainerWidth()
    const resizersTotal = resizerWidthPx * 2
    const maxDetailsPx =
      containerWidth > 0
        ? Math.max(minDetailsPx, containerWidth - pagesColWidthPx - minBrowserPx - resizersTotal)
        : Math.max(minDetailsPx, detailsColWidthPx + 800)
    const nextDetails = clamp(detailsColWidthPx - deltaX, minDetailsPx, maxDetailsPx)
    dispatch(setBrowserViewLayout({ detailsColWidthPx: nextDetails }))
  }

  const commitLayout = () => {
    dispatch(commitBrowserViewLayout({ pagesColWidthPx, detailsColWidthPx }))
  }

  return (
    <div className="browser-view" ref={rootRef}>
      <div
        className="browser-view__col browser-view__col--pages"
        style={{ width: `${pagesColWidthPx}px` }}
      >
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

      <PanelResizer
        ariaLabel="Изменение ширины колонок: страницы/браузер"
        onDeltaX={onLeftResizerDeltaX}
        onDragEnd={commitLayout}
      />

      <div className="browser-view__col browser-view__col--browser">
        <div className="browser-view__browser-header">
          <div className="browser-view__browser-header-top">
            <div className="browser-view__col-title">Браузер</div>
            <div className="browser-view__controls">
              <div className="browser-view__nav-controls" role="group" aria-label="Навигация">
                <button
                  type="button"
                  className="browser-view__device-button"
                  onClick={() => void browserService.goBack().catch(() => void 0)}
                  title="Назад"
                  aria-label="Назад"
                  disabled={!canGoBack}
                >
                  <i className="fa-solid fa-arrow-left" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="browser-view__device-button"
                  onClick={() => void browserService.goForward().catch(() => void 0)}
                  title="Вперёд"
                  aria-label="Вперёд"
                  disabled={!canGoForward}
                >
                  <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="browser-view__device-button"
                  onClick={() => void browserService.reload().catch(() => void 0)}
                  title="Обновить"
                  aria-label="Обновить"
                >
                  <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className={`browser-view__device-button ${isInspectorElementsAllEnabled ? 'browser-view__device-button--active' : ''}`}
                  onClick={() =>
                    void browserService
                      .toggleInspectorElementsAll()
                      .then((res) => {
                        if (!res || res.success !== true) return
                        setIsInspectorElementsAllEnabled(Boolean(res.enabledAll))
                        setIsInspectorElementsHoverEnabled(Boolean(res.enabledHover))
                      })
                      .catch(() => void 0)
                  }
                  title="Подсветить элементы"
                  aria-label="Подсветить элементы"
                  aria-pressed={isInspectorElementsAllEnabled}
                >
                  <i className="fa-solid fa-border-all" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className={`browser-view__device-button ${isInspectorElementsHoverEnabled ? 'browser-view__device-button--active' : ''}`}
                  onClick={() =>
                    void browserService
                      .toggleInspectorElementsHover()
                      .then((res) => {
                        if (!res || res.success !== true) return
                        setIsInspectorElementsAllEnabled(Boolean(res.enabledAll))
                        setIsInspectorElementsHoverEnabled(Boolean(res.enabledHover))
                        setIsInspectorPanelOpen(true)
                      })
                      .catch(() => void 0)
                  }
                  title="Инспектор (наведение)"
                  aria-label="Инспектор (наведение)"
                  aria-pressed={isInspectorElementsHoverEnabled}
                >
                  <i className="fa-solid fa-arrow-pointer" aria-hidden="true" />
                </button>
              </div>

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

      <PanelResizer
        ariaLabel="Изменение ширины колонок: браузер/данные"
        onDeltaX={onRightResizerDeltaX}
        onDragEnd={commitLayout}
      />

      <div
        className="browser-view__col browser-view__col--details"
        style={{ width: `${detailsColWidthPx}px` }}
      >
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
            anchors={anchorsList}
            headInfoByUrl={headInfoByUrl}
            errors={errors}
            onOpenLink={openLinkSafely}
            onOpenImage={setImageModalUrl}
            onOpenResource={(type, url) => setResourceModal({ type, url })}
          />
          <BrowserInspector
            isOpen={isInspectorPanelOpen}
            onOpenChange={setIsInspectorPanelOpen}
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
