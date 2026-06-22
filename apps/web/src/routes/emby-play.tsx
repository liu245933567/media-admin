import { Button, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  buildEmbyTranscodedVideoSrc,
  buildEmbyVideoSrc,
  getGetItemEmbyQueryKey,
  getItemEmby,
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

  const itemQuery = useQuery({
    queryKey: itemId ? getGetItemEmbyQueryKey(itemId) : ['emby-item', 'missing'],
    queryFn: () => getItemEmby(itemId),
    enabled: Boolean(itemId),
  })

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
            : (
                <LocalVideoPlayer
                  key={itemId}
                  videoPath={itemId}
                  remoteSrc={buildEmbyVideoSrc(itemId)}
                  remoteMimeType="video/mp4"
                  fallbackRemoteSrc={buildEmbyTranscodedVideoSrc(itemId)}
                  fallbackRemoteMimeType="video/mp4"
                  subtitleTracks={[]}
                  fillViewport
                />
              )}
      </main>
    </div>
  )
}
