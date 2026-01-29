export function pickChromeVersionFromUserAgent(userAgent: string): string | null {
  const ua = String(userAgent || '')
  const m = ua.match(/Chrome\/([0-9.]+)/)
  return m && typeof m[1] === 'string' && m[1] ? m[1] : null
}

export function buildMobileUserAgent(desktopUserAgent: string): string {
  const chromeVersion = pickChromeVersionFromUserAgent(desktopUserAgent)
  if (!chromeVersion) {
    return String(desktopUserAgent || '')
  }
  return `Mozilla/5.0 (Linux; Android 10; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`
}
