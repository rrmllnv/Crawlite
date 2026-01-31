import { useEffect, useMemo, useState } from 'react'
import './BrowserInspector.scss'

export type BrowserInspectorProps = {
  /** Управление раскрытием снаружи (например, при нажатии кнопки «Инспектор (наведение)»). */
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

type InspectorElementPayload = {
  requestId?: string
  tag?: string
  id?: string
  className?: string
  rect?: { left: number; top: number; right: number; bottom: number; width: number; height: number }
  attributes?: Record<string, string>
  styles?: Record<string, string>
  children?: {
    directCount?: number
    directTagCounts?: Record<string, number>
    descendantsCount?: number
    directTextNodes?: number
  }
  text?: string
}

export function BrowserInspector({ isOpen: controlledOpen, onOpenChange }: BrowserInspectorProps = {}) {
  const [internalOpen, setInternalOpen] = useState(true)
  const isControlled = controlledOpen !== undefined && onOpenChange !== undefined
  const isOpen = isControlled ? controlledOpen : internalOpen
  const setIsOpen = isControlled ? onOpenChange : setInternalOpen
  const [selected, setSelected] = useState<InspectorElementPayload | null>(null)

  useEffect(() => {
    if (!window.electronAPI?.onBrowserEvent) return
    const unsub = window.electronAPI.onBrowserEvent((evt: any) => {
      try {
        if (!evt || typeof evt !== 'object') return
        if (evt.type !== 'inspector:element') return
        const el = (evt as any).element as InspectorElementPayload | null
        if (!el || typeof el !== 'object') return
        setSelected(el)
        if (onOpenChange) onOpenChange(true)
      } catch {
        void 0
      }
    })
    return () => {
      try {
        unsub()
      } catch {
        void 0
      }
    }
  }, [onOpenChange])

  const attrsList = useMemo(() => {
    const attrs = selected?.attributes || null
    if (!attrs || typeof attrs !== 'object') return []
    return Object.keys(attrs)
      .sort()
      .map((k) => ({ name: k, value: String((attrs as any)[k] ?? '') }))
  }, [selected])

  const stylesList = useMemo(() => {
    const st = selected?.styles || null
    if (!st || typeof st !== 'object') return []
    return Object.keys(st)
      .sort()
      .map((k) => ({ name: k, value: String((st as any)[k] ?? '') }))
  }, [selected])

  return (
    <div className="browser-inspector">
      <button
        type="button"
        className="browser-inspector__header"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls="browser-inspector-content"
      >
        <span className="browser-inspector__title">Инспектор</span>
        <i
          className={`fa-solid fa-chevron-${isOpen ? 'down' : 'left'} browser-inspector__chevron`}
          aria-hidden="true"
        />
      </button>
      {isOpen && (
        <div id="browser-inspector-content" className="browser-inspector__content">
          {!selected && <div className="browser-inspector__empty">Кликните по элементу в браузере.</div>}

          {selected && (
            <div className="browser-inspector__section">
              <div className="browser-inspector__section-title">Элемент</div>
              <div className="browser-inspector__kv">
                <div className="browser-inspector__kv-row">
                  <div className="browser-inspector__kv-key">Tag</div>
                  <div className="browser-inspector__kv-val">{selected.tag ? `<${selected.tag}>` : '—'}</div>
                </div>
                <div className="browser-inspector__kv-row">
                  <div className="browser-inspector__kv-key">ID</div>
                  <div className="browser-inspector__kv-val">{selected.id ? `#${selected.id}` : '—'}</div>
                </div>
                <div className="browser-inspector__kv-row">
                  <div className="browser-inspector__kv-key">Class</div>
                  <div className="browser-inspector__kv-val">{selected.className ? String(selected.className) : '—'}</div>
                </div>
                <div className="browser-inspector__kv-row">
                  <div className="browser-inspector__kv-key">Размер</div>
                  <div className="browser-inspector__kv-val">
                    {selected.rect ? `${Math.round(selected.rect.width)} × ${Math.round(selected.rect.height)}` : '—'}
                  </div>
                </div>
                <div className="browser-inspector__kv-row">
                  <div className="browser-inspector__kv-key">Позиция</div>
                  <div className="browser-inspector__kv-val">
                    {selected.rect ? `${Math.round(selected.rect.left)}, ${Math.round(selected.rect.top)}` : '—'}
                  </div>
                </div>
                <div className="browser-inspector__kv-row">
                  <div className="browser-inspector__kv-key">Текст</div>
                  <div className="browser-inspector__kv-val">{selected.text ? String(selected.text) : '—'}</div>
                </div>
              </div>
            </div>
          )}

          {selected && (
            <div className="browser-inspector__section">
              <div className="browser-inspector__section-title">Атрибуты</div>
              {attrsList.length === 0 && <div className="browser-inspector__empty">—</div>}
              {attrsList.length > 0 && (
                <div className="browser-inspector__list">
                  {attrsList.map((a) => (
                    <div key={a.name} className="browser-inspector__list-row">
                      <div className="browser-inspector__list-key">{a.name}</div>
                      <div className="browser-inspector__list-val">{a.value || '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selected && (
            <div className="browser-inspector__section">
              <div className="browser-inspector__section-title">Стили (computed)</div>
              {stylesList.length === 0 && <div className="browser-inspector__empty">—</div>}
              {stylesList.length > 0 && (
                <div className="browser-inspector__list browser-inspector__list--styles">
                  {stylesList.map((s) => (
                    <div key={s.name} className="browser-inspector__list-row">
                      <div className="browser-inspector__list-key">{s.name}</div>
                      <div className="browser-inspector__list-val">{s.value || '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selected && (
            <div className="browser-inspector__section">
              <div className="browser-inspector__section-title">Дочерние элементы (сводка)</div>
              <div className="browser-inspector__kv">
                <div className="browser-inspector__kv-row">
                  <div className="browser-inspector__kv-key">Прямые дети</div>
                  <div className="browser-inspector__kv-val">
                    {typeof selected.children?.directCount === 'number' ? String(selected.children.directCount) : '—'}
                  </div>
                </div>
                <div className="browser-inspector__kv-row">
                  <div className="browser-inspector__kv-key">Всего потомков</div>
                  <div className="browser-inspector__kv-val">
                    {typeof selected.children?.descendantsCount === 'number' ? String(selected.children.descendantsCount) : '—'}
                  </div>
                </div>
                <div className="browser-inspector__kv-row">
                  <div className="browser-inspector__kv-key">Прямые текст-ноды</div>
                  <div className="browser-inspector__kv-val">
                    {typeof selected.children?.directTextNodes === 'number' ? String(selected.children.directTextNodes) : '—'}
                  </div>
                </div>
              </div>

              {selected.children?.directTagCounts && Object.keys(selected.children.directTagCounts).length > 0 && (
                <div className="browser-inspector__tags">
                  {Object.keys(selected.children.directTagCounts)
                    .sort()
                    .map((tag) => (
                      <div key={tag} className="browser-inspector__tag">
                        <span className="browser-inspector__tag-name">{tag}</span>
                        <span className="browser-inspector__tag-count">{String((selected.children!.directTagCounts as any)[tag])}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
