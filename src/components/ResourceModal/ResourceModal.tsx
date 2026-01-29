import { useEffect } from 'react'
import { browserService } from '../../services/BrowserService'
import './ResourceModal.scss'

type Props = {
  isOpen: boolean
  type: 'js' | 'css'
  url: string
  onClose: () => void
}

export function ResourceModal({ isOpen, type, url, onClose }: Props) {
  useEffect(() => {
    if (!isOpen) {
      return
    }
    void browserService.setVisible(false).catch(() => void 0)
    return () => {
      void browserService.setVisible(true).catch(() => void 0)
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const title = type === 'js' ? 'JavaScript ресурс' : 'CSS ресурс'

  return (
    <div className="resource-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="resource-modal__backdrop" onClick={onClose} aria-label="Закрыть" />

      <div className="resource-modal__modal">
        <div className="resource-modal__header">
          <div className="resource-modal__title">{title}</div>
          <button type="button" className="resource-modal__close" onClick={onClose} aria-label="Закрыть">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div className="resource-modal__content">
          <div className="resource-modal__url-label">URL</div>
          <div className="resource-modal__url">{url || '—'}</div>
        </div>

        <div className="resource-modal__footer">
          <button
            type="button"
            className="resource-modal__button resource-modal__button--secondary"
            onClick={() => {
              onClose()
            }}
          >
            Закрыть
          </button>
          <button
            type="button"
            className="resource-modal__button"
            onClick={() => {
              if (url) {
                void browserService.navigate(url).catch(() => void 0)
              }
              onClose()
            }}
          >
            Открыть в браузере
          </button>
        </div>
      </div>
    </div>
  )
}

