import { Spinner } from '@heroui/react'
import { useCallback, useEffect, useRef, useState } from 'react'

const HOVER_DELAY_MS = 200

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0)
    return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0)
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function isVideoReady(video: HTMLVideoElement): boolean {
  return Number.isFinite(video.duration) && video.duration > 0
}

function seekVideoTo(video: HTMLVideoElement, time: number) {
  const target = Math.max(0, time)
  video.pause()
  if (typeof video.fastSeek === 'function') {
    try {
      video.fastSeek(target)
      return
    }
    catch {
      // fastSeek 不可用时回退到 currentTime
    }
  }
  video.currentTime = target
}

export interface StashSceneCoverProps {
  screenshot?: string
  preview?: string
  className?: string
}

/** 仿 Stash 场景卡片：悬停播放预览，仅在底部进度条上拖动定位进度 */
export function StashSceneCover({ screenshot, preview, className }: StashSceneCoverProps) {
  const scrubberRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingScrubRatioRef = useRef<number | null>(null)
  const isScrubbingRef = useRef(false)

  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [showVideo, setShowVideo] = useState(false)
  const [videoSrc, setVideoSrc] = useState<string | null>(() => preview ?? null)
  const [scrubRatio, setScrubRatio] = useState<number | null>(null)
  const [scrubTime, setScrubTime] = useState<number | null>(null)

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const ensurePreviewLoaded = useCallback(() => {
    if (!preview)
      return
    if (!videoSrc)
      setVideoSrc(preview)
  }, [preview, videoSrc])

  const applyScrubSeek = useCallback((ratio: number) => {
    const video = videoRef.current
    setScrubRatio(ratio)

    if (!video) {
      pendingScrubRatioRef.current = ratio
      return
    }

    if (!isVideoReady(video)) {
      pendingScrubRatioRef.current = ratio
      return
    }

    const time = Math.min(
      Math.max(0, ratio * video.duration),
      Math.max(0, video.duration - 0.05),
    )

    seekVideoTo(video, time)
    setScrubTime(time)
    pendingScrubRatioRef.current = null
  }, [])

  const flushPendingScrubSeek = useCallback(() => {
    const ratio = pendingScrubRatioRef.current
    if (ratio === null)
      return
    applyScrubSeek(ratio)
  }, [applyScrubSeek])

  const seekFromScrubber = useCallback((clientX: number) => {
    const scrubber = scrubberRef.current
    if (!scrubber)
      return

    const rect = scrubber.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    applyScrubSeek(ratio)
  }, [applyScrubSeek])

  const resetVideo = useCallback(() => {
    const video = videoRef.current
    if (video) {
      video.pause()
      video.currentTime = 0
    }
    isScrubbingRef.current = false
    setShowVideo(false)
    setScrubRatio(null)
    setScrubTime(null)
    pendingScrubRatioRef.current = null
  }, [])

  const scheduleHoverPlay = useCallback(() => {
    clearHoverTimer()
    hoverTimerRef.current = setTimeout(() => {
      if (isScrubbingRef.current)
        return
      setShowVideo(true)
      const video = videoRef.current
      if (video)
        void video.play().catch(() => {})
    }, HOVER_DELAY_MS)
  }, [clearHoverTimer])

  const activatePreviewForScrub = useCallback(() => {
    clearHoverTimer()
    ensurePreviewLoaded()
    isScrubbingRef.current = true
    setShowVideo(true)
  }, [clearHoverTimer, ensurePreviewLoaded])

  const handleContainerMouseEnter = useCallback(() => {
    ensurePreviewLoaded()
    scheduleHoverPlay()
  }, [ensurePreviewLoaded, scheduleHoverPlay])

  const handleContainerMouseLeave = useCallback(() => {
    clearHoverTimer()
    resetVideo()
  }, [clearHoverTimer, resetVideo])

  const handleScrubberMouseEnter = useCallback(() => {
    activatePreviewForScrub()
  }, [activatePreviewForScrub])

  const handleScrubberMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    activatePreviewForScrub()
    seekFromScrubber(e.clientX)
  }, [activatePreviewForScrub, seekFromScrubber])

  const handleScrubberMouseLeave = useCallback(() => {
    isScrubbingRef.current = false
    setScrubRatio(null)
    setScrubTime(null)
    pendingScrubRatioRef.current = null

    const video = videoRef.current
    if (video && showVideo)
      void video.play().catch(() => {})
  }, [showVideo])

  const handleVideoLoadedMetadata = useCallback(() => {
    flushPendingScrubSeek()
  }, [flushPendingScrubSeek])

  const handleVideoCanPlay = useCallback(() => {
    flushPendingScrubSeek()
  }, [flushPendingScrubSeek])

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer])

  useEffect(() => {
    const video = videoRef.current
    if (!video)
      return
    video.disablePictureInPicture = true
    video.disableRemotePlayback = true
  }, [videoSrc])

  useEffect(() => {
    if (!videoSrc)
      return
    flushPendingScrubSeek()
  }, [videoSrc, flushPendingScrubSeek])

  if (!screenshot && !preview) {
    return <CoverEmpty>无封面</CoverEmpty>
  }

  const isScrubbing = scrubRatio !== null

  return (
    <div
      className={`group relative inline-block overflow-hidden rounded bg-surface-secondary ${className ?? 'h-[90px] w-40'}`}
      onMouseEnter={handleContainerMouseEnter}
      onMouseLeave={handleContainerMouseLeave}
    >
      {screenshot && !imageError && (
        <img
          src={screenshot}
          alt=""
          className={`absolute inset-0 size-full rounded object-cover object-top transition-opacity duration-200 ${
            showVideo ? 'opacity-0' : 'opacity-100'
          }`}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
        />
      )}

      {screenshot && !imageLoaded && !imageError && (
        <CoverOverlay>
          <Spinner size="sm" />
        </CoverOverlay>
      )}

      {imageError && !preview && (
        <CoverOverlay>
          加载失败
        </CoverOverlay>
      )}

      {preview && (
        <video
          ref={videoRef}
          src={videoSrc ?? undefined}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
          className={`stash-scene-cover-video pointer-events-none absolute inset-0 size-full rounded object-cover object-top transition-opacity duration-200 ${
            showVideo ? 'opacity-100' : 'opacity-0'
          }`}
          onLoadedMetadata={handleVideoLoadedMetadata}
          onCanPlay={handleVideoCanPlay}
        />
      )}

      {preview && (
        <div
          ref={scrubberRef}
          className="absolute inset-x-0 bottom-0 z-10 h-5 cursor-col-resize opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          onMouseEnter={handleScrubberMouseEnter}
          onMouseMove={handleScrubberMouseMove}
          onMouseLeave={handleScrubberMouseLeave}
        >
          <ScrubberInner>
            {isScrubbing && (
              <>
                <ScrubberFill style={{ width: `${(scrubRatio ?? 0) * 100}%` }} />
                <ScrubberMarker style={{ left: `${(scrubRatio ?? 0) * 100}%` }} />
              </>
            )}
          </ScrubberInner>
          {isScrubbing && scrubTime !== null && (
            <span className="pointer-events-none absolute bottom-full right-1.5 mb-0.5 text-[10px] text-white/90 drop-shadow-[0_0_3px_#000]">
              {formatTimestamp(scrubTime)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function CoverEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex size-full min-h-[90px] min-w-40 items-center justify-center rounded bg-surface-secondary text-xs text-muted">
      {children}
    </div>
  )
}

function CoverOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center rounded bg-surface-secondary">
      {children}
    </div>
  )
}

function ScrubberInner({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      {children}
    </div>
  )
}

function ScrubberFill({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="absolute bottom-0 h-full bg-white/10 transition-[width] duration-75"
      style={style}
    />
  )
}

function ScrubberMarker({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="absolute bottom-0 h-[5px] w-0 -translate-x-1/2 bg-red-500/50"
      style={style}
    />
  )
}
