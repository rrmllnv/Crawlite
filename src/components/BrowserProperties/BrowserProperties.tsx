import type { CrawlPageData } from '../../electron'
import type { CrawlErrorItem } from '../../store/slices/crawlSlice'
import { browserService } from '../../services/BrowserService'
import { Separate } from '../Separate/Separate'
import './BrowserProperties.scss'

export type TabId = 'meta' | 'links' | 'images' | 'resources' | 'errors'

type LinkDetailed = { url: string; anchor: string }

type ResourceHeadInfo = { sizeBytes: number | null; elapsedMs: number | null }

export type BrowserPropertiesSummary = {
  totalHeadings: number
  headingsText: CrawlPageData['headingsText']
  headings: CrawlPageData['headingsCount']
}

function formatSizeKB(valueBytes: number | null) {
  if (typeof valueBytes !== 'number' || !Number.isFinite(valueBytes)) {
    return '—'
  }
  const kb = valueBytes / 1024
  return `${kb.toFixed(2)} KB`
}

function formatResourceInfo(info: ResourceHeadInfo | undefined) {
  if (!info) return ''
  const parts: string[] = []
  if (typeof info.sizeBytes === 'number' && Number.isFinite(info.sizeBytes)) {
    parts.push(`${(info.sizeBytes / 1024).toFixed(2)} KB`)
  }
  if (typeof info.elapsedMs === 'number' && Number.isFinite(info.elapsedMs)) {
    if (info.elapsedMs < 1000) parts.push(`${Math.max(0, Math.round(info.elapsedMs))} ms`)
    else parts.push(`${(info.elapsedMs / 1000).toFixed(2)} s`)
  }
  return parts.join(' · ')
}

function formatSeconds(valueMs: number | null) {
  if (typeof valueMs !== 'number' || !Number.isFinite(valueMs)) {
    return '—'
  }
  const sec = valueMs / 1000
  return `${sec.toFixed(2)} s`
}

function normalizeContactValue(value: string) {
  const raw = String(value || '').trim()
  const lower = raw.toLowerCase()
  if (lower.startsWith('tel:')) {
    return { label: 'Телефон', value: raw.slice(4).split('?')[0].trim() }
  }
  if (lower.startsWith('mailto:')) {
    return { label: 'Email', value: raw.slice(7).split('?')[0].trim() }
  }
  return { label: 'Контакт', value: raw }
}

export type BrowserPropertiesProps = {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  tabsCount: { links: number; images: number; resources: number; errors: number }
  selectedPage: CrawlPageData | null
  seoIssues: string[]
  summary: BrowserPropertiesSummary | null
  openHeadingLevels: Set<string>
  setOpenHeadingLevels: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  isPageLoading: boolean
  contacts: string[]
  linkGroups: { internal: LinkDetailed[]; external: LinkDetailed[] }
  anchors: string[]
  headInfoByUrl: Record<string, ResourceHeadInfo>
  errors: CrawlErrorItem[]
  onOpenLink: (url: string) => void
  onOpenImage: (url: string) => void
  onOpenResource: (type: 'js' | 'css', url: string) => void
}

