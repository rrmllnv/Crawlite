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

  async goBack() {
    return await window.electronAPI.browserGoBack()
  }

  async goForward() {
    return await window.electronAPI.browserGoForward()
  }

  async reload() {
    return await window.electronAPI.browserReload()
  }

  async setDeviceMode(mode: 'desktop' | 'mobile' | 'tablet') {
    return await window.electronAPI.browserSetDeviceMode(mode)
  }

  async highlightHeading(level: number, text: string) {
    return await window.electronAPI.browserHighlightHeading({ level, text })
  }

  async highlightLink(url: string) {
    return await window.electronAPI.browserHighlightLink(url)
  }

  async highlightImage(url: string) {
    return await window.electronAPI.browserHighlightImage(url)
  }
}

export const browserService = new BrowserService()

