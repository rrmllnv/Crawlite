import { useEffect, useMemo, useState } from 'react'
import './BrowserInspector.scss'

export type BrowserInspectorProps = {
  /** Управление раскрытием снаружи (например, при нажатии кнопки «Инспектор (наведение)»). */
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

type InspectorElementPayload = {
  requestId?: string
  clickedKey?: string
  tree?: DomTreeNode
}

type DomRect = { left: number; top: number; width: number; height: number }

type DomFont = {
  family?: string
  size?: string
  weight?: string
  style?: string
  lineHeight?: string
}

type DomUserStyleRule = {
  selector?: string
  source?: string
  media?: string
  truncated?: boolean
  declarations?: Record<string, string>
  overridden?: Record<string, boolean>
  pseudoClasses?: string[]
  specificity?: [number, number, number]
  order?: number
}

type DomTreeNode = {
  key: string
  tag: string
  id?: string
  className?: string
  attributes?: Record<string, string>
  rect?: DomRect
  text?: string
  font?: DomFont
  color?: string
  stylesUser?: Record<string, string>
  stylesUserRules?: DomUserStyleRule[]
  stylesUserRulesBefore?: DomUserStyleRule[]
  stylesUserRulesAfter?: DomUserStyleRule[]
  isClicked?: boolean
  truncated?: boolean
  children?: DomTreeNode[]
}

type StyleItem = { name: string; value: string; overridden?: boolean }

type StyleEntry<T extends StyleItem = StyleItem> = { kind: 'prop'; prop: T } | { kind: 'group'; group: string; items: T[] }

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
    if (!existing) groups.set(g, { items: [it], firstIndex: i })
    else existing.items.push(it)
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
      if (meta.items.length < 2) entries.push({ kind: 'prop', prop: it })
      else {
        emitted.add(g)
        entries.push({ kind: 'group', group: g, items: meta.items })
      }
    }
  }

  return entries
}

function groupRulesByMedia<T extends { media?: string }>(rules: T[]) {
  const map = new Map<string, T[]>()
  for (let i = 0; i < rules.length; i += 1) {
    const r = rules[i]
    const k = String(r?.media || '').trim()
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

type Rgb = { r: number; g: number; b: number }

function parseColorToRgb(cssColor: string): Rgb | null {
  if (!cssColor || typeof cssColor !== 'string' || typeof document === 'undefined') return null
  const s = cssColor.trim()
  if (!s) return null
  const div = document.createElement('div')
  div.style.color = s
  document.body.appendChild(div)
  const computed = getComputedStyle(div).color
  document.body.removeChild(div)
  const rgbMatch = computed.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    }
  }
  return null
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const x = Math.max(0, Math.min(255, Math.round(n)))
    const h = x.toString(16)
    return h.length === 1 ? '0' + h : h
  }
  return '#' + toHex(r) + toHex(g) + toHex(b)
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

function formatColorValue(cssColor: string, format: 'hex' | 'rgb' | 'hsl'): string {
  const rgb = parseColorToRgb(cssColor)
  if (!rgb) return cssColor
  if (format === 'hex') return rgbToHex(rgb.r, rgb.g, rgb.b)
  if (format === 'rgb') return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
  return `hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`
}