export function BrowserProperties({
  activeTab,
  setActiveTab,
  tabsCount,
  selectedPage,
  seoIssues,
  summary,
  openHeadingLevels,
  setOpenHeadingLevels,
  isPageLoading,
  contacts,
  linkGroups,
  anchors,
  headInfoByUrl,
  errors,
  onOpenLink,
  onOpenImage,
  onOpenResource,
}: BrowserPropertiesProps) {
  return (
    <>
      <div className="browser-properties__tabs">
        <button
          type="button"
          className={`browser-properties__tab ${activeTab === 'meta' ? 'browser-properties__tab--active' : ''}`}
          onClick={() => setActiveTab('meta')}
        >
          Мета
        </button>
        <button
          type="button"
          className={`browser-properties__tab ${activeTab === 'links' ? 'browser-properties__tab--active' : ''}`}
          onClick={() => setActiveTab('links')}
        >
          {selectedPage && tabsCount.links > 0 ? `Ссылки ${tabsCount.links}` : 'Ссылки'}
        </button>
        <button
          type="button"
          className={`browser-properties__tab ${activeTab === 'images' ? 'browser-properties__tab--active' : ''}`}
          onClick={() => setActiveTab('images')}
        >
          {selectedPage && tabsCount.images > 0 ? `Картинки ${tabsCount.images}` : 'Картинки'}
        </button>
        <button
          type="button"
          className={`browser-properties__tab ${activeTab === 'resources' ? 'browser-properties__tab--active' : ''}`}
          onClick={() => setActiveTab('resources')}
        >
          {selectedPage && tabsCount.resources > 0 ? `Ресурсы ${tabsCount.resources}` : 'Ресурсы'}
        </button>
        <button
          type="button"
          className={`browser-properties__tab ${activeTab === 'errors' ? 'browser-properties__tab--active' : ''}`}
          onClick={() => setActiveTab('errors')}
        >
          {tabsCount.errors > 0 ? `Ошибки ${tabsCount.errors}` : 'Ошибки'}
        </button>
      </div>

      <div className="browser-properties__body">
        {!selectedPage && (
          <div className="browser-properties__empty">
            Выберите страницу слева.
          </div>
        )}

        {selectedPage && activeTab === 'meta' && (
          <div className="browser-properties__kv">
            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">Title</div>
              <div className="browser-properties__kv-val">{selectedPage.title || '—'}</div>
            </div>
            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">Description</div>
              <div className="browser-properties__kv-val">{selectedPage.description || '—'}</div>
            </div>
            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">Keywords</div>
              <div className="browser-properties__kv-val">{selectedPage.keywords || '—'}</div>
            </div>
            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">H1</div>
              <div className="browser-properties__kv-val">{selectedPage.h1 || '—'}</div>
            </div>

            <Separate title="Индексация страницы" />

            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">Rel canonical</div>
              <div className="browser-properties__kv-val">{String((selectedPage as any).canonicalUrl || '').trim() || '—'}</div>
            </div>
            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">Meta robots</div>
              <div className="browser-properties__kv-val">{String((selectedPage as any).metaRobots || '').trim() || '—'}</div>
            </div>

            {seoIssues.length > 0 && (
              <>
                <Separate title="Проверки" />
                {seoIssues.map((x) => (
                  <div key={x} className="browser-properties__list-item">
                    {x}
                  </div>
                ))}
              </>
            )}

            <Separate title="Сводка по странице" />

            <div className="browser-properties__details-block">
              <div className="browser-properties__details-summary">
                <span className="browser-properties__details-summary-title">Заголовки</span>
                <span className="browser-properties__details-summary-value">{summary ? `всего ${summary.totalHeadings}` : '—'}</span>
                <span className="browser-properties__details-summary-actions">
                  <button
                    type="button"
                    className="browser-properties__headings-control"
                    onClick={() => {
                      setOpenHeadingLevels((prev) => {
                        const isOpen = prev.size > 0
                        return isOpen ? new Set() : new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
                      })
                    }}
                    disabled={isPageLoading}
                  >
                    {openHeadingLevels.size > 0 ? 'Скрыть' : 'Раскрыть'}
                  </button>
                </span>
              </div>

              {summary && (
                <div className="browser-properties__headings">
                  {([
                    ['h1', 'H1'],
                    ['h2', 'H2'],
                    ['h3', 'H3'],
                    ['h4', 'H4'],
                    ['h5', 'H5'],
                    ['h6', 'H6'],
                  ] as const)
                    .filter(([key]) => {
                      const items = summary.headingsText[key]
                      const count = items.length || summary.headings[key]
                      return (count || 0) > 0
                    })
                    .map(([key, label]) => {
                      const items = summary.headingsText[key]
                      const count = items.length || summary.headings[key]
                      return (
                        <details
                          key={key}
                          className="browser-properties__headings-level"
                          open={openHeadingLevels.has(key)}
                          onToggle={(e) => {
                            const nextOpen = (e.currentTarget as HTMLDetailsElement).open
                            setOpenHeadingLevels((prev) => {
                              const next = new Set(prev)
                              if (nextOpen) next.add(key)
                              else next.delete(key)
                              return next
                            })
                          }}
                        >
                          <summary className="browser-properties__headings-summary">
                            <span className="browser-properties__headings-title">{label}</span>
                            <span className="browser-properties__headings-count">{count}</span>
                          </summary>
                          <div className="browser-properties__headings-list">
                            {items.length === 0 && <div className="browser-properties__headings-empty">Нет</div>}
                            {items.map((t) => (
                              <button
                                type="button"
                                key={`${key}:${t}`}
                                className="browser-properties__headings-item browser-properties__headings-item--button"
                                onClick={() => void browserService.highlightHeading(Number(key.slice(1)), t)}
                                disabled={isPageLoading}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </details>
                      )
                    })}
                </div>
              )}

              {!summary && <div className="browser-properties__empty">—</div>}
            </div>

            <Separate title="Параметры соединения" />

            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">URL</div>
              <div className="browser-properties__kv-val">{selectedPage.url}</div>
            </div>
            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">IP сайта</div>
              <div className="browser-properties__kv-val">{String((selectedPage as any).ipAddress || '').trim() || '—'}</div>
            </div>
            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">Ответ сервера</div>
              <div className="browser-properties__kv-val">{selectedPage.statusCode === null ? '—' : String(selectedPage.statusCode)}</div>
            </div>
            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">Размер (KB)</div>
              <div className="browser-properties__kv-val">{formatSizeKB(selectedPage.contentLength)}</div>
            </div>
            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">Время открытия (s)</div>
              <div className="browser-properties__kv-val">{formatSeconds(selectedPage.loadTimeMs)}</div>
            </div>
            <div className="browser-properties__kv-row">
              <div className="browser-properties__kv-key">Время анализа (s)</div>
              <div className="browser-properties__kv-val">{formatSeconds((selectedPage as any).analysisTimeMs)}</div>
            </div>

            {contacts.length > 0 && (
              <>
                <Separate title="Контакты на странице" />
                {contacts.map((x) => (
                  <div key={x} className="browser-properties__kv-row">
                    <div className="browser-properties__kv-key">{normalizeContactValue(x).label}</div>
                    <div className="browser-properties__kv-val">{normalizeContactValue(x).value}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {selectedPage && activeTab === 'links' && (
          <div className="browser-properties__list">
            {selectedPage.links.length === 0 && <div className="browser-properties__empty">Нет ссылок.</div>}

            {selectedPage.links.length > 0 && (
              <details className="browser-properties__group" open>
                <summary className="browser-properties__group-summary">
                  <span className="browser-properties__group-title">Внутренние</span>
                  <span className="browser-properties__group-count">{linkGroups.internal.length}</span>
                </summary>
                <div className="browser-properties__group-body">
                  {linkGroups.internal.length === 0 && <div className="browser-properties__empty">Нет.</div>}
                  {linkGroups.internal.map((it, idx) => (
                    <div key={`${it.url}__${idx}`} className="browser-properties__row">
                      <button
                        type="button"
                        className="browser-properties__row-main browser-properties__row-main--two-lines"
                        onClick={() => void browserService.highlightLink(it.url).catch(() => void 0)}
                        title="Подсветить в браузере"
                        disabled={isPageLoading}
                      >
                        <div className="browser-properties__row-main-text">{it.url}</div>
                        {it.anchor ? <div className="browser-properties__row-subtext">{it.anchor}</div> : null}
                      </button>
                      <div className="browser-properties__row-actions">
                        <button
                          type="button"
                          className="browser-properties__action browser-properties__action--primary"
                          onClick={() => onOpenLink(it.url)}
                          title="Открыть"
                          disabled={isPageLoading}
                        >
                          Открыть
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {selectedPage.links.length > 0 && (
              <details className="browser-properties__group">
                <summary className="browser-properties__group-summary">
                  <span className="browser-properties__group-title">Внешние</span>
                  <span className="browser-properties__group-count">{linkGroups.external.length}</span>
                </summary>
                <div className="browser-properties__group-body">
                  {linkGroups.external.length === 0 && <div className="browser-properties__empty">Нет.</div>}
                  {linkGroups.external.map((it, idx) => (
                    <div key={`${it.url}__${idx}`} className="browser-properties__row">
                      <button
                        type="button"
                        className="browser-properties__row-main browser-properties__row-main--two-lines"
                        onClick={() => void browserService.highlightLink(it.url).catch(() => void 0)}
                        title="Подсветить в браузере"
                        disabled={isPageLoading}
                      >
                        <div className="browser-properties__row-main-text">{it.url}</div>
                        {it.anchor ? <div className="browser-properties__row-subtext">{it.anchor}</div> : null}
                      </button>
                      <div className="browser-properties__row-actions">
                        <button
                          type="button"
                          className="browser-properties__action browser-properties__action--primary"
                          onClick={() => onOpenLink(it.url)}
                          title="Открыть"
                          disabled={isPageLoading}
                        >
                          Открыть
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {anchors.length > 0 && (
              <details className="browser-properties__group">
                <summary className="browser-properties__group-summary">
                  <span className="browser-properties__group-title">Якори</span>
                  <span className="browser-properties__group-count">{anchors.length}</span>
                </summary>
                <div className="browser-properties__group-body">
                  {anchors.map((anchor, idx) => (
                    <div key={`${anchor}__${idx}`} className="browser-properties__row">
                      <div className="browser-properties__row-main">
                        <div className="browser-properties__row-main-text">{anchor}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {selectedPage && activeTab === 'images' && (
          <div className="browser-properties__list">
            {selectedPage.images.length === 0 && <div className="browser-properties__empty">Нет картинок.</div>}
            {selectedPage.images.map((x) => (
              <div key={x} className="browser-properties__row">
                <button
                  type="button"
                  className="browser-properties__row-main browser-properties__row-main--with-thumb"
                  onClick={() => void browserService.highlightImage(x).catch(() => void 0)}
                  title="Подсветить в браузере"
                  disabled={isPageLoading}
                >
                  <img className="browser-properties__thumb" src={x} alt="" loading="lazy" />
                  <div className="browser-properties__row-main-two">
                    <div className="browser-properties__row-main-text">{x}</div>
                    {formatResourceInfo(headInfoByUrl[x]) ? <div className="browser-properties__row-subtext">{formatResourceInfo(headInfoByUrl[x])}</div> : null}
                  </div>
                </button>
                <div className="browser-properties__row-actions">
                  <button
                    type="button"
                    className="browser-properties__action browser-properties__action--primary"
                    onClick={() => onOpenImage(x)}
                    title="Открыть"
                    disabled={isPageLoading}
                  >
                    Открыть
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedPage && activeTab === 'resources' && (
          <div className="browser-properties__list">
            <details className="browser-properties__group" open>
              <summary className="browser-properties__group-summary">
                <span className="browser-properties__group-title">JS</span>
                <span className="browser-properties__group-count">{selectedPage.scripts.length}</span>
              </summary>
              <div className="browser-properties__group-body">
                {selectedPage.scripts.length === 0 && <div className="browser-properties__empty">Нет.</div>}
                {selectedPage.scripts.map((x) => (
                  <button
                    type="button"
                    key={x}
                    className="browser-properties__list-item browser-properties__list-item--button browser-properties__list-item--with-meta"
                    onClick={() => onOpenResource('js', x)}
                    disabled={isPageLoading}
                  >
                    <div className="browser-properties__list-item-title">{x}</div>
                    {formatResourceInfo(headInfoByUrl[x]) ? <div className="browser-properties__list-item-meta">{formatResourceInfo(headInfoByUrl[x])}</div> : null}
                  </button>
                ))}
              </div>
            </details>

            <details className="browser-properties__group">
              <summary className="browser-properties__group-summary">
                <span className="browser-properties__group-title">CSS</span>
                <span className="browser-properties__group-count">{selectedPage.stylesheets.length}</span>
              </summary>
              <div className="browser-properties__group-body">
                {selectedPage.stylesheets.length === 0 && <div className="browser-properties__empty">Нет.</div>}
                {selectedPage.stylesheets.map((x) => (
                  <button
                    type="button"
                    key={x}
                    className="browser-properties__list-item browser-properties__list-item--button browser-properties__list-item--with-meta"
                    onClick={() => onOpenResource('css', x)}
                    disabled={isPageLoading}
                  >
                    <div className="browser-properties__list-item-title">{x}</div>
                    {formatResourceInfo(headInfoByUrl[x]) ? <div className="browser-properties__list-item-meta">{formatResourceInfo(headInfoByUrl[x])}</div> : null}
                  </button>
                ))}
              </div>
            </details>

            <details className="browser-properties__group">
              <summary className="browser-properties__group-summary">
                <span className="browser-properties__group-title">Разное</span>
                <span className="browser-properties__group-count">{tabsCount.resources - selectedPage.scripts.length - selectedPage.stylesheets.length}</span>
              </summary>
              <div className="browser-properties__group-body">
                {(() => {
                  const miscList = Array.isArray(selectedPage.misc) ? selectedPage.misc : []
                  const seen = new Set<string>([...selectedPage.links, ...selectedPage.images, ...selectedPage.scripts, ...selectedPage.stylesheets].map((x) => String(x)))
                  const list = miscList
                    .filter((x) => x && !seen.has(String(x)))
                    .filter((x) => !/^#/.test(String(x).trim()))
                  if (list.length === 0) {
                    return <div className="browser-properties__empty">Нет.</div>
                  }
                  return list.map((x) => (
                    <div key={x} className="browser-properties__list-item">
                      <div className="browser-properties__list-item-title">{x}</div>
                      {formatResourceInfo(headInfoByUrl[x]) ? <div className="browser-properties__list-item-meta">{formatResourceInfo(headInfoByUrl[x])}</div> : null}
                    </div>
                  ))
                })()}
              </div>
            </details>
          </div>
        )}

        {activeTab === 'errors' && (
          <div className="browser-properties__list">
            {errors.length === 0 && <div className="browser-properties__empty">Нет ошибок.</div>}
            {errors.map((e, idx) => (
              <div key={`${e.url}:${e.at}:${idx}`} className="browser-properties__row">
                <button
                  type="button"
                  className="browser-properties__row-main"
                  onClick={() => void browserService.highlightLink(e.url).catch(() => void 0)}
                  title="Подсветить в браузере"
                  disabled={isPageLoading}
                >
                  {e.url}
                </button>
                <div className="browser-properties__row-actions">
                  <button
                    type="button"
                    className="browser-properties__action browser-properties__action--primary"
                    onClick={() => onOpenLink(e.url)}
                    title="Открыть"
                    disabled={isPageLoading}
                  >
                    Открыть
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
