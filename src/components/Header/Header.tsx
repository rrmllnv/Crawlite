import { useMemo, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setError, setLoading } from '../../store/slices/appSlice'
import { resetCrawl, setCrawlStatus, setRunId, setStartUrl } from '../../store/slices/crawlSlice'
import { crawlService } from '../../services/CrawlService'
import './Header.scss'

function normalizeInputUrl(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) {
    return ''
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return `https://${trimmed}`
}

export function Header() {
  const dispatch = useAppDispatch()
  const crawlStatus = useAppSelector((s) => s.crawl.status)
  const runId = useAppSelector((s) => s.crawl.runId)
  const processed = useAppSelector((s) => s.crawl.processed)
  const queued = useAppSelector((s) => s.crawl.queued)

  const [urlInput, setUrlInput] = useState('')

  const isRunning = crawlStatus === 'running'

  const canStart = useMemo(() => {
    const normalized = normalizeInputUrl(urlInput)
    return Boolean(normalized) && !isRunning
  }, [urlInput, isRunning])

  const handleStart = async () => {
    const startUrl = normalizeInputUrl(urlInput)
    if (!startUrl || isRunning) {
      return
    }

    dispatch(setError(null))
    dispatch(setLoading(true))
    dispatch(resetCrawl())
    dispatch(setStartUrl(startUrl))
    dispatch(setCrawlStatus('running'))

    try {
      const res = await crawlService.start({
        startUrl,
        options: {
          maxPages: 200,
          delayMs: 650,
          jitterMs: 350,
        },
      })
      if (!res.success) {
        dispatch(setCrawlStatus('error'))
        dispatch(setError(res.error || 'Crawl start failed'))
        return
      }
      dispatch(setRunId(typeof (res as any).runId === 'string' ? (res as any).runId : null))
    } catch (error) {
      dispatch(setCrawlStatus('error'))
      dispatch(setError(String(error)))
    } finally {
      dispatch(setLoading(false))
    }
  }

  const handleCancel = async () => {
    if (!runId) {
      return
    }
    try {
      await crawlService.cancel(runId)
    } catch {
      void 0
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleStart()
    }
  }

  return (
    <header className="app__header">
      <div className="header__brand">
        <div className="header__title">Crawlite</div>
        <div className="header__subtitle">Crawling / Scraping</div>
      </div>

      <div className="header__toolbar">
        <input
          type="text"
          className="header__url-input"
          placeholder="Введите URL (например: example.com)"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <button className={`header__button ${canStart ? '' : 'header__button--disabled'}`} onClick={handleStart} disabled={!canStart}>
          Запустить
        </button>

        <button className={`header__button header__button--secondary ${isRunning && runId ? '' : 'header__button--disabled'}`} onClick={handleCancel} disabled={!isRunning || !runId}>
          Стоп
        </button>

        <div className="header__progress" title="Прогресс crawling">
          <span className="header__progress-label">Обработано:</span>
          <span className="header__progress-value">{processed}</span>
          <span className="header__progress-sep">/</span>
          <span className="header__progress-label">В очереди:</span>
          <span className="header__progress-value">{queued}</span>
        </div>
      </div>
    </header>
  )
}

