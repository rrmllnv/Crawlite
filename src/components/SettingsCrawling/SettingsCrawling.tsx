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

  const maxDepthValue = useMemo(() => String(settings.maxDepth), [settings.maxDepth])
  const maxPagesValue = useMemo(() => String(settings.maxPages), [settings.maxPages])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    // `WebContentsView` рисуется поверх DOM, поэтому временно скрываем браузерный view.
    void browserService.setVisible(false).catch(() => void 0)
    return () => {
      void browserService.setVisible(true).catch(() => void 0)
    }
  }, [isOpen])

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

