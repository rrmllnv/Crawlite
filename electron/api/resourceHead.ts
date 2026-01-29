import { safeParseUrl } from './urlUtils'
import { probeResourceSize } from './httpUtils'

export async function handleResourceHead(
  url: string
): Promise<
  | { success: true; contentLength: number | null; elapsedMs: number }
  | { success: false; error: string }
> {
  const u = safeParseUrl(url)
  if (!u) {
    return { success: false, error: 'Invalid URL' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { success: false, error: 'Unsupported protocol' }
  }

  try {
    const startedAt = Date.now()
    const contentLength = await probeResourceSize(u.toString())
    const elapsedMs = Date.now() - startedAt
    return { success: true, contentLength, elapsedMs }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
