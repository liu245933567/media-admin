import type { VideoPlaySearch } from '@/lib/video-play-search'
import type { VideoFolderScanItem } from '@/types/api'
import { UnorderedListOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Button, Result, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LocalVideoPlayer } from '@/components/local-video-player'
import { VideoPlaylistDrawer } from '@/components/video-playlist-drawer'
import { buildVideoPlaySearch } from '@/lib/video-play-search'
import {
  scanVideoFolder,
  VIDEO_FOLDER_SCAN_GC_MS,
  VIDEO_FOLDER_SCAN_STALE_MS,
  videoFolderScanQueryKey,
} from '@/request'
import {
  getFileName,
  getParentPath,
  isPlayableSubtitleFile,
  joinVideoDir,
} from '@/utils/video-path'

export type { VideoPlaySearch }

export const Route = createFileRoute('/video-play')({
  validateSearch: (search: Record<string, unknown>): VideoPlaySearch => ({
    videoPath: typeof search.videoPath === 'string' ? search.videoPath : '',
    subtitles: typeof search.subtitles === 'string' ? search.subtitles : undefined,
    subtitle: typeof search.subtitle === 'string' ? search.subtitle : undefined,
    rootDir: typeof search.rootDir === 'string' ? search.rootDir : undefined,
  }),
  component: PageComponent,
})

function PageComponent() {
  const { videoPath, subtitles, subtitle, rootDir } = Route.useSearch()
  const navigate = useNavigate()
  const [playlistDrawerOpen, setPlaylistDrawerOpen] = useState(false)

  const videoName = useMemo(() => getFileName(videoPath), [videoPath])
  const parentDir = useMemo(() => getParentPath(videoPath), [videoPath])

  const subtitleTracks = useMemo(() => {
    if (!videoPath || !subtitles)
      return []
    return subtitles
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(isPlayableSubtitleFile)
      .map(name => ({
        label: name,
        path: joinVideoDir(videoPath, name),
      }))
  }, [videoPath, subtitles])

  const scanRoot = rootDir?.trim() ?? ''
  const playlistQuery = useQuery({
    queryKey: videoFolderScanQueryKey(scanRoot),
    queryFn: () => scanVideoFolder({ root_dir: scanRoot }),
    enabled: Boolean(scanRoot),
    staleTime: VIDEO_FOLDER_SCAN_STALE_MS,
    gcTime: VIDEO_FOLDER_SCAN_GC_MS,
  })

  const playlist = useMemo(
    () => playlistQuery.data?.items ?? [],
    [playlistQuery.data?.items],
  )
  const currentIndex = useMemo(
    () => playlist.findIndex(item => item.video_path === videoPath),
    [playlist, videoPath],
  )

  const prevItem = currentIndex > 0 ? playlist[currentIndex - 1] : undefined
  const nextItem
    = currentIndex >= 0 && currentIndex < playlist.length - 1
      ? playlist[currentIndex + 1]
      : undefined

  const goToItem = useCallback(
    (item: VideoFolderScanItem) => {
      void navigate({
        to: '/video-play',
        search: buildVideoPlaySearch(item, scanRoot || undefined),
      })
    },
    [navigate, scanRoot],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return
      if (e.key === 'ArrowLeft' && prevItem) {
        e.preventDefault()
        goToItem(prevItem)
      }
      if (e.key === 'ArrowRight' && nextItem) {
        e.preventDefault()
        goToItem(nextItem)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goToItem, prevItem, nextItem])

  const playlistNav = useMemo(
    () => (scanRoot
      ? {
          onPrev: prevItem ? () => goToItem(prevItem) : undefined,
          onNext: nextItem ? () => goToItem(nextItem) : undefined,
          prevDisabled: !prevItem,
          nextDisabled: !nextItem,
        }
      : undefined),
    [scanRoot, prevItem, nextItem, goToItem],
  )

  if (!videoPath) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <Result
          status="warning"
          title="缺少视频路径"
          subTitle="请从「本地视频」列表点击播放进入"
          extra={(
            <Link to="/video-folder-scan">
              <Button type="primary">返回本地视频</Button>
            </Link>
          )}
        />
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-black">
      <header className="z-20 flex shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-950/95 px-3 py-2 text-white backdrop-blur-sm">
        <Link to="/video-folder-scan">
          <Button
            type="text"
            className="text-white/85! hover:text-white!"
          >
            返回
          </Button>
        </Link>
        <div className="min-w-0 flex-1 px-1">
          <Typography.Text
            ellipsis={{ tooltip: videoName }}
            className="block text-sm font-medium text-white"
          >
            {videoName}
          </Typography.Text>
          {parentDir && (
            <Typography.Text
              ellipsis={{ tooltip: parentDir }}
              className="block text-xs text-white/45"
            >
              {parentDir}
            </Typography.Text>
          )}
        </div>
        {scanRoot
          ? (
              <Button
                type="text"
                icon={<UnorderedListOutlined />}
                className="text-white/85! hover:text-white!"
                onClick={() => setPlaylistDrawerOpen(true)}
              >
                <span className="hidden sm:inline">列表</span>
              </Button>
            )
          : (
              <Link to="/video-folder-scan">
                <Button
                  type="text"
                  icon={<UnorderedListOutlined />}
                  className="text-white/85! hover:text-white!"
                >
                  <span className="hidden sm:inline">列表</span>
                </Button>
              </Link>
            )}
      </header>

      {scanRoot && (
        <VideoPlaylistDrawer
          open={playlistDrawerOpen}
          onClose={() => setPlaylistDrawerOpen(false)}
          items={playlist}
          currentVideoPath={videoPath}
          loading={playlistQuery.isFetching}
          rootDir={scanRoot}
          onSelect={(item) => {
            setPlaylistDrawerOpen(false)
            goToItem(item)
          }}
        />
      )}

      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <LocalVideoPlayer
          key={videoPath}
          videoPath={videoPath}
          subtitleTracks={subtitleTracks}
          defaultSubtitleLabel={subtitle}
          fillViewport
          playlistNav={playlistNav}
        />
      </main>
    </div>
  )
}
