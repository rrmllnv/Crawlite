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
  isClicked?: boolean
  truncated?: boolean
  children?: DomTreeNode[]
}

export function BrowserInspector({ isOpen: controlledOpen, onOpenChange }: BrowserInspectorProps = {}) {
  const [internalOpen, setInternalOpen] = useState(true)
  const isControlled = controlledOpen !== undefined && onOpenChange !== undefined
  const isOpen = isControlled ? controlledOpen : internalOpen
  const setIsOpen = isControlled ? onOpenChange : setInternalOpen
  const [selected, setSelected] = useState<InspectorElementPayload | null>(null)
  const [openTreeNodes, setOpenTreeNodes] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!window.electronAPI?.onBrowserEvent) return
    const unsub = window.electronAPI.onBrowserEvent((evt: any) => {
      try {
        if (!evt || typeof evt !== 'object') return
        if (evt.type !== 'inspector:element') return
        const el = (evt as any).element as InspectorElementPayload | null
        if (!el || typeof el !== 'object') return
        setSelected(el)
        // По клику раскрываем дерево целиком (все узлы открыты).
        try {
          const next = new Set<string>()
          const walk = (n: any) => {
            if (!n || typeof n !== 'object') return
            if (typeof n.key === 'string') next.add(n.key)
            const ch = Array.isArray(n.children) ? n.children : []
            for (let i = 0; i < ch.length; i += 1) walk(ch[i])
          }
          walk((el as any).tree)
          setOpenTreeNodes(next)
        } catch {
          setOpenTreeNodes(new Set())
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

  const renderStylesUserList = (stylesUser: Record<string, string> | undefined) => {
    const st = stylesUser && typeof stylesUser === 'object' ? stylesUser : null
    if (!st) return null
    const keys = Object.keys(st).sort()
    if (keys.length === 0) return null
    return (
      <div className="browser-inspector__node-block">
        <div className="browser-inspector__node-block-title">Стили (user)</div>
        <div className="browser-inspector__list">
          {keys.map((k) => (
            <div key={k} className="browser-inspector__list-row">
              <div className="browser-inspector__list-key">{k}</div>
              <div className="browser-inspector__list-val">{String((st as any)[k] ?? '') || '—'}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderNodeDetails = (node: DomTreeNode) => {
    const attrs = node.attributes && typeof node.attributes === 'object' ? node.attributes : undefined
    const rect = node.rect
    const isRootLike = node.tag === 'html' || node.tag === 'body'
    return (
      <div className="browser-inspector__node-details">
        <div className="browser-inspector__node-block">
          <div className="browser-inspector__kv">
            <div className="browser-inspector__kv-row">
              <div className="browser-inspector__kv-key">Tag</div>
              <div className="browser-inspector__kv-val">{node.tag ? `<${node.tag}>` : '—'}</div>
            </div>
            <div className="browser-inspector__kv-row">
              <div className="browser-inspector__kv-key">ID</div>
              <div className="browser-inspector__kv-val">{node.id ? `#${node.id}` : '—'}</div>
            </div>
            {/* <div className="browser-inspector__kv-row">
              <div className="browser-inspector__kv-key">Class</div>
              <div className="browser-inspector__kv-val">{node.className ? String(node.className) : '—'}</div>
            </div> */}
            <div className="browser-inspector__kv-row">
              <div className="browser-inspector__kv-key">Размер</div>
              <div className="browser-inspector__kv-val">
                {rect ? `${Math.round(rect.width)} × ${Math.round(rect.height)}` : '—'}
              </div>
            </div>
            {!isRootLike && (
              <div className="browser-inspector__kv-row">
                <div className="browser-inspector__kv-key">Позиция</div>
                <div className="browser-inspector__kv-val">
                  {rect ? `${Math.round(rect.left)}, ${Math.round(rect.top)}` : '—'}
                </div>
              </div>
            )}
            {!isRootLike && (
              <div className="browser-inspector__kv-row">
                <div className="browser-inspector__kv-key">Текст</div>
                <div className="browser-inspector__kv-val">{node.text ? String(node.text) : '—'}</div>
              </div>
            )}
            <div className="browser-inspector__kv-row">
              <div className="browser-inspector__kv-key">Шрифт</div>
              <div className="browser-inspector__kv-val">
                {node.font?.family || node.font?.size || node.font?.weight
                  ? `${node.font?.family || ''} ${node.font?.size || ''} ${node.font?.weight || ''}`.trim()
                  : '—'}
              </div>
            </div>
            <div className="browser-inspector__kv-row">
              <div className="browser-inspector__kv-key">Цвет</div>
              <div className="browser-inspector__kv-val">{node.color ? String(node.color) : '—'}</div>
            </div>
          </div>
        </div>

        {attrs && Object.keys(attrs).length > 0 && (
          <div className="browser-inspector__node-block">
            <div className="browser-inspector__node-block-title">Атрибуты</div>
            <div className="browser-inspector__list">
              {Object.keys(attrs)
                .sort()
                .map((k) => (
                  <div key={k} className="browser-inspector__list-row">
                    <div className="browser-inspector__list-key">{k}</div>
                    <div className="browser-inspector__list-val">{String((attrs as any)[k] ?? '') || '—'}</div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {renderStylesUserList(node.stylesUser)}
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
          {!tree && <div className="browser-inspector__empty">Кликните по элементу в браузере.</div>}

          {tree && (
            <div className="browser-inspector__section">
              <div className="browser-inspector__section-title">DOM дерево</div>
              <div className="browser-inspector__tree">
                {chainList.map((node) => {
                  const opened = openTreeNodes.has(node.key)
                  const title = renderTreeRowTitle(node)
                  return (
                    <div key={node.key} className="browser-inspector__tree-node">
                      <button
                        type="button"
                        className={[
                          'browser-inspector__tree-row',
                          'browser-inspector__tree-row--button',
                          node.isClicked ? 'browser-inspector__tree-row--clicked' : '',
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
                          className={`fa-solid fa-chevron-${opened ? 'down' : 'right'} browser-inspector__tree-chevron`}
                          aria-hidden="true"
                        />
                        <span className="browser-inspector__tree-title">{title}</span>
                        {node.truncated ? <span className="browser-inspector__tree-truncated">(truncated)</span> : null}
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
