import type Player from 'video.js/dist/types/player'
import type VjsHtmlTrackElement from 'video.js/dist/types/tracks/html-track-element'
import type { VideoJsPlaylistNavOptions } from '@/lib/videojs-playlist-controls'
import { Spinner } from '@heroui/react'
import { useEffect, useMemo, useRef } from 'react'
import videojs from 'video.js'
import {
  ensureVideoJsPlaylistButtons,
  refreshSubsCapsButton,
  syncVideoJsPlaylistButtons,
} from '@/lib/videojs-playlist-controls'
import 'video.js/dist/video-js.css'

export interface VideoJsPlayerSource {
  src: string
  type?: string
}

export interface VideoJsPlaybackEvent {
  currentTime: number
  duration?: number
  isPaused: boolean
}

export interface VideoJsTextTrack {
  id: string
  label: string
  src: string
  default?: boolean
  language?: string
}

export interface VideoJsPlayerProps {
  source?: VideoJsPlayerSource
  autoPlay?: boolean
  className?: string
  fillViewport?: boolean
  initialTime?: number
  loadingLabel?: string
  playlistNav?: VideoJsPlaylistNavOptions
  progressIntervalMs?: number
  textTracks?: VideoJsTextTrack[]
  onError?: (message: string) => void
  onPlaybackProgress?: (event: VideoJsPlaybackEvent) => void
  onPlaybackStart?: (event: VideoJsPlaybackEvent) => void
  onPlaybackStopped?: (event: VideoJsPlaybackEvent) => void
}

type RemoteTextTrackHandle = VjsHtmlTrackElement & { track: Pick<TextTrack, 'mode'> }

function applyTextTrackMode(
  attached: Map<string, RemoteTextTrackHandle>,
  activeTrackId: string | undefined,
) {
  for (const [id, handle] of attached) {
    handle.track.mode = activeTrackId && id === activeTrackId ? 'showing' : 'hidden'
  }
}

function clearTextTracks(player: Player, attached: Map<string, RemoteTextTrackHandle>) {
  for (const handle of attached.values())
    player.removeRemoteTextTrack(handle)
  attached.clear()
}

function readPlaybackEvent(player: Player): VideoJsPlaybackEvent {
  const currentTime = player.currentTime()
  const duration = player.duration()

  return {
    currentTime: typeof currentTime === 'number' && Number.isFinite(currentTime) ? currentTime : 0,
    duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : undefined,
    isPaused: player.paused(),
  }
}

