import { useEffect, type RefObject } from 'react'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { browserService } from '../../../services/BrowserService'
import {
  clearRequestedNavigate,
  ensurePagesTreeExpanded,
  setCurrentUrl,
  setPageLoading,
} from '../../../store/slices/browserSlice'
import type { CrawlPageData } from '../../../electron'
import type { ResourceHeadInfo } from '../types'

type UseBrowserEffectsParams = {
  boundsRef: RefObject<HTMLDivElement | null>
  deviceMode: string
  setViewSize: (size: { width: number; height: number }) => void
  selectedUrl: string
  pagesByUrl: Record<string, CrawlPageData>
  selectedPage: CrawlPageData | null
  activeTab: string
  resourceMiscList: string[]
  headInfoByUrl: Record<string, ResourceHeadInfo>
  setHeadInfoByUrl: React.Dispatch<React.SetStateAction<Record<string, ResourceHeadInfo>>>
}

export function useBrowserEffects({
  boundsRef,
  deviceMode,
  setViewSize,
  selectedUrl,
  pagesByUrl,
  selectedPage,
  activeTab,
  resourceMiscList,
  headInfoByUrl,
  setHeadInfoByUrl,
}: UseBrowserEffectsParams) {
  const dispatch = useAppDispatch()
  const requestedUrl = useAppSelector((s) => s.browser.requestedUrl)

  useEffect(() => {
    const el = boundsRef.current
    if (!el) {
      return
    }
    const update = () => {
      if (!boundsRef.current) return
      const r = boundsRef.current.getBoundingClientRect()
      setViewSize({
        width: Math.max(0, Math.floor(r.width)),
        height: Math.max(0, Math.floor(r.height)),
      })
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    update()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [boundsRef, deviceMode, setViewSize])

  useEffect(() => {
    const p = selectedUrl ? pagesByUrl[selectedUrl] : null
    if (!p?.url) {
      return
    }
    try {
      const u = new URL(p.url)
      const hostId = `host:${u.hostname}`
      dispatch(ensurePagesTreeExpanded([hostId]))
    } catch {
      void 0
    }
  }, [dispatch, selectedUrl, pagesByUrl])

  useEffect(() => {
    if (!requestedUrl) {
      return
    }
    void (async () => {
      try {
        const res = await browserService.navigate(requestedUrl)
        if (res?.success) {
          dispatch(setCurrentUrl(requestedUrl))
        }
      } finally {
        dispatch(clearRequestedNavigate())
      }
    })()
  }, [requestedUrl, dispatch])

  useEffect(() => {
    if (!window.electronAPI?.onBrowserEvent) {
      return
    }
    const unsub = window.electronAPI.onBrowserEvent((evt: any) => {
      if (!evt || typeof evt !== 'object') return
      if (evt.type === 'loading') {
        dispatch(setPageLoading(Boolean((evt as any).isLoading)))
      }
    })
    return () => {
      try {
        unsub()
      } catch {
        void 0
      }
    }
  }, [dispatch])

  useEffect(() => {
    if (!selectedPage) return
    if (activeTab !== 'images' && activeTab !== 'resources') return

    const list: string[] = []
    if (activeTab === 'images') {
      list.push(...(selectedPage.images || []))
    } else {
      list.push(
        ...(selectedPage.scripts || []),
        ...(selectedPage.stylesheets || []),
        ...(resourceMiscList || [])
      )
    }

    const uniq = Array.from(new Set(list.map((x) => String(x || '').trim()).filter(Boolean)))
    if (uniq.length === 0) return

    let cancelled = false
    void (async () => {
      const max = 50
      let processed = 0
      for (const url of uniq) {
        if (cancelled) return
        if (processed >= max) return
        if (headInfoByUrl[url]) continue
        processed += 1
        try {
          const res = await window.electronAPI.resourceHead(url)
          if (!res?.success) continue
          const sizeBytes =
            typeof (res as any).contentLength === 'number' ? (res as any).contentLength : null
          const elapsedMs = typeof (res as any).elapsedMs === 'number' ? (res as any).elapsedMs : null
          setHeadInfoByUrl((prev) => ({
            ...prev,
            [url]: { sizeBytes, elapsedMs },
          }))
        } catch {
          void 0
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeTab, selectedPage, resourceMiscList, headInfoByUrl, setHeadInfoByUrl])
}
