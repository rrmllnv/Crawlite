export type Theme = 'dark' | 'light'

export interface UserConfig {
  app: {
    theme: Theme
    locale: string
    currentView: 'dashboard' | 'browser' | 'sitemap' | 'settings'
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
  },
  crawling: {
    maxDepth: 2,
    maxPages: 200,
  },
}

