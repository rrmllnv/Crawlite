import type { CrawlPageData } from '../../../electron'
import type { TreeNode } from '../../TreeItem/TreeItem'

export function buildUrlTree(
  pages: CrawlPageData[],
  pagesByUrl: Record<string, CrawlPageData>
): TreeNode {
  const root: TreeNode = { id: 'root', label: 'root', children: [] }
  const byId = new Map<string, TreeNode>()
  byId.set(root.id, root)

  const ensureNode = (parent: TreeNode, id: string, label: string): TreeNode => {
    const existing = byId.get(id)
    if (existing) {
      if (!parent.children.includes(existing)) {
        parent.children.push(existing)
      }
      return existing
    }
    const node: TreeNode = { id, label, children: [] }
    byId.set(id, node)
    parent.children.push(node)
    return node
  }

  for (const page of pages) {
    const key = page.normalizedUrl || page.url
    const p = pagesByUrl[key]
    const urlStr = p?.url || page.url
    if (!urlStr) continue

    let u: URL | null = null
    try {
      u = new URL(urlStr)
    } catch {
      u = null
    }
    if (!u) continue

    const hostId = `host:${u.hostname}`
    const hostNode = ensureNode(root, hostId, u.hostname)

    const segments = u.pathname.split('/').filter(Boolean)
    let parent = hostNode
    if (segments.length === 0) {
      const leafId = `${hostId}:/`
      const leaf = ensureNode(parent, leafId, '/')
      leaf.pageKey = key
      leaf.url = urlStr
      continue
    }

    let acc = ''
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]
      acc += `/${seg}`
      const isLast = i === segments.length - 1
      const nodeId = `${hostId}:${acc}`
      const node = ensureNode(parent, nodeId, seg)
      if (isLast) {
        node.pageKey = key
        node.url = urlStr
      }
      parent = node
    }
  }

  const sortNode = (node: TreeNode) => {
    node.children.sort((a, b) => {
      const aIsLeaf = Boolean(a.pageKey)
      const bIsLeaf = Boolean(b.pageKey)
      if (aIsLeaf !== bIsLeaf) {
        return aIsLeaf ? 1 : -1
      }
      return a.label.localeCompare(b.label)
    })
    for (const c of node.children) sortNode(c)
  }
  sortNode(root)
  return root
}
