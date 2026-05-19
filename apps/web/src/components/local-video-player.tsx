import type Player from 'video.js/dist/types/player'
import type VjsHtmlTrackElement from 'video.js/dist/types/tracks/html-track-element'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Progress, Select, Spin } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import videojs from 'video.js'
import {
  buildLocalVideoSrc,
  buildTranscodedVideoSrc,
  fetchFsReadText,
  fetchVideoPlaybackProbe,
  fetchVideoTranscodeStatus,
  startVideoTranscode,
} from '@/request'
import { VideoTranscodePhase } from '@/types/api'
import { createSubtitleBlobUrl } from '@/utils/srt-to-vtt'
import { getFileName, getFileStem } from '@/utils/video-path'
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
}

function resolveDefaultTrackPath(
  videoPath: string,
  tracks: LocalSubtitleTrack[],
  preferredLabel?: string,
): string | undefined {
  if (!tracks.length)
    return undefined
  if (preferredLabel) {
    const hit = tracks.find(t => t.label === preferredLabel)
    if (hit)
      return hit.path
  }
  const videoStem = getFileStem(getFileName(videoPath))
  const sameStem = tracks.find(t => getFileStem(t.label) === videoStem)
  return (sameStem ?? tracks[0]).path
}

/** video.js 的 HTMLTrackElement（与 DOM 同名类型区分），挂载后通过 `.track` 控制字幕 */
type RemoteTextTrackHandle = VjsHtmlTrackElement & { track: Pick<TextTrack, 'mode'> }

function detachRemoteSubtitle(
  player: Player,
  trackElRef: React.RefObject<RemoteTextTrackHandle | null>,
) {
  const el = trackElRef.current
  if (!el)
    return
  player.removeRemoteTextTrack(el)
  trackElRef.current = null
}

