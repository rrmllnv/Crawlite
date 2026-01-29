import { useState } from 'react'
import { useAppSelector } from '../../store/hooks'
import { TreeItem } from '../TreeItem/TreeItem'
import { BrowserProperties, type TabId } from '../BrowserProperties/BrowserProperties'
import { ImageModal } from '../ImageModal/ImageModal'
import { ResourceModal } from '../ResourceModal/ResourceModal'
import { useBrowserBounds } from './hooks/useBrowserBounds'
import { useBrowserViewData } from './hooks/useBrowserViewData'
import { useBrowserEffects } from './hooks/useBrowserEffects'
import { useBrowserHandlers } from './hooks/useBrowserHandlers'
import { EMULATED_HEIGHT_MOBILE, EMULATED_HEIGHT_TABLET, EMULATED_WIDTH_MOBILE, EMULATED_WIDTH_TABLET } from './types'
import type { ResourceHeadInfo } from './types'
import './BrowserView.scss'

export function BrowserView() {
  const deviceMode = useAppSelector((s) => s.browser.deviceMode)
  const isPageLoading = useAppSelector((s) => s.browser.isPageLoading)

  const [activeTab, setActiveTab] = useState<TabId>('meta')
  const [imageModalUrl, setImageModalUrl] = useState<string>('')
  const [resourceModal, setResourceModal] = useState<{ type: 'js' | 'css'; url: string } | null>(null)
  const [openHeadingLevels, setOpenHeadingLevels] = useState<Set<string>>(() => new Set())
  const [headInfoByUrl, setHeadInfoByUrl] = useState<Record<string, ResourceHeadInfo>>({})
  const [viewSize, setViewSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

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
