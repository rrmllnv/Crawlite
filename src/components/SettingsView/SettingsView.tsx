import { useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { commitSettingsViewLayout, setSettingsViewLayout } from '../../store/slices/appSlice'
import { setSitemapSettings } from '../../store/slices/sitemapSlice'
import { PanelResizer } from '../PanelResizer/PanelResizer'
import './SettingsView.scss'

type SettingsTabId = 'general' | 'dashboard' | 'browser' | 'sitemap'

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  const v = Math.floor(value)
  return Math.min(max, Math.max(min, v))
}

export function SettingsView() {
  const dispatch = useAppDispatch()

  const sidebarColWidthPx = useAppSelector((s) => s.app.settingsViewLayout.sidebarColWidthPx)
  const sitemapSettings = useAppSelector((s) => s.sitemap.settings)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const resizerWidthPx = 10
  const minSidebarPx = 220
  const minContentPx = 420

  const [activeTab, setActiveTab] = useState<SettingsTabId>('general')

  const maxUrlsValue = useMemo(() => String(sitemapSettings.maxUrls), [sitemapSettings.maxUrls])
  const virtualThresholdValue = useMemo(
    () => String(sitemapSettings.virtualChildrenThreshold),
    [sitemapSettings.virtualChildrenThreshold],
  )
  const virtualHeightValue = useMemo(
    () => String(sitemapSettings.virtualListHeightPx),
    [sitemapSettings.virtualListHeightPx],
  )

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
    const maxSidebarPx =
      containerWidth > 0
        ? Math.max(minSidebarPx, containerWidth - minContentPx - resizerWidthPx)
        : Math.max(minSidebarPx, sidebarColWidthPx + 800)
    const next = clamp(sidebarColWidthPx + deltaX, minSidebarPx, maxSidebarPx)
    dispatch(setSettingsViewLayout({ sidebarColWidthPx: next }))
  }

  const commitLayout = () => {
    dispatch(commitSettingsViewLayout({ sidebarColWidthPx }))
  }

  const renderContent = () => {
    if (activeTab === 'general') {
      return (
        <div className="settings-view__section">
          <div className="settings-view__section-title">Общие</div>
          <div className="settings-view__empty">Пока нет настроек в этом разделе.</div>
        </div>
      )
    }
    if (activeTab === 'dashboard') {
      return (
        <div className="settings-view__section">
          <div className="settings-view__section-title">Дашборд</div>
          <div className="settings-view__empty">Пока нет настроек в этом разделе.</div>
        </div>
      )
    }
    if (activeTab === 'browser') {
      return (
        <div className="settings-view__section">
          <div className="settings-view__section-title">Браузер</div>
          <div className="settings-view__empty">Пока нет настроек в этом разделе.</div>
        </div>
      )
    }
    return (
      <div className="settings-view__section">
        <div className="settings-view__section-title">Карта сайта</div>

        <div className="settings-view__card">
          <label className="settings-view__field">
            <div className="settings-view__label">Макс. URL в карте сайта</div>
            <input
              className="settings-view__input"
              type="number"
              min={1000}
              max={2000000}
              step={1000}
              value={maxUrlsValue}
              onChange={(e) => {
                const next = clampInt(Number(e.target.value), 1000, 2000000)
                dispatch(setSitemapSettings({ maxUrls: next }))
              }}
            />
            <div className="settings-view__hint">
              Лимит URL при построении карты из sitemap. При превышении загрузка останавливается.
            </div>
          </label>

          <label className="settings-view__field">
            <div className="settings-view__label">Виртуализация: порог (детей в узле)</div>
            <input
              className="settings-view__input"
              type="number"
              min={0}
              max={10000}
              step={1}
              value={virtualThresholdValue}
              onChange={(e) => {
                const next = clampInt(Number(e.target.value), 0, 10000)
                dispatch(setSitemapSettings({ virtualChildrenThreshold: next }))
              }}
            />
            <div className="settings-view__hint">
              После скольких элементов у раскрытого узла включать виртуальный список. 0 = всегда.
            </div>
          </label>

          <label className="settings-view__field">
            <div className="settings-view__label">Виртуализация: высота окна (px)</div>
            <input
              className="settings-view__input"
              type="number"
              min={120}
              max={2000}
              step={10}
              value={virtualHeightValue}
              onChange={(e) => {
                const next = clampInt(Number(e.target.value), 120, 2000)
                dispatch(setSitemapSettings({ virtualListHeightPx: next }))
              }}
            />
            <div className="settings-view__hint">
              Высота окна скролла для виртуализированного списка детей.
            </div>
          </label>
        </div>
      </div>
    )
  }

  return (
    <div
      className="settings-view"
      ref={rootRef}
      style={{ gridTemplateColumns: `${sidebarColWidthPx}px ${resizerWidthPx}px 1fr` }}
    >
      <aside className="settings-view__sidebar" aria-label="Разделы настроек">
        <div className="settings-view__sidebar-title">Настройки</div>
        <div className="settings-view__tabs" role="tablist" aria-label="Разделы">
          <button
            type="button"
            className={`settings-view__tab ${activeTab === 'general' ? 'settings-view__tab--active' : ''}`}
            onClick={() => setActiveTab('general')}
            role="tab"
            aria-selected={activeTab === 'general'}
          >
            <span className="settings-view__tab-title">Общие</span>
          </button>
          <button
            type="button"
            className={`settings-view__tab ${activeTab === 'dashboard' ? 'settings-view__tab--active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
            role="tab"
            aria-selected={activeTab === 'dashboard'}
          >
            <span className="settings-view__tab-title">Дашборд</span>
          </button>
          <button
            type="button"
            className={`settings-view__tab ${activeTab === 'browser' ? 'settings-view__tab--active' : ''}`}
            onClick={() => setActiveTab('browser')}
            role="tab"
            aria-selected={activeTab === 'browser'}
          >
            <span className="settings-view__tab-title">Браузер</span>
          </button>
          <button
            type="button"
            className={`settings-view__tab ${activeTab === 'sitemap' ? 'settings-view__tab--active' : ''}`}
            onClick={() => setActiveTab('sitemap')}
            role="tab"
            aria-selected={activeTab === 'sitemap'}
          >
            <span className="settings-view__tab-title">Карта сайта</span>
          </button>
        </div>
      </aside>

      <PanelResizer
        ariaLabel="Изменение ширины колонок: разделы/контент"
        onDeltaX={onSidebarResizerDeltaX}
        onDragEnd={commitLayout}
      />

      <main className="settings-view__content" aria-label="Настройки">
        {renderContent()}
      </main>
    </div>
  )
}

