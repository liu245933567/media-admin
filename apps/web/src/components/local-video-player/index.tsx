import type Player from 'video.js/dist/types/player'
import type VjsHtmlTrackElement from 'video.js/dist/types/tracks/html-track-element'
import type { VideoJsPlaylistNavOptions } from '@/lib/videojs-playlist-controls'
import { Alert, Button, ProgressBar, Spinner } from '@heroui/react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import videojs from 'video.js'
import {
  buildLocalVideoSrc,
  buildTranscodedVideoSrc,
  getProbeVideoFsQueryKey,
  getVideoTranscodeStatusFsQueryKey,
  probeVideoFs,
  readTextFs,
  startVideoTranscodeFs,
  videoTranscodeStatusFs,
} from '@/api'
import {
  ensureVideoJsPlaylistButtons,
  refreshSubsCapsButton,
  syncVideoJsPlaylistButtons,
} from '@/lib/videojs-playlist-controls'
import { createSubtitleBlobUrl } from '@/utils/srt-to-vtt'
import { resolveDefaultChineseSubtitlePath } from '@/utils/subtitle-track'
import 'video.js/dist/video-js.css'

export interface LocalSubtitleTrack {
  label: string
  path: string
}

export interface LocalVideoPlayerProps {
  videoPath: string
  subtitleTracks: LocalSubtitleTrack[]
  /** 默认选中的字幕文件名（非完整路径） */
  defaultSubtitleLabel?: string
  /** 铺满父容器（播放页全屏） */
  fillViewport?: boolean
  /** 写入 video.js 控制栏的上一集 / 下一集（有值时显示原生底部按钮） */
  playlistNav?: VideoJsPlaylistNavOptions
}

/** video.js 的 HTMLTrackElement（与 DOM 同名类型区分），挂载后通过 `.track` 控制字幕 */
type RemoteTextTrackHandle = VjsHtmlTrackElement & { track: Pick<TextTrack, 'mode'> }

/** 将当前应显示的字幕轨设为 showing，其余 hidden（供原生 CC 菜单与默认轨共用） */
function applySubtitleTrackMode(
  attached: Map<string, RemoteTextTrackHandle>,
  activePath: string | undefined,
) {
  for (const [path, handle] of attached) {
    handle.track.mode = activePath && path === activePath ? 'showing' : 'hidden'
  }
}

function clearAttachedSubtitleTracks(
  player: Player,
  attached: Map<string, RemoteTextTrackHandle>,
) {
  for (const handle of attached.values())
    player.removeRemoteTextTrack(handle)
  attached.clear()
}

