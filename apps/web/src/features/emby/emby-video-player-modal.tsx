import type { EmbyLibraryItem, EmbyPlaybackMethod, EmbyPlaybackProgressReq } from '@/api'
import type { VideoJsPlaybackEvent } from '@/components/video-js-player'
import { Alert, Button, Dropdown, Modal, Spinner, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  buildEmbySubtitleSrc,
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
import { VideoJsPlayer } from '@/components/video-js-player'
import { EmbySubtitleSearchModal } from '@/features/emby/emby-subtitle-search-modal'

export interface EmbyVideoPlayerModalProps {
  itemId?: string
  open: boolean
  playlist?: EmbyLibraryItem[]
  title?: string
  onItemChange?: (item: EmbyLibraryItem) => void
  onOpenChange: (open: boolean) => void
}

interface PlaybackState {
  itemId: string
  playbackError?: string
  usingFallback: boolean
}

function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * 10_000_000))
}

function ticksToSeconds(ticks: number | null | undefined): number | undefined {
  if (!ticks || ticks <= 0)
    return undefined
  return ticks / 10_000_000
}

function formatRuntime(ticks?: number | null) {
  if (!ticks)
    return undefined
  const minutes = Math.round(ticks / 10_000_000 / 60)
  if (minutes >= 60)
    return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`
  return `${minutes}分钟`
}

function itemTypeLabel(itemType: string) {
  const map: Record<string, string> = {
    Episode: '剧集',
    Movie: '电影',
    Video: '视频',
  }
  return map[itemType] ?? itemType
}

function playlistTitle(item: EmbyLibraryItem) {
  if (item.parent_index_number != null && item.index_number != null)
    return `S${item.parent_index_number}:E${item.index_number} · ${item.name}`
  if (item.index_number != null)
    return `${item.index_number}. ${item.name}`
  return item.name
}

function playlistMeta(item: EmbyLibraryItem, index: number, total: number) {
  return [
    `${index + 1}/${total}`,
    itemTypeLabel(item.item_type),
    item.production_year,
    formatRuntime(item.run_time_ticks),
  ].filter(Boolean).join(' · ')
}

function uniquePlayableItems(items: EmbyLibraryItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!item.can_play || seen.has(item.id))
      return false
    seen.add(item.id)
    return true
  })
}

function createPlaySessionId(itemId: string) {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `media-admin-${itemId}-${randomPart}`
}

export function EmbyVideoPlayerModal({
  itemId,
  open,
  playlist,
  title,
  onItemChange,
  onOpenChange,
}: EmbyVideoPlayerModalProps) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    itemId: '',
    usingFallback: false,
  })
  const [subtitleSearchOpen, setSubtitleSearchOpen] = useState(false)

  const resolvedItemId = itemId ?? ''
  const scopedPlaybackState = playbackState.itemId === resolvedItemId
    ? playbackState
    : { itemId: resolvedItemId, usingFallback: false }
  const { playbackError, usingFallback } = scopedPlaybackState
  const playSessionRef = useRef<{ itemId: string, id: string }>({
    itemId: '',
    id: '',
  })
  if (resolvedItemId && playSessionRef.current.itemId !== resolvedItemId) {
    playSessionRef.current = {
      itemId: resolvedItemId,
      id: createPlaySessionId(resolvedItemId),
    }
  }
  const playSessionId = resolvedItemId ? playSessionRef.current.id : undefined

  const playlistItems = useMemo(
    () => uniquePlayableItems(playlist ?? []),
    [playlist],
  )

  const currentIndex = playlistItems.findIndex(item => item.id === resolvedItemId)
  const prevItem = currentIndex > 0 ? playlistItems[currentIndex - 1] : undefined
  const nextItem = currentIndex >= 0 && currentIndex < playlistItems.length - 1
    ? playlistItems[currentIndex + 1]
    : undefined
  const hasPlaylist = playlistItems.length > 1

  const itemQuery = useQuery({
    queryKey: resolvedItemId ? getGetItemEmbyQueryKey(resolvedItemId) : ['emby-item', 'missing'],
    queryFn: () => getItemEmby(resolvedItemId),
    enabled: Boolean(open && resolvedItemId),
  })

  const playbackInfoQuery = useQuery({
    queryKey: resolvedItemId
      ? getGetPlaybackInfoEmbyQueryKey({ item_id: resolvedItemId })
      : ['emby-playback-info', 'missing'],
    queryFn: () => getPlaybackInfoEmby({ item_id: resolvedItemId }),
    enabled: Boolean(open && resolvedItemId),
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
  const directStrmUrl = playbackInfoQuery.data?.direct_url
  const playbackMethod: EmbyPlaybackMethod = isDirectStrm
    ? 'direct_play'
    : usingFallback
      ? 'transcode'
      : 'direct_stream'

  const playbackRequest = useCallback((event: VideoJsPlaybackEvent) => ({
    item_id: resolvedItemId,
    position_ticks: secondsToTicks(event.currentTime),
    play_session_id: playSessionId,
    is_paused: event.isPaused,
    media_source_id: playbackInfoQuery.data?.media_source_id ?? resolvedItemId,
    play_method: playbackMethod,
  }), [playSessionId, playbackInfoQuery.data?.media_source_id, playbackMethod, resolvedItemId])

  const source = useMemo(() => {
    if (!resolvedItemId || !playbackInfoQuery.data)
      return undefined

    if (isDirectStrm && directStrmUrl) {
      return {
        src: directStrmUrl,
        type: undefined,
      }
    }

    if (usingFallback) {
      return {
        src: buildEmbyTranscodedVideoSrc(resolvedItemId, playSessionId),
        type: 'video/mp4',
      }
    }

    return {
      src: buildEmbyVideoSrc(resolvedItemId, playSessionId),
      type: 'video/mp4',
    }
  }, [directStrmUrl, isDirectStrm, playSessionId, playbackInfoQuery.data, resolvedItemId, usingFallback])

  const textTracks = useMemo(() => {
    if (!resolvedItemId)
      return []
    return (playbackInfoQuery.data?.subtitle_tracks ?? []).map(track => ({
      id: `${track.media_source_id}-${track.index}`,
      label: track.label,
      language: track.language ?? undefined,
      default: track.is_default,
      src: buildEmbySubtitleSrc(resolvedItemId, track.media_source_id, track.index),
    }))
  }, [playbackInfoQuery.data?.subtitle_tracks, resolvedItemId])

  const loadingLabel = usingFallback
    ? '正在加载 Emby 转码流...'
    : isDirectStrm
      ? '正在加载 strm 直链...'
      : '正在加载 Emby 原始流...'

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setPlaybackState({
        itemId: resolvedItemId,
        usingFallback: false,
      })
    }
    onOpenChange(nextOpen)
  }

  function handleSelectItem(item: EmbyLibraryItem) {
    if (item.id === resolvedItemId)
      return

    setPlaybackState({
      itemId: item.id,
      usingFallback: false,
    })
    onItemChange?.(item)
  }

  function handlePlaybackError(message: string) {
    if (!usingFallback && !isDirectStrm) {
      setPlaybackState({
        itemId: resolvedItemId,
        usingFallback: true,
      })
      return
    }

    setPlaybackState({
      itemId: resolvedItemId,
      playbackError: message,
      usingFallback,
    })
  }

  const heading = itemQuery.data?.name ?? title ?? 'Emby 播放'

  if (!open)
    return null

  return (
    <>
      <Modal.Backdrop
        isOpen={open}
        onOpenChange={handleOpenChange}
        variant="opaque"
        className="bg-black"
      >
        <Modal.Container size="full" scroll="inside" className="h-dvh max-h-dvh">
          <Modal.Dialog className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-black p-0 text-white">
            <Modal.Header className="z-20 flex-row items-center gap-3 border-b border-white/10 bg-zinc-950/95 px-3 py-2 backdrop-blur-sm">
              <Modal.Heading className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white" title={heading}>
                  {heading}
                </span>
                <span className="block truncate text-xs font-normal text-white/45">
                  {itemQuery.isFetching ? '加载资源信息...' : itemQuery.data?.item_type ?? 'Emby'}
                </span>
              </Modal.Heading>
              <Tooltip delay={0}>
                <Button
                  isIconOnly
                  aria-label="查询下载字幕"
                  className="text-white/85 hover:bg-white/10 hover:text-white"
                  isDisabled={!resolvedItemId}
                  variant="ghost"
                  onPress={() => setSubtitleSearchOpen(true)}
                >
                  <Icon className="size-5" icon="lucide:captions" />
                </Button>
                <Tooltip.Content>查询字幕</Tooltip.Content>
              </Tooltip>
              {hasPlaylist && (
                <div className="flex shrink-0 items-center gap-1">
                  <Tooltip delay={0}>
                    <Button
                      isIconOnly
                      aria-label="播放上一个"
                      className="text-white/85 hover:bg-white/10 hover:text-white disabled:text-white/25"
                      isDisabled={!prevItem}
                      variant="ghost"
                      onPress={() => {
                        if (prevItem)
                          handleSelectItem(prevItem)
                      }}
                    >
                      <Icon className="size-5" icon="lucide:skip-back" />
                    </Button>
                    <Tooltip.Content>上一个</Tooltip.Content>
                  </Tooltip>
                  <Dropdown>
                    <Dropdown.Trigger>
                      <Button
                        aria-label="选择播放列表项目"
                        className="max-w-[11rem] text-white/85 hover:bg-white/10 hover:text-white sm:max-w-[15rem]"
                        variant="ghost"
                      >
                        <Icon className="size-4 shrink-0" icon="lucide:list-video" />
                        <span className="truncate text-xs">
                          {currentIndex >= 0 ? `${currentIndex + 1}/${playlistItems.length}` : `${playlistItems.length} 项`}
                        </span>
                      </Button>
                    </Dropdown.Trigger>
                    <Dropdown.Popover className="w-80 max-w-[calc(100vw-1rem)]">
                      <Dropdown.Menu
                        className="max-h-[min(60vh,26rem)] overflow-y-auto"
                        selectedKeys={resolvedItemId ? [resolvedItemId] : []}
                        selectionMode="single"
                        onAction={(key) => {
                          const selectedItem = playlistItems.find(item => item.id === String(key))
                          if (selectedItem)
                            handleSelectItem(selectedItem)
                        }}
                      >
                        {playlistItems.map((item, index) => (
                          <Dropdown.Item key={item.id} id={item.id} textValue={playlistTitle(item)}>
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <Dropdown.ItemIndicator />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium" title={playlistTitle(item)}>
                                  {playlistTitle(item)}
                                </div>
                                <div className="truncate text-xs text-muted">
                                  {playlistMeta(item, index, playlistItems.length)}
                                </div>
                              </div>
                            </div>
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                  <Tooltip delay={0}>
                    <Button
                      isIconOnly
                      aria-label="播放下一个"
                      className="text-white/85 hover:bg-white/10 hover:text-white disabled:text-white/25"
                      isDisabled={!nextItem}
                      variant="ghost"
                      onPress={() => {
                        if (nextItem)
                          handleSelectItem(nextItem)
                      }}
                    >
                      <Icon className="size-5" icon="lucide:skip-forward" />
                    </Button>
                    <Tooltip.Content>下一个</Tooltip.Content>
                  </Tooltip>
                </div>
              )}
              <Button
                isIconOnly
                aria-label="关闭播放"
                className="text-white/85 hover:bg-white/10 hover:text-white"
                variant="ghost"
                onPress={() => handleOpenChange(false)}
              >
                <Icon className="size-5" icon="lucide:x" />
              </Button>
            </Modal.Header>
            <Modal.Body className="relative flex min-h-0 flex-1 overflow-hidden p-0">
              {!resolvedItemId
                ? (
                    <div className="flex h-full w-full items-center justify-center bg-black p-6 text-center text-white">
                      <div className="flex max-w-md flex-col items-center gap-3">
                        <Icon className="size-10 text-warning" icon="lucide:triangle-alert" />
                        <h2 className="m-0 text-lg font-semibold">缺少 Emby 资源 ID</h2>
                        <p className="m-0 text-sm text-white/60">请选择一个可播放资源</p>
                      </div>
                    </div>
                  )
                : itemQuery.isPending
                  ? (
                      <LoadingState label="加载 Emby 资源..." />
                    )
                  : itemQuery.isError
                    ? (
                        <ErrorState title="无法加载 Emby 资源" message={itemQuery.error.message} />
                      )
                    : playbackInfoQuery.isPending
                      ? (
                          <LoadingState label="准备 Emby 播放信息..." />
                        )
                      : playbackInfoQuery.isError
                        ? (
                            <ErrorState title="无法准备 Emby 播放" message={playbackInfoQuery.error.message} />
                          )
                        : (
                            <div className="relative flex h-full min-h-0 w-full flex-1 flex-col">
                              {(usingFallback || playbackError) && (
                                <div className="absolute top-0 right-0 left-0 z-30 space-y-1 p-2">
                                  {usingFallback && (
                                    <Alert status="warning" className="border-white/10 bg-zinc-900/90 text-white">
                                      <Alert.Indicator />
                                      <Alert.Content>
                                        <Alert.Title>正在使用 Emby 转码播放</Alert.Title>
                                        <Alert.Description>原始流无法直接播放，已切换到后台转码流。</Alert.Description>
                                      </Alert.Content>
                                    </Alert>
                                  )}
                                  {playbackError && (
                                    <Alert status="danger" className="border-white/10 bg-zinc-900/90 text-white">
                                      <Alert.Indicator />
                                      <Alert.Content>
                                        <Alert.Title>{usingFallback ? 'Emby 转码流无法播放' : '视频流无法播放'}</Alert.Title>
                                        <Alert.Description>{playbackError}</Alert.Description>
                                      </Alert.Content>
                                    </Alert>
                                  )}
                                </div>
                              )}
                              <VideoJsPlayer
                                key={`${resolvedItemId}-${usingFallback ? 'fallback' : 'primary'}`}
                                autoPlay
                                fillViewport
                                source={source}
                                initialTime={ticksToSeconds(playbackInfoQuery.data?.playback_position_ticks)}
                                loadingLabel={loadingLabel}
                                textTracks={textTracks}
                                onError={handlePlaybackError}
                                onPlaybackStart={(event) => {
                                  playbackStartMutation.mutate(playbackRequest(event))
                                }}
                                onPlaybackProgress={(event) => {
                                  playbackProgressMutation.mutate(playbackRequest(event))
                                }}
                                onPlaybackStopped={(event) => {
                                  playbackStoppedMutation.mutate(playbackRequest(event))
                                }}
                                playlistNav={hasPlaylist
                                  ? {
                                      nextDisabled: !nextItem,
                                      prevDisabled: !prevItem,
                                      onNext: () => {
                                        if (nextItem)
                                          handleSelectItem(nextItem)
                                      },
                                      onPrev: () => {
                                        if (prevItem)
                                          handleSelectItem(prevItem)
                                      },
                                    }
                                  : undefined}
                              />
                            </div>
                          )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      {resolvedItemId && (
        <EmbySubtitleSearchModal
          itemId={resolvedItemId}
          mediaSourceId={playbackInfoQuery.data?.media_source_id}
          open={subtitleSearchOpen}
          onDownloaded={() => {
            void playbackInfoQuery.refetch()
          }}
          onOpenChange={setSubtitleSearchOpen}
        />
      )}
    </>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
      <div className="flex flex-col items-center gap-2 text-white/70">
        <Spinner color="current" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  )
}

function ErrorState({ title, message }: { title: string, message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-black p-6 text-center text-white">
      <div className="flex max-w-md flex-col items-center gap-3">
        <Icon className="size-10 text-warning" icon="lucide:circle-alert" />
        <h2 className="m-0 text-lg font-semibold">{title}</h2>
        <p className="m-0 text-sm text-white/60">{message}</p>
      </div>
    </div>
  )
}
