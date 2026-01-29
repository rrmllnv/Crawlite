export function isMailtoOrTel(value: string): boolean {
  const v = String(value || '').trim().toLowerCase()
  return v.startsWith('mailto:') || v.startsWith('tel:')
}

export function normalizeHostname(hostname: string): string {
  const h = String(hostname || '').trim().toLowerCase()
  return h.startsWith('www.') ? h.slice(4) : h
}
