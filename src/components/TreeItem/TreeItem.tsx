import type { CrawlPageData } from '../../electron'

export type TreeNode = {
  id: string
  label: string
  children: TreeNode[]
  pageKey?: string
  url?: string
}

export function TreeItem({
  node,
  level,
  expanded,
  toggle,
  onSelect,
  selectedKey,
  pagesByUrl,
}: {
  node: TreeNode
  level: number
  expanded: Set<string>
  toggle: (id: string) => void
  onSelect: (key: string) => void
  selectedKey: string
  pagesByUrl: Record<string, CrawlPageData>
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(node.id)
  const isLeaf = Boolean(node.pageKey)
  const isSelected = isLeaf && node.pageKey === selectedKey

  const leafPage = isLeaf && node.pageKey ? pagesByUrl[node.pageKey] : null
  const leafTitle = isLeaf
    ? (leafPage?.title || leafPage?.h1 || node.label || '—')
    : node.label
  const leafUrl = isLeaf ? (leafPage?.url || node.url || '') : ''

  return (
    <div className="browser-tree__item">
      <div
        className={`browser-tree__row ${isSelected ? 'browser-tree__row--active' : ''}`}
        style={{ paddingLeft: 8 + level * 14 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="browser-tree__toggle"
            onClick={() => toggle(node.id)}
            aria-label={isExpanded ? 'Свернуть' : 'Раскрыть'}
            title={isExpanded ? 'Свернуть' : 'Раскрыть'}
          >
            <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true" />
          </button>
        ) : (
          <span className="browser-tree__toggle-spacer" />
        )}

        <button
          type="button"
          className={`browser-tree__label ${isLeaf ? 'browser-tree__label--leaf' : ''}`}
          onClick={() => {
            if (isLeaf && node.pageKey) onSelect(node.pageKey)
            else if (hasChildren) toggle(node.id)
          }}
          title={leafUrl || node.url || node.label}
        >
          {!isLeaf && <span className="browser-tree__text">{node.label}</span>}
          {isLeaf && (
            <span className="browser-tree__leaf">
              <span className="browser-tree__leaf-title">{leafTitle}</span>
              <span className="browser-tree__leaf-url">{leafUrl}</span>
            </span>
          )}
        </button>
      </div>

      {hasChildren && isExpanded && (
        <div className="browser-tree__children">
          {node.children.map((c) => (
            <TreeItem
              key={c.id}
              node={c}
              level={level + 1}
              expanded={expanded}
              toggle={toggle}
              onSelect={onSelect}
              selectedKey={selectedKey}
              pagesByUrl={pagesByUrl}
            />
          ))}
        </div>
      )}
    </div>
  )
}
