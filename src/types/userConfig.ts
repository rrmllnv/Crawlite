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
    /** true = не переходить по ссылкам, ведущим на уровни выше стартового URL (папки) */
    restrictToCurrentFolder: boolean
    /** Задержка (ms): пауза между страницами в крауле. Для анализа страницы применяется только если analyzeWaitMs не задан. */
    delayMs: number
    /** Джиттер (ms): случайная добавка к delayMs. Для анализа страницы применяется только если analyzeWaitMs не задан. */
    jitterMs: number
    /** Переопределение User-Agent для краула (пусто = не трогаем) */
    userAgent: string
    /** Переопределение Accept-Language для краула (пусто = не трогаем) */
    acceptLanguage: string
    /** Переопределение navigator.platform (пусто = не трогаем) */
    platform: string
    /** Попытка скрыть navigator.webdriver (JS-override) */
    overrideWebdriver: boolean
    /** Ожидание (ms) перед извлечением данных при анализе страницы (например из карты сайта). Если задано — используется вместо delayMs/jitterMs именно для анализа. */
    analyzeWaitMs: number
    /** Таймаут (ms) на загрузку страницы (ожидание ответа/загрузки) при крауле и анализе. При превышении загрузка прерывается. */
    pageLoadTimeoutMs: number
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
    restrictToCurrentFolder: true,
    delayMs: 650,
    jitterMs: 350,
    userAgent: '',
    acceptLanguage: '',
    platform: '',
    overrideWebdriver: false,
    analyzeWaitMs: 0,
    pageLoadTimeoutMs: 10000,
  },
  sitemap: {
    maxUrls: 200000,
    virtualChildrenThreshold: 40,
    virtualListHeightPx: 400,
  },
}

