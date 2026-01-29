import fs from 'node:fs'
import { net } from 'electron'

export function suggestFilenameFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    const last = String(u.pathname || '')
      .split('/')
      .filter(Boolean)
      .pop() || ''
    const clean = last.split('?')[0].split('#')[0]
    return clean || 'download'
  } catch {
    return 'download'
  }
}

export async function downloadToFile(url: string, filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    try {
      const request = net.request(url)
      request.on('response', (response: any) => {
        try {
          const statusCode = typeof response.statusCode === 'number' ? response.statusCode : 0
          if (statusCode >= 300 && statusCode < 400) {
            const location = response.headers?.location
            const next = Array.isArray(location) ? location[0] : location
            if (typeof next === 'string' && next) {
              try {
                ;(response as any).destroy()
              } catch {
                void 0
              }
              void downloadToFile(next, filePath).then(resolve).catch(reject)
              return
            }
          }

          const stream = fs.createWriteStream(filePath)
          stream.on('finish', () => resolve())
          stream.on('error', (e: unknown) => reject(e))
          ;(response as any).on('error', (e: unknown) => reject(e))
          ;(response as any).pipe(stream)
        } catch (e) {
          reject(e)
        }
      })
      request.on('error', (e: unknown) => reject(e))
      request.end()
    } catch (e) {
      reject(e)
    }
  })
}
