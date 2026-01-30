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
    settingsViewLayout: {
      sidebarColWidthPx: number
    }
  }
  crawling: {
    maxDepth: number
    maxPages: number
    /** true = убирать дубликаты ссылок по URL; false = сохранять все (по умолчанию) */
    deduplicateLinks: boolean
  }
  /** Настройки построения карты сайта */
  sitemap: {
    /** Максимальное число URL, которые загружаются из sitemap (защита от переполнения памяти) */
    maxUrls: number
    /** После скольких элементов включать виртуализацию списка детей в дереве */
    virtualChildrenThreshold: number
    /** Высота окна (px) для виртуализированного списка детей */
    virtualListHeightPx: number
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
    settingsViewLayout: {
      sidebarColWidthPx: 260,
    },
  },
  crawling: {
    maxDepth: 2,
    maxPages: 200,
    deduplicateLinks: false,
  },
  sitemap: {
    maxUrls: 200000,
    virtualChildrenThreshold: 40,
    virtualListHeightPx: 400,
  },
}

