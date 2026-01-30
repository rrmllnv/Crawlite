import { useEffect, useMemo } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setCrawlSettings } from '../../store/slices/crawlSlice'
import { browserService } from '../../services/BrowserService'
import './SettingsCrawling.scss'

type Props = {
  isOpen: boolean
  onClose: () => void
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  const v = Math.floor(value)
  return Math.min(max, Math.max(min, v))
}

export function SettingsCrawling({ isOpen, onClose }: Props) {
  const dispatch = useAppDispatch()
  const settings = useAppSelector((s) => s.crawl.settings)
  const currentView = useAppSelector((s) => s.app.currentView)

  const maxDepthValue = useMemo(() => String(settings.maxDepth), [settings.maxDepth])
  const maxPagesValue = useMemo(() => String(settings.maxPages), [settings.maxPages])
  const deduplicateLinks = Boolean(settings.deduplicateLinks)
  const delayMsValue = useMemo(() => String(settings.delayMs), [settings.delayMs])
  const jitterMsValue = useMemo(() => String(settings.jitterMs), [settings.jitterMs])
  const analyzeWaitMsValue = useMemo(() => String(settings.analyzeWaitMs), [settings.analyzeWaitMs])
  const pageLoadTimeoutMsValue = useMemo(() => String(settings.pageLoadTimeoutMs), [settings.pageLoadTimeoutMs])
  const userAgentValue = useMemo(() => String(settings.userAgent), [settings.userAgent])
  const acceptLanguageValue = useMemo(() => String(settings.acceptLanguage), [settings.acceptLanguage])
  const platformValue = useMemo(() => String(settings.platform), [settings.platform])
  const overrideWebdriver = Boolean(settings.overrideWebdriver)

  useEffect(() => {
    if (!isOpen) {
      return
    }
    // WebContentsView рисуется поверх DOM, поэтому временно скрываем браузерный view.
    void browserService.setVisible(false).catch(() => void 0)
    return () => {
      // Показываем браузер только если активное вью — браузер; иначе остаёмся на карте сайта / дашборде и не показываем его.
      if (currentView === 'browser') {
        void browserService.setVisible(true).catch(() => void 0)
      }
    }
  }, [isOpen, currentView])

  if (!isOpen) {
    return null
  }

  return (
    <div className="settings-crawling" role="dialog" aria-modal="true" aria-label="Настройки crawling">
      <button type="button" className="settings-crawling__backdrop" onClick={onClose} aria-label="Закрыть" />

      <div className="settings-crawling__modal">
        <div className="settings-crawling__header">
          <div className="settings-crawling__title">Настройки crawling</div>
          <button type="button" className="settings-crawling__close" onClick={onClose} aria-label="Закрыть">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div className="settings-crawling__content">
          <label className="settings-crawling__field">
            <div className="settings-crawling__label">Максимальная глубина обхода</div>
            <input
              className="settings-crawling__input"
              type="number"
              min={0}
              max={20}
              step={1}
              value={maxDepthValue}
              onChange={(e) => {
                const next = clampInt(Number(e.target.value), 0, 20)
                dispatch(setCrawlSettings({ maxDepth: next }))
              }}
            />
            <div className="settings-crawling__hint">0 = только стартовая страница, 1 = стартовая + прямые ссылки</div>
          </label>

          <label className="settings-crawling__field">
            <div className="settings-crawling__label">Лимит страниц</div>
            <input
              className="settings-crawling__input"
              type="number"
              min={1}
              max={100000}
              step={1}
              value={maxPagesValue}
              onChange={(e) => {
                const next = clampInt(Number(e.target.value), 1, 100000)
                dispatch(setCrawlSettings({ maxPages: next }))
              }}
            />
          </label>

          <label className="settings-crawling__field">
            <div className="settings-crawling__label">Уникализация ссылок</div>
            <div className="settings-crawling__checkbox-row">
              <input
                className="settings-crawling__checkbox"
                type="checkbox"
                checked={deduplicateLinks}
                onChange={(e) => {
                  dispatch(setCrawlSettings({ deduplicateLinks: Boolean(e.target.checked) }))
                }}
              />
              <div className="settings-crawling__hint">
                Если включено — ссылки на странице будут уникализированы по URL.<br/>Если выключено — сохраняем дубли.
              </div>
            </div>
          </label>

          <div className="settings-crawling__section-title">Антибот / сеть</div>

          <label className="settings-crawling__field">
            <div className="settings-crawling__label">delayMs (задержка между страницами)</div>
            <input
              className="settings-crawling__input"
              type="number"
              min={0}
              max={60000}
              step={10}
              value={delayMsValue}
              onChange={(e) => {
                const next = clampInt(Number(e.target.value), 0, 60000)
                dispatch(setCrawlSettings({ delayMs: next }))
              }}
            />
            <div className="settings-crawling__hint">
              Пауза между страницами в крауле. Для анализа страницы применяется только если `analyzeWaitMs` = 0.
            </div>
          </label>

          <label className="settings-crawling__field">
            <div className="settings-crawling__label">jitterMs (случайная добавка к delay)</div>
            <input
              className="settings-crawling__input"
              type="number"
              min={0}
              max={60000}
              step={10}
              value={jitterMsValue}
              onChange={(e) => {
                const next = clampInt(Number(e.target.value), 0, 60000)
                dispatch(setCrawlSettings({ jitterMs: next }))
              }}
            />
            <div className="settings-crawling__hint">
              Добавляется к delayMs случайным образом. Для анализа страницы применяется только если `analyzeWaitMs` = 0.
            </div>
          </label>

          <label className="settings-crawling__field">
            <div className="settings-crawling__label">analyzeWaitMs (ожидание перед извлечением)</div>
            <input
              className="settings-crawling__input"
              type="number"
              min={0}
              max={60000}
              step={10}
              value={analyzeWaitMsValue}
              onChange={(e) => {
                const next = clampInt(Number(e.target.value), 0, 60000)
                dispatch(setCrawlSettings({ analyzeWaitMs: next }))
              }}
            />
            <div className="settings-crawling__hint">
              Ожидание перед `extractPageDataFromView` при анализе страницы (например при открытии URL из карты сайта). Если &gt; 0 — используется вместо `delayMs/jitterMs` именно для анализа. Не влияет на скорость обхода очереди краула.
            </div>
          </label>

          <label className="settings-crawling__field">
            <div className="settings-crawling__label">pageLoadTimeoutMs (таймаут загрузки)</div>
            <input
              className="settings-crawling__input"
              type="number"
              min={1000}
              max={300000}
              step={500}
              value={pageLoadTimeoutMsValue}
              onChange={(e) => {
                const next = clampInt(Number(e.target.value), 1000, 300000)
                dispatch(setCrawlSettings({ pageLoadTimeoutMs: next }))
              }}
            />
            <div className="settings-crawling__hint">
              Максимальное время ожидания загрузки страницы. При превышении загрузка прерывается и страница считается ошибочной.
            </div>
          </label>

          <label className="settings-crawling__field">
            <div className="settings-crawling__label">User-Agent (для краула)</div>
            <input
              className="settings-crawling__input"
              type="text"
              value={userAgentValue}
              onChange={(e) => {
                dispatch(setCrawlSettings({ userAgent: String(e.target.value || '') }))
              }}
              placeholder="Пусто = не трогаем"
            />
          </label>

          <label className="settings-crawling__field">
            <div className="settings-crawling__label">Accept-Language</div>
            <input
              className="settings-crawling__input"
              type="text"
              value={acceptLanguageValue}
              onChange={(e) => {
                dispatch(setCrawlSettings({ acceptLanguage: String(e.target.value || '') }))
              }}
              placeholder="Напр.: ru-RU,ru;q=0.9,en;q=0.8"
            />
          </label>

          <label className="settings-crawling__field">
            <div className="settings-crawling__label">navigator.platform</div>
            <input
              className="settings-crawling__input"
              type="text"
              value={platformValue}
              onChange={(e) => {
                dispatch(setCrawlSettings({ platform: String(e.target.value || '') }))
              }}
              placeholder="Напр.: Win32"
            />
          </label>

          <label className="settings-crawling__field">
            <div className="settings-crawling__label">Скрывать navigator.webdriver</div>
            <div className="settings-crawling__checkbox-row">
              <input
                className="settings-crawling__checkbox"
                type="checkbox"
                checked={overrideWebdriver}
                onChange={(e) => {
                  dispatch(setCrawlSettings({ overrideWebdriver: Boolean(e.target.checked) }))
                }}
              />
              <div className="settings-crawling__hint">
                Делается через JS-override в странице. Не гарантирует обход антибота.
              </div>
            </div>
          </label>
        </div>

        <div className="settings-crawling__footer">
          <button type="button" className="settings-crawling__button" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  )
}