export function VideoJsPlayer({
  source,
  autoPlay = false,
  className,
  fillViewport = false,
  initialTime,
  loadingLabel = '加载视频...',
  playlistNav,
  progressIntervalMs = 10000,
  textTracks = [],
  onError,
  onPlaybackProgress,
  onPlaybackStart,
  onPlaybackStopped,
}: VideoJsPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<Player | null>(null)
  const attachedTextTracksRef = useRef<Map<string, RemoteTextTrackHandle>>(new Map())
  const activeTextTrackIdRef = useRef<string | undefined>(undefined)
  const startedRef = useRef(false)
  const stoppedRef = useRef(false)
  const initialSeekAppliedRef = useRef(false)
  const lastProgressAtRef = useRef(0)
  const latestPlaybackEventRef = useRef<VideoJsPlaybackEvent>({
    currentTime: 0,
    isPaused: true,
  })
  const onErrorRef = useRef(onError)
  const onPlaybackProgressRef = useRef(onPlaybackProgress)
  const onPlaybackStartRef = useRef(onPlaybackStart)
  const onPlaybackStoppedRef = useRef(onPlaybackStopped)
  const initialTimeRef = useRef(initialTime)
  const playlistNavRef = useRef(playlistNav)
  const progressIntervalMsRef = useRef(progressIntervalMs)

  const sourceKey = source?.src
  const sourceType = source?.type
  const textTracksKey = useMemo(
    () => textTracks.map(track => `${track.id}:${track.src}:${track.default ? '1' : '0'}`).join('|'),
    [textTracks],
  )

  const containerClassName = useMemo(() => {
    const base = fillViewport
      ? 'relative flex h-full min-h-0 w-full flex-col'
      : 'relative aspect-video w-full'
    return className ? `${base} ${className}` : base
  }, [className, fillViewport])

  useEffect(() => {
    onErrorRef.current = onError
    onPlaybackProgressRef.current = onPlaybackProgress
    onPlaybackStartRef.current = onPlaybackStart
    onPlaybackStoppedRef.current = onPlaybackStopped
    initialTimeRef.current = initialTime
    playlistNavRef.current = playlistNav
    progressIntervalMsRef.current = progressIntervalMs
  }, [initialTime, onError, onPlaybackProgress, onPlaybackStart, onPlaybackStopped, playlistNav, progressIntervalMs])

  useEffect(() => {
    startedRef.current = false
    stoppedRef.current = false
    initialSeekAppliedRef.current = false
    lastProgressAtRef.current = 0
    activeTextTrackIdRef.current = textTracks.find(track => track.default)?.id
    latestPlaybackEventRef.current = {
      currentTime: 0,
      isPaused: true,
    }
  }, [sourceKey, textTracks])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !sourceKey)
      return

    let cancelled = false
    let player = playerRef.current
    let resizeTimer: number | undefined
    const videoSource = sourceType
      ? { src: sourceKey, type: sourceType }
      : { src: sourceKey }

    const emitProgress = (activePlayer: Player, force = false) => {
      const event = readPlaybackEvent(activePlayer)
      latestPlaybackEventRef.current = event

      const now = Date.now()
      if (!force && now - lastProgressAtRef.current < progressIntervalMsRef.current)
        return

      lastProgressAtRef.current = now
      onPlaybackProgressRef.current?.(event)
    }

    const emitStopped = (activePlayer: Player) => {
      const event = readPlaybackEvent(activePlayer)
      latestPlaybackEventRef.current = event

      if (stoppedRef.current)
        return

      stoppedRef.current = true
      onPlaybackStoppedRef.current?.(event)
    }

    const setupPlayer = () => {
      if (cancelled || !document.contains(container))
        return

      if (!player) {
        const videoEl = document.createElement('video')
        videoEl.className = fillViewport
          ? 'video-js vjs-big-play-centered h-full w-full'
          : 'video-js vjs-big-play-centered vjs-fluid'
        videoEl.playsInline = true
        container.appendChild(videoEl)

        player = videojs(videoEl, {
          controls: true,
          fill: fillViewport,
          fluid: !fillViewport,
          preload: 'auto',
        })

        if (fillViewport)
          player.addClass('vjs-always-show-controls')

        playerRef.current = player
      }

      const activePlayer = player

      const handleLoadedMetadata = () => {
        const startTime = initialTimeRef.current
        if (initialSeekAppliedRef.current || !startTime || startTime <= 0)
          return

        const duration = activePlayer.duration()
        const safeTime = typeof duration === 'number' && Number.isFinite(duration)
          ? Math.min(startTime, Math.max(duration - 3, 0))
          : startTime

        activePlayer.currentTime(safeTime)
        initialSeekAppliedRef.current = true
        latestPlaybackEventRef.current = readPlaybackEvent(activePlayer)
      }

      const handlePlaying = () => {
        const event = readPlaybackEvent(activePlayer)
        latestPlaybackEventRef.current = event

        if (!startedRef.current) {
          startedRef.current = true
          stoppedRef.current = false
          onPlaybackStartRef.current?.(event)
        }

        emitProgress(activePlayer, true)
      }

      const handlePause = () => {
        if (activePlayer.ended())
          return
        emitProgress(activePlayer, true)
      }

      const handleEnded = () => {
        emitStopped(activePlayer)
      }

      const handleError = () => {
        onErrorRef.current?.(activePlayer.error()?.message ?? '浏览器无法播放当前视频流')
      }

      const handleTimeUpdate = () => emitProgress(activePlayer)

      activePlayer.on('loadedmetadata', handleLoadedMetadata)
      activePlayer.on('playing', handlePlaying)
      activePlayer.on('timeupdate', handleTimeUpdate)
      activePlayer.on('pause', handlePause)
      activePlayer.on('ended', handleEnded)
      activePlayer.on('error', handleError)
      activePlayer.src(videoSource)
      activePlayer.load()
      ensureVideoJsPlaylistButtons(activePlayer, playlistNavRef.current)
      syncVideoJsPlaylistButtons(activePlayer, playlistNavRef.current)
      activePlayer.ready(() => {
        resizeTimer = window.setTimeout(() => activePlayer.trigger('componentresize'), 0)
      })

      if (autoPlay) {
        const playResult = activePlayer.play()
        if (playResult && 'catch' in playResult)
          playResult.catch(() => undefined)
      }

      return () => {
        activePlayer.off('loadedmetadata', handleLoadedMetadata)
        activePlayer.off('playing', handlePlaying)
        activePlayer.off('timeupdate', handleTimeUpdate)
        activePlayer.off('pause', handlePause)
        activePlayer.off('ended', handleEnded)
        activePlayer.off('error', handleError)
      }
    }

    let cleanupPlayerHandlers: (() => void) | undefined
    const frameId = window.requestAnimationFrame(() => {
      cleanupPlayerHandlers = setupPlayer()
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
      cleanupPlayerHandlers?.()
      if (resizeTimer != null)
        window.clearTimeout(resizeTimer)
    }
  }, [
    autoPlay,
    fillViewport,
    sourceKey,
    sourceType,
  ])

  useEffect(() => {
    const player = playerRef.current
    if (!player || !sourceKey)
      return

    ensureVideoJsPlaylistButtons(player, playlistNav)
    syncVideoJsPlaylistButtons(player, playlistNav)
  }, [playlistNav, sourceKey, sourceType])

  useEffect(() => {
    const player = playerRef.current
    if (!player || !sourceKey)
      return

    const attached = attachedTextTracksRef.current
    const knownIds = new Set(textTracks.map(track => track.id))

    for (const id of [...attached.keys()]) {
      if (!knownIds.has(id)) {
        player.removeRemoteTextTrack(attached.get(id)!)
        attached.delete(id)
      }
    }

    for (const [index, track] of textTracks.entries()) {
      if (attached.has(track.id))
        continue

      const trackEl = player.addRemoteTextTrack(
        {
          kind: 'subtitles',
          src: track.src,
          srclang: track.language || `sub-${index}`,
          label: track.label,
          default: false,
        },
        false,
      ) as RemoteTextTrackHandle
      attached.set(track.id, trackEl)
    }

    if (!activeTextTrackIdRef.current || !attached.has(activeTextTrackIdRef.current))
      activeTextTrackIdRef.current = textTracks.find(track => track.default)?.id

    applyTextTrackMode(attached, activeTextTrackIdRef.current)
    refreshSubsCapsButton(player)
  }, [sourceKey, textTracks, textTracksKey])

  useEffect(() => {
    const player = playerRef.current
    if (!player || !sourceKey)
      return

    const list = player.textTracks()
    const handleChange = () => {
      let showingId: string | undefined
      for (const [id, handle] of attachedTextTracksRef.current) {
        if (handle.track.mode === 'showing') {
          showingId = id
          break
        }
      }
      activeTextTrackIdRef.current = showingId
    }

    list.addEventListener('change', handleChange)
    return () => list.removeEventListener('change', handleChange)
  }, [sourceKey, textTracksKey])

  useEffect(() => {
    const attachedTextTracks = attachedTextTracksRef.current
    return () => {
      const player = playerRef.current
      if (!player)
        return

      if (startedRef.current && !stoppedRef.current) {
        stoppedRef.current = true
        onPlaybackStoppedRef.current?.(latestPlaybackEventRef.current)
      }

      clearTextTracks(player, attachedTextTracks)
      player.dispose()
      playerRef.current = null
    }
  }, [])

  return (
    <div className={containerClassName}>
      {!source && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
          <div className="flex flex-col items-center gap-2 text-white/70">
            <Spinner color="current" />
            <span className="text-sm">{loadingLabel}</span>
          </div>
        </div>
      )}
      <div data-vjs-player className="video-js-player-shell relative min-h-0 flex-1 overflow-hidden bg-black">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}
