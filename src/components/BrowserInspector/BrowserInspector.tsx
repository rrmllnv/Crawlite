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
    overridden?: Record<string, boolean>
    pseudoClasses?: string[]
    specificity?: [number, number, number]
    order?: number
  }>
  stylesUserRulesBefore?: Array<{
    selector?: string
    source?: string
    media?: string
    truncated?: boolean
    declarations?: Record<string, string>
    overridden?: Record<string, boolean>
    pseudoClasses?: string[]
    specificity?: [number, number, number]
    order?: number
  }>
  stylesUserRulesAfter?: Array<{
    selector?: string
    source?: string
    media?: string
    truncated?: boolean
    declarations?: Record<string, string>
    overridden?: Record<string, boolean>
    pseudoClasses?: string[]
    specificity?: [number, number, number]
    order?: number
  }>
  children?: {
    directCount?: number
    directTagCounts?: Record<string, number>
    descendantsCount?: number
    directTextNodes?: number
  }
  text?: string
}

type StyleItem = { name: string; value: string }

type StyleEntry<T extends StyleItem = StyleItem> =
  | { kind: 'prop'; prop: T }
  | { kind: 'group'; group: string; items: T[] }

function buildStyleGroupEntries<T extends StyleItem>(items: T[]): StyleEntry<T>[] {
  const groups = new Map<string, { items: T[]; firstIndex: number }>()

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
  const entries: StyleEntry<T>[] = []

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
        const overridden = r && (r as any).overridden && typeof (r as any).overridden === 'object' ? ((r as any).overridden as any) : null
        const pseudoClasses = r && Array.isArray((r as any).pseudoClasses) ? ((r as any).pseudoClasses as any) : []
        const specificity = r && Array.isArray((r as any).specificity) ? ((r as any).specificity as any) : null
        const order = r && typeof (r as any).order === 'number' ? Number((r as any).order) : null
        const declList = decl
          ? Object.keys(decl)
              .sort()
              .map((k) => ({
                name: k,
                value: String((decl as any)[k] ?? ''),
                overridden: overridden ? Boolean(overridden[k]) : false,
              }))
          : []
        return {
          selector: String((r as any).selector || '').trim() || '—',
          source: String((r as any).source || '').trim(),
          media: String((r as any).media || '').trim(),
          truncated: Boolean((r as any).truncated),
          pseudoClasses: pseudoClasses.map((x: any) => String(x || '').trim()).filter(Boolean),
          specificity: specificity && specificity.length >= 3 ? [Number(specificity[0]) || 0, Number(specificity[1]) || 0, Number(specificity[2]) || 0] : [0, 0, 0],
          order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
          declarations: declList,
        }
      })
      .filter((x) => x.declarations.length > 0)
      .sort((a, b) => {
        // Более специфичные/поздние — выше.
        const as = a.specificity || [0, 0, 0]
        const bs = b.specificity || [0, 0, 0]
        if (as[0] !== bs[0]) return bs[0] - as[0]
        if (as[1] !== bs[1]) return bs[1] - as[1]
        if (as[2] !== bs[2]) return bs[2] - as[2]
        return (b.order || 0) - (a.order || 0)
      })
  }, [selected])

  const stylesUserRulesBeforeList = useMemo(() => {
    const rules = selected?.stylesUserRulesBefore
    if (!Array.isArray(rules)) return []
    return rules
      .map((r) => {
        const decl = r && r.declarations && typeof r.declarations === 'object' ? r.declarations : null
        const overridden = r && (r as any).overridden && typeof (r as any).overridden === 'object' ? ((r as any).overridden as any) : null
        const pseudoClasses = r && Array.isArray((r as any).pseudoClasses) ? ((r as any).pseudoClasses as any) : []
        const specificity = r && Array.isArray((r as any).specificity) ? ((r as any).specificity as any) : null
        const order = r && typeof (r as any).order === 'number' ? Number((r as any).order) : null
        const declList = decl
          ? Object.keys(decl)
              .sort()
              .map((k) => ({
                name: k,
                value: String((decl as any)[k] ?? ''),
                overridden: overridden ? Boolean(overridden[k]) : false,
              }))
          : []
        return {
          selector: String((r as any).selector || '').trim() || '—',
          source: String((r as any).source || '').trim(),
          media: String((r as any).media || '').trim(),
          truncated: Boolean((r as any).truncated),
          pseudoClasses: pseudoClasses.map((x: any) => String(x || '').trim()).filter(Boolean),
          specificity: specificity && specificity.length >= 3 ? [Number(specificity[0]) || 0, Number(specificity[1]) || 0, Number(specificity[2]) || 0] : [0, 0, 0],
          order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
          declarations: declList,
        }
      })
      .filter((x) => x.declarations.length > 0)
      .sort((a, b) => {
        const as = a.specificity || [0, 0, 0]
        const bs = b.specificity || [0, 0, 0]
        if (as[0] !== bs[0]) return bs[0] - as[0]
        if (as[1] !== bs[1]) return bs[1] - as[1]
        if (as[2] !== bs[2]) return bs[2] - as[2]
        return (b.order || 0) - (a.order || 0)
      })
  }, [selected])

  const stylesUserRulesAfterList = useMemo(() => {
    const rules = selected?.stylesUserRulesAfter
    if (!Array.isArray(rules)) return []
    return rules
      .map((r) => {
        const decl = r && r.declarations && typeof r.declarations === 'object' ? r.declarations : null
        const overridden = r && (r as any).overridden && typeof (r as any).overridden === 'object' ? ((r as any).overridden as any) : null
        const pseudoClasses = r && Array.isArray((r as any).pseudoClasses) ? ((r as any).pseudoClasses as any) : []
        const specificity = r && Array.isArray((r as any).specificity) ? ((r as any).specificity as any) : null
        const order = r && typeof (r as any).order === 'number' ? Number((r as any).order) : null
        const declList = decl
          ? Object.keys(decl)
              .sort()
              .map((k) => ({
                name: k,
                value: String((decl as any)[k] ?? ''),
                overridden: overridden ? Boolean(overridden[k]) : false,
              }))
          : []
        return {
          selector: String((r as any).selector || '').trim() || '—',
          source: String((r as any).source || '').trim(),
          media: String((r as any).media || '').trim(),
          truncated: Boolean((r as any).truncated),
          pseudoClasses: pseudoClasses.map((x: any) => String(x || '').trim()).filter(Boolean),
          specificity: specificity && specificity.length >= 3 ? [Number(specificity[0]) || 0, Number(specificity[1]) || 0, Number(specificity[2]) || 0] : [0, 0, 0],
          order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
          declarations: declList,
        }
      })
      .filter((x) => x.declarations.length > 0)
      .sort((a, b) => {
        const as = a.specificity || [0, 0, 0]
        const bs = b.specificity || [0, 0, 0]
        if (as[0] !== bs[0]) return bs[0] - as[0]
        if (as[1] !== bs[1]) return bs[1] - as[1]
        if (as[2] !== bs[2]) return bs[2] - as[2]
        return (b.order || 0) - (a.order || 0)
      })
  }, [selected])

  const groupRulesByMedia = <T extends { media: string }>(rules: T[]) => {
    const map = new Map<string, T[]>()
    for (let i = 0; i < rules.length; i += 1) {
      const r = rules[i]
      const k = String(r.media || '').trim()
      const arr = map.get(k)
      if (arr) arr.push(r)
      else map.set(k, [r])
    }
    const keys = Array.from(map.keys())
    keys.sort((a, b) => {
      if (!a && b) return -1
      if (a && !b) return 1
      return a.localeCompare(b)
    })
    return keys.map((k) => ({ media: k, rules: map.get(k) || [] }))
  }

  const renderSelector = (selector: string) => {
    const s = String(selector || '')
    if (!s) return '—'
    const re = /:(?!:)[a-zA-Z-]+(?:\([^)]*\))?|\.[\w-]+/g
    const parts: Array<{ t: string; k: 'text' | 'pseudo' | 'class' }> = []
    let last = 0
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const idx = m.index
      if (idx > last) parts.push({ t: s.slice(last, idx), k: 'text' })
      const token = String(m[0] || '')
      if (token.startsWith(':') && !token.startsWith('::')) parts.push({ t: token, k: 'pseudo' })
      else if (token.startsWith('.')) parts.push({ t: token, k: 'class' })
      else parts.push({ t: token, k: 'text' })
      last = idx + token.length
      if (parts.length > 400) break
    }
    if (last < s.length) parts.push({ t: s.slice(last), k: 'text' })
    return (
      <>
        {parts.map((p, i) => {
          if (p.k === 'pseudo') return <span key={`p:${i}`} className="browser-inspector__selector-pseudo">{p.t}</span>
          if (p.k === 'class') return <span key={`c:${i}`} className="browser-inspector__selector-class">{p.t}</span>
          return <span key={`t:${i}`}>{p.t}</span>
        })}
      </>
    )
  }

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
                  {groupRulesByMedia(stylesUserRulesList).map((mg) => (
                    <div key={`media:${mg.media || 'all'}`} className="browser-inspector__media-block">
                      {mg.media ? <div className="browser-inspector__media-title">{`@media ${mg.media}`}</div> : null}
                      {mg.rules.map((r, ruleIdx) => {
                        const ruleEntries = buildStyleGroupEntries(r.declarations)
                        const fileName = r.source ? r.source.replace(/^.*[/\\]/, '') : ''
                        return (
                          <div key={`${mg.media}:${r.selector}:${ruleIdx}`} className="browser-inspector__style-group">
                            <div className="browser-inspector__list-row browser-inspector__rule-header">
                              <div className="browser-inspector__rule-header-selector">{renderSelector(r.selector)}</div>
                              <div className="browser-inspector__rule-header-file">
                                {fileName || '—'}
                                {r.truncated ? ' (truncated)' : ''}
                              </div>
                            </div>
                            <div className="browser-inspector__style-group-items">
                              {ruleEntries.map((e) => {
                                if (e.kind === 'prop') {
                                  const s = e.prop
                                  return (
                                    <div
                                      key={s.name}
                                      className={`browser-inspector__list-row${s.overridden ? ' browser-inspector__list-row--overridden' : ''}`}
                                    >
                                      <div className="browser-inspector__list-key">{s.name}</div>
                                      <div className="browser-inspector__list-val">{s.value || '—'}</div>
                                    </div>
                                  )
                                }
                                const groupKey = `rule:${mg.media || 'all'}:${ruleIdx}:${e.group}`
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
                                          <div
                                            key={s.name}
                                            className={`browser-inspector__list-row${s.overridden ? ' browser-inspector__list-row--overridden' : ''}`}
                                          >
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
                  ))}
                </div>
              )}

              {(stylesUserRulesBeforeList.length > 0 || stylesUserRulesAfterList.length > 0) && (
                <div className="browser-inspector__pseudo-wrap">
                  {stylesUserRulesBeforeList.length > 0 && (
                    <div className="browser-inspector__pseudo-block">
                      <div className="browser-inspector__pseudo-title">Pseudo ::before</div>
                      <div className="browser-inspector__list">
                        {groupRulesByMedia(stylesUserRulesBeforeList).map((mg) => (
                          <div key={`before:media:${mg.media || 'all'}`} className="browser-inspector__media-block">
                            {mg.media ? <div className="browser-inspector__media-title">{`@media ${mg.media}`}</div> : null}
                            {mg.rules.map((r, idx) => {
                              const ruleEntries = buildStyleGroupEntries(r.declarations)
                              const fileName = r.source ? r.source.replace(/^.*[/\\]/, '') : ''
                              return (
                                <div key={`before:${mg.media}:${r.selector}:${idx}`} className="browser-inspector__style-group">
                                  <div className="browser-inspector__list-row browser-inspector__rule-header">
                                    <div className="browser-inspector__rule-header-selector">{renderSelector(r.selector)}</div>
                                    <div className="browser-inspector__rule-header-file">{fileName || '—'}</div>
                                  </div>
                                  <div className="browser-inspector__style-group-items">
                                    {ruleEntries.map((e) => {
                                      if (e.kind === 'prop') {
                                        const s = e.prop
                                        return (
                                          <div
                                            key={s.name}
                                            className={`browser-inspector__list-row${s.overridden ? ' browser-inspector__list-row--overridden' : ''}`}
                                          >
                                            <div className="browser-inspector__list-key">{s.name}</div>
                                            <div className="browser-inspector__list-val">{s.value || '—'}</div>
                                          </div>
                                        )
                                      }
                                      const groupKey = `before:${mg.media || 'all'}:${idx}:${e.group}`
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
                                                <div
                                                  key={s.name}
                                                  className={`browser-inspector__list-row${s.overridden ? ' browser-inspector__list-row--overridden' : ''}`}
                                                >
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
                        ))}
                      </div>
                    </div>
                  )}

                  {stylesUserRulesAfterList.length > 0 && (
                    <div className="browser-inspector__pseudo-block">
                      <div className="browser-inspector__pseudo-title">Pseudo ::after</div>
                      <div className="browser-inspector__list">
                        {groupRulesByMedia(stylesUserRulesAfterList).map((mg) => (
                          <div key={`after:media:${mg.media || 'all'}`} className="browser-inspector__media-block">
                            {mg.media ? <div className="browser-inspector__media-title">{`@media ${mg.media}`}</div> : null}
                            {mg.rules.map((r, idx) => {
                              const ruleEntries = buildStyleGroupEntries(r.declarations)
                              const fileName = r.source ? r.source.replace(/^.*[/\\]/, '') : ''
                              return (
                                <div key={`after:${mg.media}:${r.selector}:${idx}`} className="browser-inspector__style-group">
                                  <div className="browser-inspector__list-row browser-inspector__rule-header">
                                    <div className="browser-inspector__rule-header-selector">{renderSelector(r.selector)}</div>
                                    <div className="browser-inspector__rule-header-file">{fileName || '—'}</div>
                                  </div>
                                  <div className="browser-inspector__style-group-items">
                                    {ruleEntries.map((e) => {
                                      if (e.kind === 'prop') {
                                        const s = e.prop
                                        return (
                                          <div
                                            key={s.name}
                                            className={`browser-inspector__list-row${s.overridden ? ' browser-inspector__list-row--overridden' : ''}`}
                                          >
                                            <div className="browser-inspector__list-key">{s.name}</div>
                                            <div className="browser-inspector__list-val">{s.value || '—'}</div>
                                          </div>
                                        )
                                      }
                                      const groupKey = `after:${mg.media || 'all'}:${idx}:${e.group}`
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
                                                <div
                                                  key={s.name}
                                                  className={`browser-inspector__list-row${s.overridden ? ' browser-inspector__list-row--overridden' : ''}`}
                                                >
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
                        ))}
                      </div>
                    </div>
                  )}
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
