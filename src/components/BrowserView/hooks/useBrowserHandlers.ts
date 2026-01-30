import { useCallback } from 'react'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { browserService } from '../../../services/BrowserService'
import { crawlService } from '../../../services/CrawlService'
import { selectPage, upsertPage } from '../../../store/slices/crawlSlice'
import { setCurrentUrl, setDeviceMode, togglePagesTreeExpanded } from '../../../store/slices/browserSlice'
import type { CrawlPageData } from '../../../electron'
import type { DeviceMode } from '../types'

type UseBrowserHandlersParams = {
  deviceMode: DeviceMode
  isPageLoading: boolean
  pagesByUrl: Record<string, CrawlPageData>
}

export function useBrowserHandlers({
  deviceMode,
  isPageLoading,
  pagesByUrl,
}: UseBrowserHandlersParams) {
  const dispatch = useAppDispatch()
  const crawlSettings = useAppSelector((s) => s.crawl.settings)

  const toggle = useCallback(
    (id: string) => {
      dispatch(togglePagesTreeExpanded(id))
    },
    [dispatch]
  )

  const handleSetDeviceMode = useCallback(
    async (mode: DeviceMode) => {
      if (mode === deviceMode) {
        return
      }
      try {
        const res = await browserService.setDeviceMode(mode)
        if (res?.success) {
          dispatch(setDeviceMode(mode))
        }
      } catch {
        void 0
      }
    },
    [dispatch, deviceMode]
  )

  const openLinkSafely = useCallback(
    async (url: string) => {
      if (isPageLoading) {
        return
      }
      const target = String(url || '').trim()
      if (!target) {
        return
      }

      try {
        const navRes = await browserService.navigate(target)
        if (!navRes?.success) {
          throw new Error(navRes?.error || 'Browser navigate failed')
        }
        dispatch(setCurrentUrl(target))
      } catch {
        return
      }

      try {
        const res = await crawlService.analyzePage(target, {
          delayMs: crawlSettings.delayMs,
          jitterMs: crawlSettings.jitterMs,
          deduplicateLinks: crawlSettings.deduplicateLinks,
          userAgent: crawlSettings.userAgent,
          acceptLanguage: crawlSettings.acceptLanguage,
          platform: crawlSettings.platform,
          overrideWebdriver: crawlSettings.overrideWebdriver,
        })
        if (res?.success && res.page) {
          dispatch(upsertPage(res.page))
          const key = res.page.normalizedUrl || res.page.url
          if (key) {
            dispatch(selectPage(key))
          }
        }
      } catch {
        void 0
      }
    },
    [dispatch, isPageLoading, crawlSettings]
  )

  const handleSelect = useCallback(
    async (page: CrawlPageData) => {
      const key = page.normalizedUrl || page.url
      dispatch(selectPage(key))
      try {
        await browserService.navigate(page.url)
        dispatch(setCurrentUrl(page.url))
      } catch {
        void 0
      }
    },
    [dispatch]
  )

  const handleSelectKey = useCallback(
    async (key: string) => {
      const page = pagesByUrl[key]
      if (!page) {
        return
      }
      await handleSelect(page)
    },
    [pagesByUrl, handleSelect]
  )

  return {
    toggle,
    handleSetDeviceMode,
    openLinkSafely,
    handleSelect,
    handleSelectKey,
  }
}
