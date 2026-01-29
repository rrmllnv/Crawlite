import { useEffect, useMemo, useState } from 'react'
import { browserService } from '../../services/BrowserService'
import './ImageModal.scss'

type Props = {
  isOpen: boolean
  url: string
  onClose: () => void
}

export function ImageModal({ isOpen, url, onClose }: Props) {
  const [meta, setMeta] = useState<{ width: number | null; height: number | null; sizeBytes: number | null }>({
    width: null,
    height: null,
    sizeBytes: null,
  })

  useEffect(() => {
    if (!isOpen) {
      return
    }
    void browserService.setVisible(false).catch(() => void 0)
    return () => {
      void browserService.setVisible(true).catch(() => void 0)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    setMeta({ width: null, height: null, sizeBytes: null })
    const target = String(url || '').trim()
    if (!target) {
      return
    }

    // размеры (w/h) — через загрузку изображения в renderer
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      setMeta((prev) => ({ ...prev, width: img.naturalWidth || null, height: img.naturalHeight || null }))
    }
    img.onerror = () => {
      setMeta((prev) => ({ ...prev, width: null, height: null }))
    }
    img.src = target

    // размер в байтах — через main (HEAD content-length)
    void window.electronAPI
      .resourceHead(target)
      .then((res) => {
        if (res?.success) {
          const cl = (res as any).contentLength
          setMeta((prev) => ({ ...prev, sizeBytes: typeof cl === 'number' && Number.isFinite(cl) ? Math.trunc(cl) : null }))
        }
      })
      .catch(() => void 0)
  }, [isOpen, url])

  const sizeKbText = useMemo(() => {
    if (typeof meta.sizeBytes !== 'number' || !Number.isFinite(meta.sizeBytes)) {
      return '—'
    }
    return `${(meta.sizeBytes / 1024).toFixed(2)} KB`
  }, [meta.sizeBytes])

  const dimensionsText = useMemo(() => {
    if (typeof meta.width !== 'number' || typeof meta.height !== 'number' || !Number.isFinite(meta.width) || !Number.isFinite(meta.height)) {
      return '—'
    }
    return `${meta.width} × ${meta.height}`
  }, [meta.width, meta.height])

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
          <div className="image-modal__meta">
            <div className="image-modal__meta-row">
              <div className="image-modal__meta-key">Размер</div>
              <div className="image-modal__meta-val">{sizeKbText}</div>
            </div>
            <div className="image-modal__meta-row">
              <div className="image-modal__meta-key">Размеры</div>
              <div className="image-modal__meta-val">{dimensionsText}</div>
            </div>
          </div>
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

