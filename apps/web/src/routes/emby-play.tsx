import type { EmbyPlaybackMethod, EmbyPlaybackProgressReq } from '@/api'
import type { RemotePlaybackProgressEvent } from '@/components/local-video-player'
import { Button, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import {
  buildEmbyTranscodedVideoSrc,
  buildEmbyVideoSrc,
  getGetItemEmbyQueryKey,
  getGetPlaybackInfoEmbyQueryKey,
  getItemEmby,
  getPlaybackInfoEmby,
  progressPlaybackEmby,
  startPlaybackEmby,
  stoppedPlaybackEmby,
} from '@/api'
import { LocalVideoPlayer } from '@/components/local-video-player'

export const Route = createFileRoute('/emby-play')({
  validateSearch: (search: Record<string, unknown>) => ({
    itemId: typeof search.itemId === 'string' ? search.itemId : '',
  }),
  component: EmbyPlayPage,
})

function EmbyPlayPage() {
  const { itemId } = Route.useSearch()
  const [usingFallback, setUsingFallback] = useState(false)

  const itemQuery = useQuery({
    queryKey: itemId ? getGetItemEmbyQueryKey(itemId) : ['emby-item', 'missing'],
    queryFn: () => getItemEmby(itemId),
    enabled: Boolean(itemId),
  })

  const playbackInfoQuery = useQuery({
    queryKey: itemId ? getGetPlaybackInfoEmbyQueryKey({ item_id: itemId }) : ['emby-playback-info', 'missing'],
    queryFn: () => getPlaybackInfoEmby({ item_id: itemId }),
    enabled: Boolean(itemId),
  })

  const playbackStartMutation = useMutation({
    mutationFn: (req: EmbyPlaybackProgressReq) => startPlaybackEmby(req),
  })
  const playbackProgressMutation = useMutation({
    mutationFn: (req: EmbyPlaybackProgressReq) => progressPlaybackEmby(req),
  })
  const playbackStoppedMutation = useMutation({
    mutationFn: (req: EmbyPlaybackProgressReq) => stoppedPlaybackEmby(req),
  })

  const isDirectStrm = playbackInfoQuery.data?.is_strm === true && Boolean(playbackInfoQuery.data.direct_url)
  const playbackMethod: EmbyPlaybackMethod = isDirectStrm
    ? 'direct_play'
    : usingFallback
      ? 'transcode'
      : 'direct_stream'

  const playbackRequest = useCallback((event: RemotePlaybackProgressEvent) => ({
    item_id: itemId,
    position_ticks: secondsToTicks(event.currentTime),
    is_paused: event.isPaused,
    media_source_id: playbackInfoQuery.data?.media_source_id ?? itemId,
    play_method: playbackMethod,
  }), [itemId, playbackInfoQuery.data?.media_source_id, playbackMethod])

  const remoteSrc = useMemo(() => {
    if (isDirectStrm && playbackInfoQuery.data?.direct_url)
      return playbackInfoQuery.data.direct_url
    return buildEmbyVideoSrc(itemId)
  }, [isDirectStrm, itemId, playbackInfoQuery.data?.direct_url])

  if (!itemId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <Icon className="size-10 text-warning" icon="lucide:triangle-alert" />
          <div>
            <h1 className="m-0 text-xl font-semibold">缺少 Emby 资源 ID</h1>
            <p className="mt-2 text-sm text-muted">请从 Emby 资源列表点击播放进入</p>
          </div>
          <Link to="/emby">
            <Button>返回 Emby</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-black">
      <header className="z-20 flex shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-950/95 px-3 py-2 text-white backdrop-blur-sm">
        <Link to="/emby">
          <Button
            variant="ghost"
            className="text-white/85 hover:text-white"
          >
            返回
          </Button>
        </Link>
        <div className="min-w-0 flex-1 px-1">
          <div className="block truncate text-sm font-medium text-white" title={itemQuery.data?.name}>
            {itemQuery.data?.name ?? 'Emby 播放'}
          </div>
          <div className="block truncate text-xs text-white/45">
            {itemQuery.isFetching ? '加载资源信息...' : itemQuery.data?.item_type}
          </div>
        </div>
      </header>
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {itemQuery.isPending
          ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
                <div className="flex flex-col items-center gap-2 text-white/70">
                  <Spinner color="current" />
                  <span className="text-sm">加载 Emby 资源...</span>
                </div>
              </div>
            )
          : itemQuery.isError
            ? (
                <div className="flex h-full items-center justify-center bg-black p-6 text-center text-white">
                  <div className="flex max-w-md flex-col items-center gap-3">
                    <Icon className="size-10 text-warning" icon="lucide:circle-alert" />
                    <h1 className="m-0 text-lg font-semibold">无法加载 Emby 资源</h1>
                    <p className="m-0 text-sm text-white/60">{itemQuery.error.message}</p>
                  </div>
                </div>
              )
            : playbackInfoQuery.isPending
              ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
                    <div className="flex flex-col items-center gap-2 text-white/70">
                      <Spinner color="current" />
                      <span className="text-sm">准备 Emby 播放信息...</span>
                    </div>
                  </div>
                )
              : playbackInfoQuery.isError
                ? (
                    <div className="flex h-full items-center justify-center bg-black p-6 text-center text-white">
                      <div className="flex max-w-md flex-col items-center gap-3">
                        <Icon className="size-10 text-warning" icon="lucide:circle-alert" />
                        <h1 className="m-0 text-lg font-semibold">无法准备 Emby 播放</h1>
                        <p className="m-0 text-sm text-white/60">{playbackInfoQuery.error.message}</p>
                      </div>
                    </div>
                  )
                : (
                    <LocalVideoPlayer
                      key={itemId}
                      videoPath={itemId}
                      remoteSrc={remoteSrc}
                      remoteMimeType={isDirectStrm ? undefined : 'video/mp4'}
                      fallbackRemoteSrc={isDirectStrm ? undefined : buildEmbyTranscodedVideoSrc(itemId)}
                      fallbackRemoteMimeType={isDirectStrm ? undefined : 'video/mp4'}
                      remoteInitialTime={ticksToSeconds(playbackInfoQuery.data?.playback_position_ticks)}
                      remoteLoadingLabel={isDirectStrm ? '正在加载 strm 直链...' : '正在加载 Emby 原始流...'}
                      onRemoteFallbackChange={setUsingFallback}
                      onRemotePlaybackStart={(event) => {
                        playbackStartMutation.mutate(playbackRequest(event))
                      }}
                      onRemotePlaybackProgress={(event) => {
                        playbackProgressMutation.mutate(playbackRequest(event))
                      }}
                      onRemotePlaybackStopped={(event) => {
                        playbackStoppedMutation.mutate(playbackRequest(event))
                      }}
                      subtitleTracks={[]}
                      fillViewport
                    />
                  )}
      </main>
    </div>
  )
}

function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * 10_000_000))
}

function ticksToSeconds(ticks: number | null | undefined): number | undefined {
  if (!ticks || ticks <= 0)
    return undefined
  return ticks / 10_000_000
}
