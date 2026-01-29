import { useEffect } from 'react'
import { Header } from './components/Header/Header'
import { SidebarNav } from './components/SidebarNav/SidebarNav'
import { useAppDispatch, useAppSelector } from './store/hooks'
import { DashboardView } from './views/DashboardView/DashboardView'
import { BrowserView } from './views/BrowserView/BrowserView'
import { SiteMapView } from './views/SiteMapView/SiteMapView'
import { SettingsView } from './views/SettingsView/SettingsView'
import { crawlService } from './services/CrawlService'
import { addError, setCrawlStatus, setProgress, setRunId, setStartUrl, upsertPage } from './store/slices/crawlSlice'
import { useUserConfig } from './hooks/useUserConfig'
import { useTheme } from './hooks/useTheme'
import { useLocale } from './hooks/useLocale'
import { userConfigManager } from './utils/userConfig'
import './App.scss'

function App() {
  const dispatch = useAppDispatch()
  const isLoading = useAppSelector((state) => state.app.isLoading)
  const error = useAppSelector((state) => state.app.error)
  const currentView = useAppSelector((state) => state.app.currentView)
  const theme = useAppSelector((state) => state.app.theme)
  const locale = useAppSelector((state) => state.app.locale)
  const crawlSettings = useAppSelector((state) => state.crawl.settings)

  // Загружаем UserConfig и применяем theme/locale при старте
  useUserConfig()
  useTheme()
  useLocale()

  useEffect(() => {
    void userConfigManager.update({
      app: {
        theme,
        locale,
        currentView,
      },
      crawling: {
        maxDepth: crawlSettings.maxDepth,
        maxPages: crawlSettings.maxPages,
      },
    })
  }, [theme, locale, currentView, crawlSettings.maxDepth, crawlSettings.maxPages])

  useEffect(() => {
    const unsubscribe = crawlService.onEvent((evt) => {
      if (!evt || typeof evt !== 'object') {
        return
      }
      if (evt.type === 'started') {
        dispatch(setRunId(evt.runId))
        dispatch(setStartUrl(evt.startUrl))
        dispatch(setCrawlStatus('running'))
        dispatch(setProgress({ processed: 0, queued: 0 }))
        return
      }
      if (evt.type === 'cancelled') {
        dispatch(setCrawlStatus('cancelled'))
        dispatch(setProgress({ processed: evt.processed, queued: evt.queued }))
        return
      }
      if (evt.type === 'finished') {
        dispatch(setCrawlStatus('finished'))
        dispatch(setProgress({ processed: evt.processed, queued: evt.queued }))
        return
      }
      if (evt.type === 'page:loading') {
        dispatch(setProgress({ processed: evt.processed, queued: evt.queued }))
        return
      }
      if (evt.type === 'page:discovered') {
        dispatch(upsertPage(evt.page))
        dispatch(setProgress({ processed: evt.processed, queued: evt.queued }))
        return
      }
      if (evt.type === 'page:done') {
        dispatch(upsertPage(evt.page))
        dispatch(setProgress({ processed: evt.processed, queued: evt.queued }))
        if (!evt.ok) {
          dispatch(addError({ url: evt.page?.url || '', at: Date.now() }))
        }
      }
    })

    return () => {
      unsubscribe()
    }
  }, [dispatch])

  const renderView = () => {
    if (isLoading) {
      return <div style={{ padding: 16 }}>Загрузка…</div>
    }

    if (error) {
      return <div style={{ padding: 16 }}>Ошибка: {error}</div>
    }

    switch (currentView) {
      case 'dashboard':
        return <DashboardView />
      case 'browser':
        return <BrowserView />
      case 'sitemap':
        return <SiteMapView />
      case 'settings':
        return <SettingsView />
      default:
        return <BrowserView />
    }
  }

  return (
    <div className="app">
      <Header />
      <div className="app__content">
        <div className="app__container">
          <SidebarNav />
          <div className="app__view">
            {renderView()}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

