export type Theme = 'dark' | 'light'

export interface UserConfig {
  app: {
    theme: Theme
    locale: string
    currentView: 'dashboard' | 'browser' | 'sitemap' | 'settings'
    browserViewLayout: {
      pagesColWidthPx: number
      detailsColWidthPx: number
    }
  }
  crawling: {
    maxDepth: number
    maxPages: number
  }
}

export const defaultUserConfig: UserConfig = {
  app: {
    theme: 'dark',
    locale: 'ru',
    currentView: 'browser',
    browserViewLayout: {
      pagesColWidthPx: 320,
      detailsColWidthPx: 420,
    },
  },
  crawling: {
    maxDepth: 2,
    maxPages: 200,
  },
}

