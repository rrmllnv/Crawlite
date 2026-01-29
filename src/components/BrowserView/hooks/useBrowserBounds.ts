import { useEffect, useRef } from 'react'
import { browserService } from '../../../services/BrowserService'
import type { DeviceMode } from '../types'
import {
  EMULATED_HEIGHT_MOBILE,
  EMULATED_HEIGHT_TABLET,
  EMULATED_WIDTH_MOBILE,
  EMULATED_WIDTH_TABLET,
} from '../types'

export function useBrowserBounds(deviceMode: DeviceMode) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }

    let rafId: number | null = null

    const apply = async () => {
      if (!ref.current) {
        return
      }
      const rect = ref.current.getBoundingClientRect()
      const fullWidth = Math.max(0, Math.floor(rect.width))
      const fullHeight = Math.max(0, Math.floor(rect.height))
      const left = Math.max(0, Math.floor(rect.left))
      const top = Math.max(0, Math.floor(rect.top))

      let width: number
      let height: number
      let x: number
      let y: number
      if (deviceMode === 'mobile') {
        width = Math.min(EMULATED_WIDTH_MOBILE, fullWidth)
        height = Math.min(EMULATED_HEIGHT_MOBILE, fullHeight)
        x = left + Math.max(0, Math.floor((fullWidth - width) / 2))
        y = top + Math.max(0, Math.floor((fullHeight - height) / 2))
      } else if (deviceMode === 'tablet') {
        width = Math.min(EMULATED_WIDTH_TABLET, fullWidth)
        height = Math.min(EMULATED_HEIGHT_TABLET, fullHeight)
        x = left + Math.max(0, Math.floor((fullWidth - width) / 2))
        y = top + Math.max(0, Math.floor((fullHeight - height) / 2))
      } else {
        width = fullWidth
        height = fullHeight
        x = left
        y = top
      }

      const bounds = {
        x,
        y,
        width,
        height,
      }
      await browserService.ensure(bounds)
      await browserService.resize(bounds)
    }

    const schedule = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        void apply()
      })
    }

    const ro = new ResizeObserver(() => schedule())
    ro.observe(el)
    window.addEventListener('resize', schedule)
    schedule()

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
      window.removeEventListener('resize', schedule)
      ro.disconnect()
    }
  }, [deviceMode])

  return ref
}
