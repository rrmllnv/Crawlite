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
  stylesUser?: Record<string, string>
  stylesNonDefault?: Record<string, string>
  stylesUserRules?: Array<{
    selector?: string
    source?: string
    media?: string
    truncated?: boolean
    declarations?: Record<string, string>
  }>
  children?: {
    directCount?: number
    directTagCounts?: Record<string, number>
    descendantsCount?: number
    directTextNodes?: number
  }
  text?: string
}

type StyleEntry =
  | { kind: 'prop'; prop: { name: string; value: string } }
  | { kind: 'group'; group: string; items: { name: string; value: string }[] }

function buildStyleGroupEntries(items: { name: string; value: string }[]): StyleEntry[] {
  const groups = new Map<string, { items: { name: string; value: string }[]; firstIndex: number }>()

  const getGroupKey = (propName: string) => {
    const raw = String(propName || '')
    const noLead = raw.replace(/^-+/, '')
    const dashIdx = noLead.indexOf('-')
    if (dashIdx <= 0) return null
    const group = noLead.slice(0, dashIdx).trim()
    return group ? group : null
  }

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]
    const g = getGroupKey(it.name)
    if (!g) continue
    const existing = groups.get(g)
    if (!existing) {
      groups.set(g, { items: [it], firstIndex: i })
    } else {
      existing.items.push(it)
    }
  }

  const emitted = new Set<string>()
  const entries: StyleEntry[] = []

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]
    const g = getGroupKey(it.name)
    if (!g) {
      entries.push({ kind: 'prop', prop: it })
      continue
    }
    const meta = groups.get(g)
    if (!meta) {
      entries.push({ kind: 'prop', prop: it })
      continue
    }
    if (meta.firstIndex === i && !emitted.has(g)) {
      if (meta.items.length < 2) {
        entries.push({ kind: 'prop', prop: it })
      } else {
        emitted.add(g)
        entries.push({ kind: 'group', group: g, items: meta.items })
      }
    }
  }

  return entries
}

