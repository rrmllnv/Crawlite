import type { BrowserBounds } from '../electron'

class BrowserService {
  async ensure(bounds: BrowserBounds) {
    return await window.electronAPI.browserEnsure(bounds)
  }

  async resize(bounds: BrowserBounds) {
    return await window.electronAPI.browserResize(bounds)
  }

  async setVisible(visible: boolean) {
    return await window.electronAPI.browserSetVisible(visible)
  }

  async navigate(url: string) {
    return await window.electronAPI.browserNavigate(url)
  }

  async highlightHeading(level: number, text: string) {
    return await window.electronAPI.browserHighlightHeading({ level, text })
  }
}

export const browserService = new BrowserService()