export function BrowserInspector({ isOpen: controlledOpen, onOpenChange }: BrowserInspectorProps = {}) {
  const [internalOpen, setInternalOpen] = useState(true)
  const isControlled = controlledOpen !== undefined && onOpenChange !== undefined
  const isOpen = isControlled ? controlledOpen : internalOpen
  const setIsOpen = isControlled ? onOpenChange : setInternalOpen
  const [selected, setSelected] = useState<InspectorElementPayload | null>(null)
  const [openTreeNodes, setOpenTreeNodes] = useState<Set<string>>(() => new Set())
  const [openUserStyleGroups, setOpenUserStyleGroups] = useState<Set<string>>(() => new Set())
  const [openFontRows, setOpenFontRows] = useState<Set<string>>(() => new Set())
  const [openSizeRows, setOpenSizeRows] = useState<Set<string>>(() => new Set())
  const [colorDisplayFormat, setColorDisplayFormat] = useState<'hex' | 'rgb' | 'hsl'>('hex')

  useEffect(() => {
    if (!window.electronAPI?.onBrowserEvent) return
    const unsub = window.electronAPI.onBrowserEvent((evt: any) => {
      try {
        if (!evt || typeof evt !== 'object') return
        if (evt.type !== 'inspector:element') return
        const el = (evt as any).element as InspectorElementPayload | null
        if (!el || typeof el !== 'object') return
        setSelected(el)
        // По клику раскрываем только текущий (кликнутый) элемент дерева, остальные закрыты.
        try {
          const getLeafKey = (n: any): string | null => {
            if (!n || typeof n !== 'object') return null
            const ch = Array.isArray(n.children) ? n.children : []
            if (ch.length === 0) return typeof n.key === 'string' ? n.key : null
            return getLeafKey(ch[0])
          }
          const leafKey = getLeafKey((el as any).tree)
          setOpenTreeNodes(leafKey ? new Set([leafKey]) : new Set())
          setOpenUserStyleGroups(new Set())
        } catch {
          setOpenTreeNodes(new Set())
          setOpenUserStyleGroups(new Set())
        }
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

  const tree = useMemo(() => {
    const t = selected?.tree
    if (!t || typeof t !== 'object') return null
    if (!t.key || !t.tag) return null
    return t
  }, [selected])

  void selected?.clickedKey

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
          if (p.k === 'pseudo')
            return (
              <span key={`p:${i}`} className="browser-inspector__rules-sel-pseudo">
                {p.t}
              </span>
            )
          if (p.k === 'class')
            return (
              <span key={`c:${i}`} className="browser-inspector__rules-sel-class">
                {p.t}
              </span>
            )
          return <span key={`t:${i}`}>{p.t}</span>
        })}
      </>
    )
  }

  const renderStylesUserList = (node: DomTreeNode) => {
    const rulesMain = Array.isArray(node.stylesUserRules) ? node.stylesUserRules : []
    const rulesBefore = Array.isArray(node.stylesUserRulesBefore) ? node.stylesUserRulesBefore : []
    const rulesAfter = Array.isArray(node.stylesUserRulesAfter) ? node.stylesUserRulesAfter : []
    const st = node.stylesUser && typeof node.stylesUser === 'object' ? node.stylesUser : null

    const nodeClasses = String(node.className || '')
      .trim()
      .split(/\s+/g)
      .map((x) => x.trim())
      .filter(Boolean)

    const ruleSelectorText = (r: any) => String(r?.selector || '').trim()
    const ruleIsUniversal = (r: any) => {
      const s = ruleSelectorText(r)
      // Упрощённая проверка: если селектор содержит '*' (включая '*', 'html *', '*:where(...)' и т.д.) —
      // отодвигаем ниже.
      return s.includes('*')
    }
    const ruleMatchesNodeClass = (r: any) => {
      const s = ruleSelectorText(r)
      if (!s || nodeClasses.length === 0) return false
      for (let i = 0; i < nodeClasses.length; i += 1) {
        const c = nodeClasses[i]
        if (!c) continue
        // Ищем ".class" в строке селектора (best-effort).
        if (s.includes(`.${c}`)) return true
      }
      return false
    }
    const ruleSpecificity = (r: any): [number, number, number] => {
      const sp = r?.specificity
      if (Array.isArray(sp) && sp.length >= 3) return [Number(sp[0]) || 0, Number(sp[1]) || 0, Number(sp[2]) || 0]
      return [0, 0, 0]
    }
    const ruleOrder = (r: any) => (typeof r?.order === 'number' && Number.isFinite(r.order) ? r.order : 0)
    const sortRules = (list: any[]) =>
      [...list].sort((a, b) => {
        // "*" всегда внизу.
        const au = ruleIsUniversal(a)
        const bu = ruleIsUniversal(b)
        if (au !== bu) return au ? 1 : -1

        // Правила, которые содержат текущие классы — выше.
        const am = ruleMatchesNodeClass(a)
        const bm = ruleMatchesNodeClass(b)
        if (am !== bm) return am ? -1 : 1

        // Более специфичные/поздние — выше.
        const as = ruleSpecificity(a)
        const bs = ruleSpecificity(b)
        if (as[0] !== bs[0]) return bs[0] - as[0]
        if (as[1] !== bs[1]) return bs[1] - as[1]
        if (as[2] !== bs[2]) return bs[2] - as[2]
        return ruleOrder(b) - ruleOrder(a)
      })

    const hasRules = rulesMain.length > 0 || rulesBefore.length > 0 || rulesAfter.length > 0
    const hasMerged = Boolean(st && Object.keys(st).length > 0)
    if (!hasRules && !hasMerged) return null

    return (
      <div className="browser-inspector__rules-block">
        <div className="browser-inspector__rules-block-title">Стили (user)</div>
        {rulesMain.length > 0 && (
          <div className="browser-inspector__rules-list">
            {groupRulesByMedia(rulesMain).map((mg) => (
              <div key={`media:${mg.media || 'all'}`} className="browser-inspector__rules-media">
                {mg.media ? <div className="browser-inspector__rules-media-title">{`@media ${mg.media}`}</div> : null}
                {sortRules(mg.rules).map((r, ruleIdx) => {
                  const decl = r && r.declarations && typeof r.declarations === 'object' ? r.declarations : null
                  const overridden = r && r.overridden && typeof r.overridden === 'object' ? r.overridden : null
                  const declList: StyleItem[] = decl
                    ? Object.keys(decl)
                        .sort()
                        .map((k) => ({ name: k, value: String((decl as any)[k] ?? ''), overridden: overridden ? Boolean((overridden as any)[k]) : false }))
                    : []
                  const ruleEntries = buildStyleGroupEntries(declList)
                  const fileName = r && r.source ? String(r.source).replace(/^.*[/\\]/, '') : ''
                  return (
                    <div key={`${mg.media}:${String(r.selector || '')}:${ruleIdx}`} className="browser-inspector__rules-rule">
                      <div className="browser-inspector__rules-line browser-inspector__rules-rule-head">
                        <div className="browser-inspector__rules-rule-selector">{renderSelector(String(r.selector || '').trim() || '—')}</div>
                        <div className="browser-inspector__rules-rule-file">
                          {fileName || '—'}
                          {r && r.truncated ? ' (truncated)' : ''}
                        </div>
                      </div>
                      <div className="browser-inspector__rules-rule-body">
                        {ruleEntries.map((e) => {
                          if (e.kind === 'prop') {
                            const s = e.prop
                            return (
                              <div
                                key={s.name}
                                className={`browser-inspector__rules-line${s.overridden ? ' browser-inspector__rules-line--overridden' : ''}`}
                              >
                                <div className="browser-inspector__rules-key">{s.name}</div>
                                <div className="browser-inspector__rules-val">{s.value || '—'}</div>
                              </div>
                            )
                          }
                          const groupKey = `rule:${mg.media || 'all'}:${ruleIdx}:${e.group}`
                          const opened = openUserStyleGroups.has(groupKey)
                          return (
                            <div key={`group:${groupKey}`} className="browser-inspector__rules-group">
                              <button
                                type="button"
                                className="browser-inspector__rules-line browser-inspector__rules-line--toggle browser-inspector__rules-group-row"
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
                                <div className="browser-inspector__rules-key">
                                  <i
                                    className={`fa-solid fa-chevron-${opened ? 'down' : 'right'} browser-inspector__rules-group-chevron`}
                                    aria-hidden="true"
                                  />
                                  <span className="browser-inspector__rules-group-title">{e.group}</span>
                                </div>
                                <div className="browser-inspector__rules-val">{ /* ( e.items.length  )*/ }</div>
                              </button>
                              {opened && (
                                <div className="browser-inspector__rules-group-body">
                                  {e.items.map((s) => (
                                    <div
                                      key={s.name}
                                      className={`browser-inspector__rules-line${s.overridden ? ' browser-inspector__rules-line--overridden' : ''}`}
                                    >
                                      <div className="browser-inspector__rules-key">{s.name}</div>
                                      <div className="browser-inspector__rules-val">{s.value || '—'}</div>
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

        {(rulesBefore.length > 0 || rulesAfter.length > 0) && (
          <div className="browser-inspector__pseudo-wrap">
            {rulesBefore.length > 0 && (
              <div className="browser-inspector__pseudo-block">
                <div className="browser-inspector__pseudo-title">Pseudo ::before</div>
                <div className="browser-inspector__rules-list">
                  {groupRulesByMedia(rulesBefore).map((mg) => (
                    <div key={`before:media:${mg.media || 'all'}`} className="browser-inspector__rules-media">
                      {mg.media ? <div className="browser-inspector__rules-media-title">{`@media ${mg.media}`}</div> : null}
                      {sortRules(mg.rules).map((r, idx) => {
                        const decl = r && r.declarations && typeof r.declarations === 'object' ? r.declarations : null
                        const overridden = r && r.overridden && typeof r.overridden === 'object' ? r.overridden : null
                        const declList: StyleItem[] = decl
                          ? Object.keys(decl)
                              .sort()
                              .map((k) => ({ name: k, value: String((decl as any)[k] ?? ''), overridden: overridden ? Boolean((overridden as any)[k]) : false }))
                          : []
                        const ruleEntries = buildStyleGroupEntries(declList)
                        const fileName = r && r.source ? String(r.source).replace(/^.*[/\\]/, '') : ''
                        return (
                          <div key={`before:${mg.media}:${String(r.selector || '')}:${idx}`} className="browser-inspector__rules-rule">
                            <div className="browser-inspector__rules-line browser-inspector__rules-rule-head">
                              <div className="browser-inspector__rules-rule-selector">{renderSelector(String(r.selector || '').trim() || '—')}</div>
                              <div className="browser-inspector__rules-rule-file">{fileName || '—'}</div>
                            </div>
                            <div className="browser-inspector__rules-rule-body">
                              {ruleEntries.map((e) => {
                                if (e.kind === 'prop') {
                                  const s = e.prop
                                  return (
                                    <div
                                      key={s.name}
                                      className={`browser-inspector__rules-line${s.overridden ? ' browser-inspector__rules-line--overridden' : ''}`}
                                    >
                                      <div className="browser-inspector__rules-key">{s.name}</div>
                                      <div className="browser-inspector__rules-val">{s.value || '—'}</div>
                                    </div>
                                  )
                                }
                                const groupKey = `before:${mg.media || 'all'}:${idx}:${e.group}`
                                const opened = openUserStyleGroups.has(groupKey)
                                return (
                                  <div key={`group:${groupKey}`} className="browser-inspector__rules-group">
                                    <button
                                      type="button"
                                      className="browser-inspector__rules-line browser-inspector__rules-line--toggle browser-inspector__rules-group-row"
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
                                      <div className="browser-inspector__rules-key">
                                        <i
                                          className={`fa-solid fa-chevron-${opened ? 'down' : 'right'} browser-inspector__rules-group-chevron`}
                                          aria-hidden="true"
                                        />
                                        <span className="browser-inspector__rules-group-title">{e.group}</span>
                                      </div>
                                      <div className="browser-inspector__rules-val">({e.items.length})</div>
                                    </button>
                                    {opened && (
                                      <div className="browser-inspector__rules-group-body">
                                        {e.items.map((s) => (
                                          <div
                                            key={s.name}
                                            className={`browser-inspector__rules-line${s.overridden ? ' browser-inspector__rules-line--overridden' : ''}`}
                                          >
                                            <div className="browser-inspector__rules-key">{s.name}</div>
                                            <div className="browser-inspector__rules-val">{s.value || '—'}</div>
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

            {rulesAfter.length > 0 && (
              <div className="browser-inspector__pseudo-block">
                <div className="browser-inspector__pseudo-title">Pseudo ::after</div>
                <div className="browser-inspector__rules-list">
                  {groupRulesByMedia(rulesAfter).map((mg) => (
                    <div key={`after:media:${mg.media || 'all'}`} className="browser-inspector__rules-media">
                      {mg.media ? <div className="browser-inspector__rules-media-title">{`@media ${mg.media}`}</div> : null}
                      {sortRules(mg.rules).map((r, idx) => {
                        const decl = r && r.declarations && typeof r.declarations === 'object' ? r.declarations : null
                        const overridden = r && r.overridden && typeof r.overridden === 'object' ? r.overridden : null
                        const declList: StyleItem[] = decl
                          ? Object.keys(decl)
                              .sort()
                              .map((k) => ({ name: k, value: String((decl as any)[k] ?? ''), overridden: overridden ? Boolean((overridden as any)[k]) : false }))
                          : []
                        const ruleEntries = buildStyleGroupEntries(declList)
                        const fileName = r && r.source ? String(r.source).replace(/^.*[/\\]/, '') : ''
                        return (
                          <div key={`after:${mg.media}:${String(r.selector || '')}:${idx}`} className="browser-inspector__rules-rule">
                            <div className="browser-inspector__rules-line browser-inspector__rules-rule-head">
                              <div className="browser-inspector__rules-rule-selector">{renderSelector(String(r.selector || '').trim() || '—')}</div>
                              <div className="browser-inspector__rules-rule-file">{fileName || '—'}</div>
                            </div>
                            <div className="browser-inspector__rules-rule-body">
                              {ruleEntries.map((e) => {
                                if (e.kind === 'prop') {
                                  const s = e.prop
                                  return (
                                    <div
                                      key={s.name}
                                      className={`browser-inspector__rules-line${s.overridden ? ' browser-inspector__rules-line--overridden' : ''}`}
                                    >
                                      <div className="browser-inspector__rules-key">{s.name}</div>
                                      <div className="browser-inspector__rules-val">{s.value || '—'}</div>
                                    </div>
                                  )
                                }
                                const groupKey = `after:${mg.media || 'all'}:${idx}:${e.group}`
                                const opened = openUserStyleGroups.has(groupKey)
                                return (
                                  <div key={`group:${groupKey}`} className="browser-inspector__rules-group">
                                    <button
                                      type="button"
                                      className="browser-inspector__rules-line browser-inspector__rules-line--toggle browser-inspector__rules-group-row"
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
                                      <div className="browser-inspector__rules-key">
                                        <i
                                          className={`fa-solid fa-chevron-${opened ? 'down' : 'right'} browser-inspector__rules-group-chevron`}
                                          aria-hidden="true"
                                        />
                                        <span className="browser-inspector__rules-group-title">{e.group}</span>
                                      </div>
                                      <div className="browser-inspector__rules-val">({e.items.length})</div>
                                    </button>
                                    {opened && (
                                      <div className="browser-inspector__rules-group-body">
                                        {e.items.map((s) => (
                                          <div
                                            key={s.name}
                                            className={`browser-inspector__rules-line${s.overridden ? ' browser-inspector__rules-line--overridden' : ''}`}
                                          >
                                            <div className="browser-inspector__rules-key">{s.name}</div>
                                            <div className="browser-inspector__rules-val">{s.value || '—'}</div>
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

        {!hasRules && st && (
          <div className="browser-inspector__rules-list">
            {Object.keys(st)
              .sort()
              .map((k) => (
                <div key={k} className="browser-inspector__rules-line">
                  <div className="browser-inspector__rules-key">{k}</div>
                  <div className="browser-inspector__rules-val">{String((st as any)[k] ?? '') || '—'}</div>
                </div>
              ))}
          </div>
        )}
      </div>
    )
  }

  const renderNodeDetails = (node: DomTreeNode) => {
    if (!node || typeof node !== 'object') return null
    const tag = typeof node.tag === 'string' ? node.tag.trim() : ''
    const id = typeof node.id === 'string' ? node.id : ''
    const className = typeof node.className === 'string' ? node.className : ''
    const text = typeof node.text === 'string' ? node.text : ''
    const color = typeof node.color === 'string' ? node.color : ''

    const attrs = node.attributes && typeof node.attributes === 'object' ? node.attributes : undefined
    const hasAttrs = attrs && Object.keys(attrs).length > 0
    const rect = node.rect && typeof node.rect === 'object' ? node.rect : undefined
    const font = node.font && typeof node.font === 'object' ? node.font : undefined
    const isRootLike = tag === 'html' || tag === 'body'

    return (
      <div className="browser-inspector__details">
          <div className="browser-inspector__details-block">
            <div className="browser-inspector__details-kv">
            {tag ? (
              <div className="browser-inspector__details-kv-row">
                <div className="browser-inspector__details-kv-key">Tag</div>
                <div className="browser-inspector__details-kv-val">{`<${tag}>`}</div>
              </div>
            ) : null}
              {id ? (
                <div className="browser-inspector__details-kv-row">
                  <div className="browser-inspector__details-kv-key">ID</div>
                  <div className="browser-inspector__details-kv-val">{`#${id}`}</div>
                </div>
              ) : null}
              {rect ? (
                <div className="browser-inspector__details-size-block">
                  <button
                    type="button"
                    className="browser-inspector__details-kv-row browser-inspector__details-kv-row--btn"
                    onClick={() => {
                      setOpenSizeRows((prev) => {
                        const next = new Set(prev)
                        if (next.has(node.key)) next.delete(node.key)
                        else next.add(node.key)
                        return next
                      })
                    }}
                    aria-expanded={openSizeRows.has(node.key)}
                  >
                    <div className="browser-inspector__details-kv-key">
                      <i
                        className={`fa-solid fa-chevron-${openSizeRows.has(node.key) ? 'down' : 'right'} browser-inspector__details-kv-chevron`}
                        aria-hidden="true"
                      />
                      Размер
                    </div>
                    <div className="browser-inspector__details-kv-val">
                      {rect ? `${Math.round(Number(rect.width) || 0)} × ${Math.round(Number(rect.height) || 0)}` : '—'}
                    </div>
                  </button>
                  {openSizeRows.has(node.key) && (
                    <div className="browser-inspector__details-size-expanded">
                      <div className="browser-inspector__details-kv-row">
                        <div className="browser-inspector__details-kv-key">Ширина</div>
                        <div className="browser-inspector__details-kv-val">
                          {rect ? `${Math.round(Number(rect.width) || 0)}` : '—'}
                        </div>
                      </div>
                      <div className="browser-inspector__details-kv-row">
                        <div className="browser-inspector__details-kv-key">Высота</div>
                        <div className="browser-inspector__details-kv-val">
                          {rect ? `${Math.round(Number(rect.height) || 0)}` : '—'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
              {!isRootLike && rect ? (
                <div className="browser-inspector__details-kv-row">
                  <div className="browser-inspector__details-kv-key">Позиция</div>
                  <div className="browser-inspector__details-kv-val">
                    {`${Math.round(Number(rect.left) || 0)}, ${Math.round(Number(rect.top) || 0)}`}
                  </div>
                </div>
              ) : null}
              {(font?.family || font?.size || font?.weight || font?.style || font?.lineHeight) ? (
                <div className="browser-inspector__details-font-block">
                  <button
                    type="button"
                    className="browser-inspector__details-kv-row browser-inspector__details-kv-row--btn"
                    onClick={() => {
                      setOpenFontRows((prev) => {
                        const next = new Set(prev)
                        if (next.has(node.key)) next.delete(node.key)
                        else next.add(node.key)
                        return next
                      })
                    }}
                    aria-expanded={openFontRows.has(node.key)}
                  >
                    <div className="browser-inspector__details-kv-key">
                      <i
                        className={`fa-solid fa-chevron-${openFontRows.has(node.key) ? 'down' : 'right'} browser-inspector__details-kv-chevron`}
                        aria-hidden="true"
                      />
                      Шрифт
                    </div>
                    <div className="browser-inspector__details-kv-val">
                      {font?.family || font?.size || font?.weight || font?.lineHeight
                        ? `${font?.family || ''} ${font?.size || ''} ${font?.weight || ''} ${font?.lineHeight || ''}`.trim()
                        : '—'}
                    </div>
                  </button>
                  {openFontRows.has(node.key) && (
                    <div className="browser-inspector__details-font-expanded">
                      <div className="browser-inspector__details-kv-row">
                        <div className="browser-inspector__details-kv-key">font-family</div>
                        <div className="browser-inspector__details-kv-val">{font?.family ? String(font.family) : '—'}</div>
                      </div>
                      <div className="browser-inspector__details-kv-row">
                        <div className="browser-inspector__details-kv-key">font-size</div>
                        <div className="browser-inspector__details-kv-val">{font?.size ? String(font.size) : '—'}</div>
                      </div>
                      <div className="browser-inspector__details-kv-row">
                        <div className="browser-inspector__details-kv-key">font-weight</div>
                        <div className="browser-inspector__details-kv-val">{font?.weight ? String(font.weight) : '—'}</div>
                      </div>
                      <div className="browser-inspector__details-kv-row">
                        <div className="browser-inspector__details-kv-key">font-style</div>
                        <div className="browser-inspector__details-kv-val">{font?.style ? String(font.style) : '—'}</div>
                      </div>
                      <div className="browser-inspector__details-kv-row">
                        <div className="browser-inspector__details-kv-key">line-height</div>
                        <div className="browser-inspector__details-kv-val">{font?.lineHeight ? String(font.lineHeight) : '—'}</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
              {color ? (
                <div className="browser-inspector__details-kv-row browser-inspector__details-color-row">
                  <div className="browser-inspector__details-kv-key">Цвет</div>
                  <div className="browser-inspector__details-kv-val browser-inspector__details-color-val">
                    <span
                      className="browser-inspector__details-color-swatch"
                      style={{ backgroundColor: color }}
                      title={color}
                      aria-hidden
                    />
                    <span className="browser-inspector__details-color-text">
                      {formatColorValue(color, colorDisplayFormat)}
                    </span>
                    <span className="browser-inspector__details-color-format">
                      {(['hex', 'rgb', 'hsl'] as const).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          className={`browser-inspector__details-color-btn${colorDisplayFormat === fmt ? ' browser-inspector__details-color-btn--active' : ''}`}
                          onClick={() => setColorDisplayFormat(fmt)}
                          title={fmt === 'hex' ? 'HEX' : fmt === 'rgb' ? 'RGB' : 'HSL'}
                        >
                          {fmt.toUpperCase()}
                        </button>
                      ))}
                    </span>
                  </div>
                </div>
              ) : null}
              {!isRootLike && text ? (
                <div className="browser-inspector__details-kv-row">
                  <div className="browser-inspector__details-kv-key">Текст</div>
                  <div className="browser-inspector__details-kv-val">{String(text)}</div>
                </div>
              ) : null}
            </div>
          </div>
        

        {hasAttrs ? (
          <div className="browser-inspector__details-block">
            <div className="browser-inspector__details-block-title">Атрибуты</div>
            <div className="browser-inspector__attrs-list">
              {Object.keys(attrs!)
                .sort()
                .map((k) => (
                  <div key={k} className="browser-inspector__attrs-line">
                    <div className="browser-inspector__attrs-key">{k}</div>
                    <div className="browser-inspector__attrs-val">{String((attrs as any)[k] ?? '') || '—'}</div>
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        {renderStylesUserList(node)}
      </div>
    )
  }

  const chainList = useMemo(() => {
    const out: DomTreeNode[] = []
    const walk = (n: DomTreeNode | null) => {
      if (!n) return
      out.push(n)
      const ch = Array.isArray(n.children) ? n.children : []
      if (ch.length > 0) walk(ch[0] as any)
    }
    if (tree) walk(tree)
    // Реверс: сверху кликнутый, ниже родители, в конце html.
    return out.reverse()
  }, [tree])

  const renderTreeRowTitle = (node: DomTreeNode) => {
    const titleParts: string[] = []
    titleParts.push(node.tag)
    if (node.id) titleParts.push(`#${node.id}`)
    if (node.className) titleParts.push(`.${String(node.className).trim().split(/\s+/g).filter(Boolean).join('.')}`)
    return titleParts.filter(Boolean).join('')
  }

  return (
    <div className="browser-inspector">
      <button
        type="button"
        className="browser-inspector__panel-header"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls="browser-inspector-content"
      >
        <span className="browser-inspector__panel-title">Инспектор</span>
        <i
          className={`fa-solid fa-chevron-${isOpen ? 'down' : 'left'} browser-inspector__panel-chevron`}
          aria-hidden="true"
        />
      </button>
      {isOpen && (
        <div id="browser-inspector-content" className="browser-inspector__panel-content">
          {!tree && <div className="browser-inspector__panel-empty">Кликните по элементу в браузере.</div>}

          {tree && (
            <div className="browser-inspector__section-dom">
              <div className="browser-inspector__section-dom-head">
                <div className="browser-inspector__section-dom-title">DOM дерево</div>
                <button
                  type="button"
                  className="browser-inspector__section-dom-btn"
                  onClick={() => {
                    const allOpen = chainList.length > 0 && chainList.every((n) => openTreeNodes.has(n.key))
                    if (allOpen) {
                      setOpenTreeNodes(new Set())
                    } else {
                      setOpenTreeNodes(new Set(chainList.map((n) => n.key)))
                    }
                  }}
                  title={chainList.length > 0 && chainList.every((n) => openTreeNodes.has(n.key)) ? 'Свернуть все' : 'Развернуть все'}
                >
                  {chainList.length > 0 && chainList.every((n) => openTreeNodes.has(n.key)) ? 'Свернуть все' : 'Развернуть все'}
                </button>
              </div>
              <div className="browser-inspector__dom-tree">
                {chainList.map((node) => {
                  const opened = openTreeNodes.has(node.key)
                  const title = renderTreeRowTitle(node)
                  return (
                    <div key={node.key} className="browser-inspector__dom-node">
                      <button
                        type="button"
                        className={[
                          'browser-inspector__dom-row',
                          'browser-inspector__dom-row--btn',
                          node.isClicked ? 'browser-inspector__dom-row--current' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          setOpenTreeNodes((prev) => {
                            const next = new Set(prev)
                            if (next.has(node.key)) next.delete(node.key)
                            else next.add(node.key)
                            return next
                          })
                        }}
                        aria-expanded={opened}
                      >
                        <i
                          className={`fa-solid fa-chevron-${opened ? 'down' : 'right'} browser-inspector__dom-chevron`}
                          aria-hidden="true"
                        />
                        <span className="browser-inspector__dom-title">{title}</span>
                        {node.truncated ? <span className="browser-inspector__dom-truncated">(truncated)</span> : null}
                      </button>
                      {opened ? renderNodeDetails(node) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
