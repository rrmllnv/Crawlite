import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import './PanelResizer.scss'

type PanelResizerProps = {
  ariaLabel: string
  onDeltaX: (deltaX: number) => void
  onDragEnd?: () => void
  className?: string
}

export function PanelResizer({ ariaLabel, onDeltaX, onDragEnd, className }: PanelResizerProps) {
  const lastClientXRef = useRef<number>(0)
  const draggingRef = useRef<boolean>(false)

  const stopDragging = useCallback(() => {
    if (!draggingRef.current) {
      return
    }
    draggingRef.current = false
    try {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    } catch {
      void 0
    }
    try {
      onDragEnd?.()
    } catch {
      void 0
    }
  }, [onDragEnd])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.preventDefault()
    } catch {
      void 0
    }
    draggingRef.current = true
    lastClientXRef.current = e.clientX
    try {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    } catch {
      void 0
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      void 0
    }
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return
    }
    const prev = lastClientXRef.current
    const next = e.clientX
    lastClientXRef.current = next
    const delta = next - prev
    if (!Number.isFinite(delta) || delta === 0) {
      return
    }
    try {
      onDeltaX(delta)
    } catch {
      void 0
    }
  }, [onDeltaX])

  const onPointerUp = useCallback(() => {
    stopDragging()
  }, [stopDragging])

  const onPointerCancel = useCallback(() => {
    stopDragging()
  }, [stopDragging])

  return (
    <div
      className={`panel-resizer${className ? ` ${className}` : ''}`}
      role="separator"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="panel-resizer__line" />
    </div>
  )
}

