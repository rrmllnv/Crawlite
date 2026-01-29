import { net } from 'electron'

export function readHeaderValue(
  headers: Record<string, unknown> | undefined,
  name: string
): string {
  if (!headers || typeof headers !== 'object') {
    return ''
  }
  const target = String(name || '').toLowerCase()
  const entries = Object.entries(headers)
  for (const [key, rawValue] of entries) {
    if (String(key).toLowerCase() !== target) {
      continue
    }
    if (typeof rawValue === 'string') {
      return rawValue
    }
    if (Array.isArray(rawValue) && rawValue.length > 0 && typeof rawValue[0] === 'string') {
      return rawValue[0]
    }
  }
  return ''
}

export function parseContentLength(
  headers: Record<string, unknown> | undefined
): number | null {
  const value = readHeaderValue(headers, 'content-length').trim()
  if (!value) {
    return null
  }
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) {
    return null
  }
  return Math.trunc(num)
}

export function parseContentRangeTotal(
  headers: Record<string, unknown> | undefined
): number | null {
  const value = readHeaderValue(headers, 'content-range').trim()
  const m = /\/(\d+)\s*$/i.exec(value)
  if (!m) return null
  const num = Number(m[1])
  if (!Number.isFinite(num) || num < 0) return null
  return Math.trunc(num)
}

export async function headContentLength(url: string): Promise<number | null> {
  return await new Promise<number | null>((resolve) => {
    try {
      const request = net.request({ method: 'HEAD', url })
      request.on('response', (response: any) => {
        try {
          const headers = response?.headers as Record<string, unknown> | undefined
          const len = parseContentLength(headers)
          resolve(len)
        } catch {
          resolve(null)
        }
      })
      request.on('error', () => resolve(null))
      request.end()
    } catch {
      resolve(null)
    }
  })
}

export async function probeResourceSize(url: string): Promise<number | null> {
  const lenHead = await headContentLength(url)
  if (typeof lenHead === 'number' && Number.isFinite(lenHead) && lenHead > 0) return lenHead

  return await new Promise<number | null>((resolve) => {
    try {
      const request = net.request({
        method: 'GET',
        url,
        headers: {
          Range: 'bytes=0-0',
        },
      } as any)
      request.on('response', (response: any) => {
        try {
          const headers = response?.headers as Record<string, unknown> | undefined
          const total = parseContentRangeTotal(headers)
          const len = total ?? parseContentLength(headers)
          resolve(
            typeof len === 'number' && Number.isFinite(len) && len > 0 ? Math.trunc(len) : null
          )
        } catch {
          resolve(null)
        }
        try {
          ;(response as any).destroy()
        } catch {
          void 0
        }
      })
      request.on('error', () => resolve(null))
      request.end()
    } catch {
      resolve(null)
    }
  })
}

export async function fetchUrlText(
  url: string,
  maxBytes: number
): Promise<{ ok: boolean; statusCode: number; body: string }> {
  return await new Promise((resolve) => {
    try {
      const request = net.request({ method: 'GET', url })
      request.on('response', (response: any) => {
        try {
          const statusCode = typeof response.statusCode === 'number' ? response.statusCode : 0
          const chunks: Buffer[] = []
          let size = 0
          ;(response as any).on('data', (chunk: Buffer) => {
            try {
              if (!Buffer.isBuffer(chunk)) {
                return
              }
              size += chunk.length
              if (size > maxBytes) {
                try {
                  ;(response as any).destroy()
                } catch {
                  void 0
                }
                return
              }
              chunks.push(chunk)
            } catch {
              void 0
            }
          })
          ;(response as any).on('end', () => {
            try {
              const buf = Buffer.concat(chunks)
              resolve({
                ok: statusCode >= 200 && statusCode < 300,
                statusCode,
                body: buf.toString('utf-8'),
              })
            } catch {
              resolve({ ok: false, statusCode, body: '' })
            }
          })
          ;(response as any).on('error', () => resolve({ ok: false, statusCode, body: '' }))
        } catch {
          resolve({ ok: false, statusCode: 0, body: '' })
        }
      })
      request.on('error', () => resolve({ ok: false, statusCode: 0, body: '' }))
      request.end()
    } catch {
      resolve({ ok: false, statusCode: 0, body: '' })
    }
  })
}