export function BrowserInspector({ isOpen: controlledOpen, onOpenChange }: BrowserInspectorProps = {}) {
  const [internalOpen, setInternalOpen] = useState(true)
  const isControlled = controlledOpen !== undefined && onOpenChange !== undefined
  const isOpen = isControlled ? controlledOpen : internalOpen
  const setIsOpen = isControlled ? onOpenChange : setInternalOpen
  const [selected, setSelected] = useState<InspectorElementPayload | null>(null)
  const [openStyleGroups, setOpenStyleGroups] = useState<Set<string>>(() => new Set())
  const [openUserStyleGroups, setOpenUserStyleGroups] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!window.electronAPI?.onBrowserEvent) return
    const unsub = window.electronAPI.onBrowserEvent((evt: any) => {
      try {
        if (!evt || typeof evt !== 'object') return
        if (evt.type !== 'inspector:element') return
        const el = (evt as any).element as InspectorElementPayload | null
        if (!el || typeof el !== 'object') return
        setSelected(el)
        setOpenStyleGroups(new Set())
        setOpenUserStyleGroups(new Set())
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

  const stylesUserList = useMemo(() => {
    const st = selected?.stylesUser || null
    if (!st || typeof st !== 'object') return []
    return Object.keys(st)
      .sort()
      .map((k) => ({ name: k, value: String((st as any)[k] ?? '') }))
  }, [selected])

  const stylesUserRulesList = useMemo(() => {
    const rules = selected?.stylesUserRules
    if (!Array.isArray(rules)) return []
    return rules
      .map((r) => {
        const decl = r && r.declarations && typeof r.declarations === 'object' ? r.declarations : null
        const declList = decl
          ? Object.keys(decl)
              .sort()
              .map((k) => ({ name: k, value: String((decl as any)[k] ?? '') }))
          : []
        return {
          selector: String((r as any).selector || '').trim() || '—',
          source: String((r as any).source || '').trim(),
          media: String((r as any).media || '').trim(),
          truncated: Boolean((r as any).truncated),
          declarations: declList,
        }
      })
      .filter((x) => x.declarations.length > 0)
  }, [selected])

  const stylesGrouped = useMemo(() => ({ entries: buildStyleGroupEntries(stylesList) }), [stylesList])

  const stylesUserGrouped = useMemo(() => ({ entries: buildStyleGroupEntries(stylesUserList) }), [stylesUserList])

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
          className={`fa-solid fa-chevron-${isOpen ? 'down' : 'right'} browser-inspector__chevron`}
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

          {selected && (
            <div className="browser-inspector__section">
              <div className="browser-inspector__section-title">Стили (user)</div>
              {stylesUserRulesList.length === 0 && stylesUserList.length === 0 && <div className="browser-inspector__empty">—</div>}

              {stylesUserRulesList.length > 0 && (
                <div className="browser-inspector__list">
                  {stylesUserRulesList.map((r, ruleIdx) => {
                    const ruleEntries = buildStyleGroupEntries(r.declarations)
                    const fileName = r.source ? r.source.replace(/^.*[/\\]/, '') : ''
                    return (
                      <div key={`${r.selector}:${ruleIdx}`} className="browser-inspector__style-group">
                        <div className="browser-inspector__list-row browser-inspector__rule-header">
                          <div className="browser-inspector__rule-header-selector">{r.selector}</div>
                          <div className="browser-inspector__rule-header-file">
                            {fileName || '—'}
                            {r.media ? ` @media ${r.media}` : ''}
                            {r.truncated ? ' (truncated)' : ''}
                          </div>
                        </div>
                        <div className="browser-inspector__style-group-items">
                          {ruleEntries.map((e) => {
                            if (e.kind === 'prop') {
                              const s = e.prop
                              return (
                                <div key={s.name} className="browser-inspector__list-row">
                                  <div className="browser-inspector__list-key">{s.name}</div>
                                  <div className="browser-inspector__list-val">{s.value || '—'}</div>
                                </div>
                              )
                            }
                            const groupKey = `rule:${ruleIdx}:${e.group}`
                            const opened = openUserStyleGroups.has(groupKey)
                            return (
                              <div key={`group:${groupKey}`} className="browser-inspector__style-group">
                                <button
                                  type="button"
                                  className="browser-inspector__list-row browser-inspector__list-row--button browser-inspector__style-group-row"
                                  onClick={() => {
                                    setOpenUserStyleGroups((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(groupKey)) next.delete(groupKey)
                                      else next.add(groupKey)
                                      return next
                                    })
                                  }}
                                  aria-expanded={opened}
                                >
                                  <div className="browser-inspector__list-key">
                                    <i className={`fa-solid fa-chevron-${opened ? 'down' : 'right'} browser-inspector__style-group-chevron`} aria-hidden="true" />
                                    <span className="browser-inspector__style-group-title">{e.group}</span>
                                  </div>
                                  <div className="browser-inspector__list-val">({e.items.length})</div>
                                </button>
                                {opened && (
                                  <div className="browser-inspector__style-group-items">
                                    {e.items.map((s) => (
                                      <div key={s.name} className="browser-inspector__list-row">
                                        <div className="browser-inspector__list-key">{s.name}</div>
                                        <div className="browser-inspector__list-val">{s.value || '—'}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {stylesUserRulesList.length === 0 && stylesUserList.length > 0 && (
                <div className="browser-inspector__list">
                  {stylesUserGrouped.entries.map((e) => {
                    if (e.kind === 'prop') {
                      const s = e.prop
                      return (
                        <div key={s.name} className="browser-inspector__list-row">
                          <div className="browser-inspector__list-key">{s.name}</div>
                          <div className="browser-inspector__list-val">{s.value || '—'}</div>
                        </div>
                      )
                    }
                    const groupKey = `flat:${e.group}`
                    const opened = openUserStyleGroups.has(groupKey)
                    return (
                      <div key={`group:${e.group}`} className="browser-inspector__style-group">
                        <button
                          type="button"
                          className="browser-inspector__list-row browser-inspector__list-row--button browser-inspector__style-group-row"
                          onClick={() => {
                            setOpenUserStyleGroups((prev) => {
                              const next = new Set(prev)
                              if (next.has(groupKey)) next.delete(groupKey)
                              else next.add(groupKey)
                              return next
                            })
                          }}
                          aria-expanded={opened}
                        >
                          <div className="browser-inspector__list-key">
                            <i className={`fa-solid fa-chevron-${opened ? 'down' : 'right'} browser-inspector__style-group-chevron`} aria-hidden="true" />
                            <span className="browser-inspector__style-group-title">{e.group}</span>
                          </div>
                          <div className="browser-inspector__list-val">({e.items.length})</div>
                        </button>
                        {opened && (
                          <div className="browser-inspector__style-group-items">
                            {e.items.map((s) => (
                              <div key={s.name} className="browser-inspector__list-row">
                                <div className="browser-inspector__list-key">{s.name}</div>
                                <div className="browser-inspector__list-val">{s.value || '—'}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {selected && (
            <div className="browser-inspector__section">
              <div className="browser-inspector__section-title">Стили (computed)</div>
              {stylesList.length === 0 && <div className="browser-inspector__empty">—</div>}
              {stylesList.length > 0 && (
                <div className="browser-inspector__list ">
                  {stylesGrouped.entries.map((e) => {
                    if (e.kind === 'prop') {
                      const s = e.prop
                      return (
                        <div key={s.name} className="browser-inspector__list-row">
                          <div className="browser-inspector__list-key">{s.name}</div>
                          <div className="browser-inspector__list-val">{s.value || '—'}</div>
                        </div>
                      )
                    }
                    const opened = openStyleGroups.has(e.group)
                    return (
                      <div key={`group:${e.group}`} className="browser-inspector__style-group">
                        <button
                          type="button"
                          className="browser-inspector__list-row browser-inspector__list-row--button browser-inspector__style-group-row"
                          onClick={() => {
                            setOpenStyleGroups((prev) => {
                              const next = new Set(prev)
                              if (next.has(e.group)) next.delete(e.group)
                              else next.add(e.group)
                              return next
                            })
                          }}
                          aria-expanded={opened}
                        >
                          <div className="browser-inspector__list-key">
                            <i className={`fa-solid fa-chevron-${opened ? 'down' : 'right'} browser-inspector__style-group-chevron`} aria-hidden="true" />
                            <span className="browser-inspector__style-group-title">{e.group}</span>
                          </div>
                          <div className="browser-inspector__list-val">({e.items.length})</div>
                        </button>
                        {opened && (
                          <div className="browser-inspector__style-group-items">
                            {e.items.map((s) => (
                              <div key={s.name} className="browser-inspector__list-row">
                                <div className="browser-inspector__list-key">{s.name}</div>
                                <div className="browser-inspector__list-val">{s.value || '—'}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

         
        </div>
      )}
    </div>
  )
}
