import { Middleware } from '@reduxjs/toolkit'
import { userConfigManager } from '../../utils/userConfig'

export const userConfigMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action)

  const actionType = action && typeof action === 'object' && 'type' in action ? action.type : null
  const actionsToSave = ['app/setCurrentView', 'crawl/setCrawlSettings', 'app/commitBrowserViewLayout', 'sitemap/setSitemapSettings']

  if (actionType && actionsToSave.includes(actionType as string)) {
    const state = store.getState()
    void userConfigManager.update({
      app: {
        theme: state.app.theme,
        locale: state.app.locale,
        currentView: state.app.currentView,
        browserViewLayout: state.app.browserViewLayout,
      },
      crawling: {
        maxDepth: state.crawl.settings.maxDepth,
        maxPages: state.crawl.settings.maxPages,
        deduplicateLinks: state.crawl.settings.deduplicateLinks,
      },
      sitemap: {
        maxUrls: state.sitemap.settings.maxUrls,
      },
    })
  }

  return result
}
