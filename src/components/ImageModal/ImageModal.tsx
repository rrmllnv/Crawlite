import { useEffect } from 'react'
import { browserService } from '../../services/BrowserService'
import './ImageModal.scss'

type Props = {
  isOpen: boolean
  url: string
  onClose: () => void
}

export function ImageModal({ isOpen, url, onClose }: Props) {
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

  return (
    <div className="image-modal" role="dialog" aria-modal="true" aria-label="Просмотр изображения">
      <button type="button" className="image-modal__backdrop" onClick={onClose} aria-label="Закрыть" />

      <div className="image-modal__modal">
        <div className="image-modal__header">
          <div className="image-modal__title">Изображение</div>
          <button type="button" className="image-modal__close" onClick={onClose} aria-label="Закрыть">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div className="image-modal__content">
          <div className="image-modal__preview">
            {url ? <img className="image-modal__img" src={url} alt="" /> : <div className="image-modal__empty">—</div>}
          </div>
          <div className="image-modal__url">{url || '—'}</div>
        </div>

        <div className="image-modal__footer">
          <button
            type="button"
            className="image-modal__button image-modal__button--secondary"
            onClick={() => {
              if (url) {
                void window.electronAPI.downloadFile(url).catch(() => void 0)
              }
            }}
            disabled={!url}
          >
            Скачать
          </button>
          <button
            type="button"
            className="image-modal__button"
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