export function LocalVideoPlayer({
  videoPath,
  subtitleTracks,
  defaultSubtitleLabel,
}: LocalVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<Player | null>(null)
  const subtitleBlobRef = useRef<string | null>(null)
  const remoteSubtitleElRef = useRef<RemoteTextTrackHandle | null>(null)
  const transcodeStartRequested = useRef(false)

  const initialTrackPath = useMemo(
    () => resolveDefaultTrackPath(videoPath, subtitleTracks, defaultSubtitleLabel),
    [videoPath, subtitleTracks, defaultSubtitleLabel],
  )

  const [activeTrackPath, setActiveTrackPath] = useState<string | undefined>(initialTrackPath)

  useEffect(() => {
    setActiveTrackPath(initialTrackPath)
  }, [initialTrackPath])

  useEffect(() => {
    transcodeStartRequested.current = false
  }, [videoPath])

  const activeTrack = useMemo(
    () => subtitleTracks.find(t => t.path === activeTrackPath),
    [subtitleTracks, activeTrackPath],
  )

  const probeQuery = useQuery({
    queryKey: ['video-playback-probe', videoPath],
    queryFn: () => fetchVideoPlaybackProbe({ path: videoPath }),
  })

  const needsTranscode = probeQuery.data?.needs_transcode === true

  const transcodeStatusQuery = useQuery({
    queryKey: ['video-transcode-status', videoPath],
    enabled: needsTranscode && probeQuery.isSuccess,
    queryFn: () => fetchVideoTranscodeStatus({ path: videoPath }),
    refetchInterval: (query) => {
      const phase = query.state.data?.phase
      if (phase === VideoTranscodePhase.Running || phase === VideoTranscodePhase.Idle)
        return 1000
      return false
    },
  })

  useEffect(() => {
    if (!needsTranscode || transcodeStartRequested.current)
      return
    const phase = transcodeStatusQuery.data?.phase
    if (phase === VideoTranscodePhase.Idle || phase === VideoTranscodePhase.Failed) {
      transcodeStartRequested.current = true
      void startVideoTranscode({ path: videoPath }).then(() => {
        void transcodeStatusQuery.refetch()
      })
    }
  }, [needsTranscode, transcodeStatusQuery.data?.phase, videoPath, transcodeStatusQuery])

  const playbackSrc = useMemo(() => {
    if (!probeQuery.isSuccess)
      return undefined
    if (!needsTranscode)
      return buildLocalVideoSrc(videoPath)
    if (transcodeStatusQuery.data?.phase === VideoTranscodePhase.Ready)
      return buildTranscodedVideoSrc(videoPath)
    return undefined
  }, [probeQuery.isSuccess, needsTranscode, videoPath, transcodeStatusQuery.data?.phase])

  const subtitleQuery = useQuery({
    queryKey: ['local-video-subtitle', activeTrackPath],
    enabled: Boolean(activeTrackPath),
    queryFn: async () => {
      if (!activeTrackPath)
        return null
      const res = await fetchFsReadText({ path: activeTrackPath })
      return createSubtitleBlobUrl(activeTrackPath, res.content)
    },
  })

  useEffect(() => {
    const el = videoRef.current
    if (!el || !playbackSrc)
      return

    let player = playerRef.current
    if (!player) {
      player = videojs(el, {
        fluid: true,
        controls: true,
        preload: 'auto',
        sources: [{ src: playbackSrc, type: 'video/mp4' }],
      })
      playerRef.current = player
    }
    else {
      player.src({ src: playbackSrc, type: 'video/mp4' })
    }

    return () => {
      if (subtitleBlobRef.current) {
        URL.revokeObjectURL(subtitleBlobRef.current)
        subtitleBlobRef.current = null
      }
      if (playerRef.current) {
        detachRemoteSubtitle(playerRef.current, remoteSubtitleElRef)
        playerRef.current.dispose()
        playerRef.current = null
      }
    }
  }, [playbackSrc])

  useEffect(() => {
    const player = playerRef.current
    if (!player)
      return

    detachRemoteSubtitle(player, remoteSubtitleElRef)

    if (subtitleBlobRef.current) {
      URL.revokeObjectURL(subtitleBlobRef.current)
      subtitleBlobRef.current = null
    }

    const blobUrl = subtitleQuery.data
    if (!blobUrl || !activeTrack)
      return

    subtitleBlobRef.current = blobUrl
    const trackEl = player.addRemoteTextTrack(
      {
        kind: 'subtitles',
        src: blobUrl,
        srclang: 'zh',
        label: activeTrack.label,
        default: true,
      },
      false,
    ) as RemoteTextTrackHandle
    remoteSubtitleElRef.current = trackEl
    trackEl.track.mode = 'showing'
  }, [subtitleQuery.data, activeTrack])

  const transcodePhase = transcodeStatusQuery.data?.phase
  const showTranscodeProgress = needsTranscode
    && transcodePhase !== VideoTranscodePhase.Ready
    && transcodePhase !== VideoTranscodePhase.Failed

  return (
    <div className="w-full max-w-5xl">
      {probeQuery.isError && (
        <Alert
          type="error"
          showIcon
          className="mb-3"
          title="无法分析视频"
          description={probeQuery.error.message}
        />
      )}
      {needsTranscode && transcodePhase === VideoTranscodePhase.Failed && (
        <Alert
          type="error"
          showIcon
          className="mb-3"
          title="转码失败"
          description={transcodeStatusQuery.data?.message ?? '请确认已安装 FFmpeg 后重试'}
          action={(
            <Button
              size="small"
              onClick={() => {
                transcodeStartRequested.current = false
                void startVideoTranscode({ path: videoPath }).then(() => {
                  transcodeStartRequested.current = true
                  void transcodeStatusQuery.refetch()
                })
              }}
            >
              重试
            </Button>
          )}
        />
      )}
      {showTranscodeProgress && (
        <div className="mb-3">
          <p className="mb-2 text-sm text-gray-600">
            {transcodeStatusQuery.data?.message ?? '正在准备转码…'}
            {probeQuery.data?.video_codec && (
              <span className="ml-2 text-gray-400">
                (
                {probeQuery.data.container ?? '未知容器'}
                {' / '}
                {probeQuery.data.video_codec}
                )
              </span>
            )}
          </p>
          <Progress
            percent={Math.round((transcodeStatusQuery.data?.progress ?? 0) * 100)}
            status="active"
          />
        </div>
      )}
      <div data-vjs-player className="relative aspect-video w-full">
        {!playbackSrc && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/5">
            <Spin tip={needsTranscode ? '等待转码完成…' : '加载视频…'} />
          </div>
        )}
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered vjs-fluid"
          playsInline
        />
      </div>
      {subtitleTracks.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">字幕</span>
          <Select
            allowClear
            placeholder="选择字幕"
            className="min-w-48"
            value={activeTrackPath}
            loading={subtitleQuery.isFetching}
            disabled={!playbackSrc}
            options={subtitleTracks.map(t => ({
              value: t.path,
              label: t.label,
            }))}
            onChange={(path) => {
              setActiveTrackPath(path ?? undefined)
            }}
          />
          {subtitleQuery.isFetching && <Spin size="small" />}
        </div>
      )}
    </div>
  )
}