export function LocalVideoPlayer({
  videoPath,
  subtitleTracks,
  defaultSubtitleLabel,
  fillViewport = false,
  playlistNav,
}: LocalVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<Player | null>(null)
  const subtitleBlobUrlsRef = useRef<Map<string, string>>(new Map())
  const attachedSubtitleTracksRef = useRef<Map<string, RemoteTextTrackHandle>>(new Map())
  const transcodeStartRequested = useRef(false)

  const initialTrackPath = useMemo(
    () => resolveDefaultChineseSubtitlePath(videoPath, subtitleTracks, defaultSubtitleLabel),
    [videoPath, subtitleTracks, defaultSubtitleLabel],
  )

  const [activeTrackPath, setActiveTrackPath] = useState<string | undefined>(initialTrackPath)

  useEffect(() => {
    setActiveTrackPath(initialTrackPath)
  }, [initialTrackPath])

  useEffect(() => {
    transcodeStartRequested.current = false
  }, [videoPath])

  const probeQuery = useQuery({
    queryKey: getProbeVideoFsQueryKey({ path: videoPath }),
    queryFn: () => probeVideoFs({ path: videoPath }),
  })

  const needsTranscode = probeQuery.data?.needs_transcode === true

  const transcodeStatusQuery = useQuery({
    queryKey: getVideoTranscodeStatusFsQueryKey({ path: videoPath }),
    enabled: needsTranscode && probeQuery.isSuccess,
    queryFn: () => videoTranscodeStatusFs({ path: videoPath }),
    refetchInterval: (query) => {
      const phase = query.state.data?.phase
      if (phase === 'running' || phase === 'idle')
        return 1000
      return false
    },
  })

  useEffect(() => {
    if (!needsTranscode || transcodeStartRequested.current)
      return
    const phase = transcodeStatusQuery.data?.phase
    if (phase === 'idle' || phase === 'failed') {
      transcodeStartRequested.current = true
      void startVideoTranscodeFs({ path: videoPath }).then(() => {
        void transcodeStatusQuery.refetch()
      })
    }
  }, [needsTranscode, transcodeStatusQuery.data?.phase, videoPath, transcodeStatusQuery])

  const playbackSrc = useMemo(() => {
    if (!probeQuery.isSuccess)
      return undefined
    if (!needsTranscode)
      return buildLocalVideoSrc(videoPath)
    if (transcodeStatusQuery.data?.phase === 'ready')
      return buildTranscodedVideoSrc(videoPath)
    return undefined
  }, [probeQuery.isSuccess, needsTranscode, videoPath, transcodeStatusQuery.data?.phase])

  /** 预加载同目录全部字幕，供 video.js 原生 CC 菜单切换 */
  const subtitleBlobQueries = useQueries({
    queries: subtitleTracks.map(track => ({
      queryKey: ['local-video-subtitle', track.path] as const,
      queryFn: async () => {
        const res = await readTextFs({ path: track.path })
        return createSubtitleBlobUrl(track.path, res.content)
      },
      staleTime: 5 * 60 * 1000,
    })),
  })

  const subtitleBlobByPath = useMemo(() => {
    const map = new Map<string, string>()
    subtitleTracks.forEach((track, index) => {
      const url = subtitleBlobQueries[index]?.data
      if (url)
        map.set(track.path, url)
    })
    return map
  }, [subtitleTracks, subtitleBlobQueries])

  /** 仅在组件卸载时销毁 player（勿在 playbackSrc 暂空时 dispose，否则换集后无法在同一 video 节点上重建） */
  useEffect(() => {
    return () => {
      for (const url of subtitleBlobUrlsRef.current.values())
        URL.revokeObjectURL(url)
      subtitleBlobUrlsRef.current.clear()
      if (playerRef.current) {
        clearAttachedSubtitleTracks(playerRef.current, attachedSubtitleTracksRef.current)
        playerRef.current.dispose()
        playerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const el = videoRef.current
    if (!el || !playbackSrc)
      return

    let player = playerRef.current
    if (!player) {
      player = videojs(el, {
        fluid: !fillViewport,
        fill: fillViewport,
        controls: true,
        preload: 'auto',
        sources: [{ src: playbackSrc, type: 'video/mp4' }],
      })
      if (fillViewport) {
        player.addClass('vjs-always-show-controls')
      }
      playerRef.current = player
    }
    else {
      player.src({ src: playbackSrc, type: 'video/mp4' })
    }
  }, [playbackSrc, fillViewport, playlistNav])

  useEffect(() => {
    const player = playerRef.current
    if (!player || !playbackSrc)
      return
    ensureVideoJsPlaylistButtons(player, playlistNav)
    syncVideoJsPlaylistButtons(player, playlistNav)
  }, [playlistNav, playbackSrc])

  /** 将全部已加载字幕注册为 remote text tracks，原生 CC 按钮才能列出并切换 */
  useEffect(() => {
    const player = playerRef.current
    if (!player || !playbackSrc)
      return

    let cancelled = false

    const syncRemoteTracks = () => {
      if (cancelled)
        return

      const attached = attachedSubtitleTracksRef.current
      const knownPaths = new Set(subtitleTracks.map(t => t.path))

      for (const path of [...attached.keys()]) {
        if (!knownPaths.has(path)) {
          player.removeRemoteTextTrack(attached.get(path)!)
          attached.delete(path)
        }
      }

      for (const [index, track] of subtitleTracks.entries()) {
        const blobUrl = subtitleBlobByPath.get(track.path)
        if (!blobUrl || attached.has(track.path))
          continue

        subtitleBlobUrlsRef.current.set(track.path, blobUrl)
        // 每条轨需唯一 srclang，且勿设 default，否则 CC 菜单会把同语言多条都标为选中
        const trackEl = player.addRemoteTextTrack(
          {
            kind: 'subtitles',
            src: blobUrl,
            srclang: `sub-${index}`,
            label: track.label,
            default: false,
          },
          false,
        ) as RemoteTextTrackHandle
        trackEl.track.mode = track.path === activeTrackPath ? 'showing' : 'hidden'
        attached.set(track.path, trackEl)
      }

      applySubtitleTrackMode(attached, activeTrackPath)
      refreshSubsCapsButton(player)
    }

    if (player.readyState() >= 1)
      syncRemoteTracks()
    else
      player.ready(syncRemoteTracks)

    return () => {
      cancelled = true
    }
  }, [playbackSrc, subtitleTracks, subtitleBlobByPath, activeTrackPath])

  /** 外部默认轨 / 表单变更时同步 mode（不拆除轨道，避免打断原生菜单） */
  useEffect(() => {
    if (!playerRef.current || !playbackSrc)
      return
    applySubtitleTrackMode(attachedSubtitleTracksRef.current, activeTrackPath)
  }, [activeTrackPath, playbackSrc])

  /** 原生 CC 菜单切换时回写 activeTrackPath */
  useEffect(() => {
    const player = playerRef.current
    if (!player || !playbackSrc)
      return

    const list = player.textTracks()
    const onChange = () => {
      let showingPath: string | undefined
      for (const [path, handle] of attachedSubtitleTracksRef.current) {
        if (handle.track.mode === 'showing') {
          showingPath = path
          break
        }
      }
      setActiveTrackPath((prev) => {
        if (prev === showingPath)
          return prev
        return showingPath
      })
    }

    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [playbackSrc, subtitleTracks])

  const transcodePhase = transcodeStatusQuery.data?.phase
  const showTranscodeProgress = needsTranscode
    && transcodePhase !== 'ready'
    && transcodePhase !== 'failed'

  return (
    <div
      className={
        fillViewport
          ? 'flex h-full min-h-0 w-full flex-col'
          : 'w-full max-w-5xl'
      }
    >
      {(probeQuery.isError || (needsTranscode && transcodePhase === 'failed') || showTranscodeProgress) && (
        <div
          className={
            fillViewport
              ? 'absolute top-0 right-0 left-0 z-30 max-h-[40%] space-y-1 overflow-y-auto p-2'
              : 'mb-3 space-y-3'
          }
        >
          {probeQuery.isError && (
            <Alert status="danger" className={fillViewport ? 'border-white/10 bg-zinc-900/90 text-white' : ''}>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>无法分析视频</Alert.Title>
                <Alert.Description>{probeQuery.error.message}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
          {needsTranscode && transcodePhase === 'failed' && (
            <Alert status="danger" className={fillViewport ? 'border-white/10 bg-zinc-900/90 text-white' : ''}>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>转码失败</Alert.Title>
                <Alert.Description>
                  {transcodeStatusQuery.data?.message ?? '请确认已安装 FFmpeg 后重试'}
                </Alert.Description>
              </Alert.Content>
              <Button
                size="sm"
                variant="danger"
                onPress={() => {
                  transcodeStartRequested.current = false
                  void startVideoTranscodeFs({ path: videoPath }).then(() => {
                    transcodeStartRequested.current = true
                    void transcodeStatusQuery.refetch()
                  })
                }}
              >
                重试
              </Button>
            </Alert>
          )}
          {showTranscodeProgress && (
            <div className={fillViewport ? 'rounded-lg bg-zinc-900/90 px-3 py-2 text-white' : ''}>
              <p className={`mb-2 text-sm ${fillViewport ? 'text-white/80' : 'text-gray-600'}`}>
                {transcodeStatusQuery.data?.message ?? '正在准备转码…'}
                {probeQuery.data?.video_codec && (
                  <span className={fillViewport ? 'ml-2 text-white/45' : 'ml-2 text-gray-400'}>
                    (
                    {probeQuery.data.container ?? '未知容器'}
                    {' / '}
                    {probeQuery.data.video_codec}
                    )
                  </span>
                )}
              </p>
              <ProgressBar
                aria-label="转码进度"
                value={Math.round((transcodeStatusQuery.data?.progress ?? 0) * 100)}
              >
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
            </div>
          )}
        </div>
      )}
      <div
        data-vjs-player
        className={
          fillViewport
            ? 'relative min-h-0 flex-1 overflow-hidden'
            : 'relative aspect-video w-full'
        }
      >
        {!playbackSrc && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
            <div className="flex flex-col items-center gap-2 text-white/70">
              <Spinner color="current" />
              <span className="text-sm">{needsTranscode ? '等待转码完成...' : '加载视频...'}</span>
            </div>
          </div>
        )}
        <video
          ref={videoRef}
          className={
            fillViewport
              ? 'video-js vjs-big-play-centered h-full w-full'
              : 'video-js vjs-big-play-centered vjs-fluid'
          }
          playsInline
        />
      </div>
    </div>
  )
}
