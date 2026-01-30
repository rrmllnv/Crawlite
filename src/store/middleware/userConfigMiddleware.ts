import { Middleware } from '@reduxjs/toolkit'
import { userConfigManager } from '../../utils/userConfig'

export const userConfigMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action)

  const actionType = action && typeof action === 'object' && 'type' in action ? action.type : null
  const actionsToSave = [
    'app/setCurrentView',
    'crawl/setCrawlSettings',
    'app/commitBrowserViewLayout',
    'app/commitSettingsViewLayout',
    'sitemap/setSitemapSettings',
  ]

  if (actionType && actionsToSave.includes(actionType as string)) {
    const state = store.getState()
    void userConfigManager.update({
      app: {
        theme: state.app.theme,
        locale: state.app.locale,
        currentView: state.app.currentView,
        browserViewLayout: state.app.browserViewLayout,
        settingsViewLayout: state.app.settingsViewLayout,
      },
      crawling: {
        maxDepth: state.crawl.settings.maxDepth,
        maxPages: state.crawl.settings.maxPages,
        deduplicateLinks: state.crawl.settings.deduplicateLinks,
        delayMs: state.crawl.settings.delayMs,
        jitterMs: state.crawl.settings.jitterMs,
        userAgent: state.crawl.settings.userAgent,
        acceptLanguage: state.crawl.settings.acceptLanguage,
        platform: state.crawl.settings.platform,
        overrideWebdriver: state.crawl.settings.overrideWebdriver,
      },
      sitemap: {
        maxUrls: state.sitemap.settings.maxUrls,
        virtualChildrenThreshold: state.sitemap.settings.virtualChildrenThreshold,
        virtualListHeightPx: state.sitemap.settings.virtualListHeightPx,
      },
    })
  }

  return result
}
