export function safeParseUrl(raw: string): URL | null {
  try {
    const trimmed = String(raw ?? '').trim()
    if (!trimmed) {
      return null
    }
    const candidate =
      trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`
    return new URL(candidate)
  } catch {
    return null
  }
}

export function normalizeHostname(hostname: string): string {
  const h = String(hostname || '').trim().toLowerCase()
  return h.startsWith('www.') ? h.slice(4) : h
}

export function normalizeUrl(input: string): string {
  const u = safeParseUrl(input)
  if (!u) {
    return ''
  }
  u.hash = ''
  const href = u.toString()
  return href.endsWith('/') ? href.slice(0, -1) : href
}

export function isDocumentOrMediaUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    const pathLower = String(u.pathname || '').toLowerCase()
    const ext = pathLower.includes('.') ? pathLower.split('.').pop() || '' : ''
    const cleanExt = ext.split('?')[0].split('#')[0]
    if (!cleanExt) return false

    const blocked = new Set([
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv',
      'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'exe', 'msi', 'dmg', 'apk',
      'mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'm4v', 'mp3', 'wav', 'flac', 'ogg', 'm4a',
    ])
    return blocked.has(cleanExt)
  } catch {
    return false
  }
}

export function isHttpUrl(u: URL | null): u is URL {
  if (!u) return false
  return u.protocol === 'http:' || u.protocol === 'https:'
}

export function isInternalByHost(u: URL | null, baseHostNormalized: string): boolean {
  if (!u) return false
  if (!isHttpUrl(u)) return false
  return normalizeHostname(u.hostname) === baseHostNormalized
}
