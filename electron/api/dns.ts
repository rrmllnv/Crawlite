import { lookup } from 'node:dns/promises'

const ipByHost = new Map<string, string>()

export async function resolveHostIp(hostname: string): Promise<string> {
  const host = String(hostname || '').trim()
  if (!host) return ''
  const cached = ipByHost.get(host)
  if (cached) return cached
  try {
    const res = await lookup(host, { all: false })
    const ip = typeof (res as any)?.address === 'string' ? String((res as any).address) : ''
    if (ip) {
      ipByHost.set(host, ip)
      return ip
    }
  } catch {
    void 0
  }
  return ''
}
