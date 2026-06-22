import type { EmbyLibraryItem } from '@/api'
import { Button, Card, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import {
  buildEmbyImageSrc,
  getGetItemEmbyQueryKey,
  getItemEmby,
  getListItemsEmbyQueryKey,
  listItemsEmby,
} from '@/api'

export const Route = createFileRoute('/emby-detail')({
  validateSearch: (search: Record<string, unknown>) => ({
    itemId: typeof search.itemId === 'string' ? search.itemId : '',
    title: typeof search.title === 'string' ? search.title : undefined,
  }),
  component: EmbyDetailPage,
})

function formatRuntime(ticks?: number | null) {
  if (!ticks)
    return undefined
  const minutes = Math.round(ticks / 10_000_000 / 60)
  if (minutes >= 60)
    return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`
  return `${minutes}分钟`
}

function formatDate(value?: string | null) {
  if (!value)
    return undefined
  return value.slice(0, 10)
}

function itemMeta(item: EmbyLibraryItem) {
  return [
    item.production_year,
    formatRuntime(item.run_time_ticks),
    item.official_rating,
    item.community_rating ? `评分 ${item.community_rating.toFixed(1)}` : undefined,
  ].filter(Boolean).join(' · ')
}

function episodeTitle(item: EmbyLibraryItem) {
  if (item.parent_index_number != null && item.index_number != null)
    return `S${item.parent_index_number}:E${item.index_number} · ${item.name}`
  if (item.index_number != null)
    return `${item.index_number}. ${item.name}`
  return item.name
}

function EpisodeRow({ item }: { item: EmbyLibraryItem }) {
  const navigate = useNavigate()
  const imageSrc = item.image_tag ? buildEmbyImageSrc(item.id, item.image_tag, 'Primary') : undefined

  return (
    <button
      type="button"
      className="group grid w-full grid-cols-[9rem_minmax(0,1fr)] gap-4 rounded-md p-2 text-left outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/60 sm:grid-cols-[12rem_minmax(0,1fr)]"
      onClick={() => {
        void navigate({ to: '/emby-play', search: { itemId: item.id } })
      }}
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-[#2f2f2f]">
        {imageSrc
          ? <img alt="" className="h-full w-full object-cover" loading="lazy" src={imageSrc} />
          : <div className="flex h-full items-center justify-center text-zinc-500"><Icon className="size-8" icon="lucide:clapperboard" /></div>}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
          <div className="flex size-9 items-center justify-center rounded-full bg-white/90 text-black">
            <Icon className="ml-0.5 size-4" icon="lucide:play" />
          </div>
        </div>
      </div>
      <div className="min-w-0 py-1">
        <div className="truncate text-sm font-semibold text-zinc-100" title={episodeTitle(item)}>
          {episodeTitle(item)}
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          {[formatDate(item.premiere_date), formatRuntime(item.run_time_ticks)].filter(Boolean).join(' · ')}
        </div>
        {item.overview && (
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-zinc-400">
            {item.overview}
          </p>
        )}
      </div>
    </button>
  )
}

function EmbyDetailPage() {
  const { itemId, title } = Route.useSearch()
  const navigate = useNavigate()

  const itemQuery = useQuery({
    queryKey: itemId ? getGetItemEmbyQueryKey(itemId) : ['emby-detail', 'missing'],
    queryFn: () => getItemEmby(itemId),
    enabled: Boolean(itemId),
  })

  const item = itemQuery.data
  const isSeries = item?.item_type === 'Series'

  const seasonsQuery = useQuery({
    queryKey: getListItemsEmbyQueryKey({
      parent_id: itemId,
      include_item_types: 'Season',
      recursive: false,
      limit: 100,
    }),
    queryFn: () => listItemsEmby({
      parent_id: itemId,
      include_item_types: 'Season',
      recursive: false,
      limit: 100,
    }),
    enabled: Boolean(itemId && isSeries),
  })

  const seasonItems = useMemo(
    () => seasonsQuery.data?.items ?? [],
    [seasonsQuery.data?.items],
  )

  const episodeQueries = useQueries({
    queries: seasonItems.map(season => ({
      queryKey: getListItemsEmbyQueryKey({
        parent_id: season.id,
        include_item_types: 'Episode',
        recursive: true,
        limit: 200,
      }),
      queryFn: () => listItemsEmby({
        parent_id: season.id,
        include_item_types: 'Episode',
        recursive: true,
        limit: 200,
      }),
      enabled: Boolean(itemId && isSeries),
    })),
  })

  const posterSrc = item?.image_tag ? buildEmbyImageSrc(item.id, item.image_tag, 'Primary') : undefined
  const backdropSrc = item?.backdrop_image_tag
    ? buildEmbyImageSrc(item.id, item.backdrop_image_tag, 'Backdrop')
    : posterSrc

  if (!itemId) {
    return (
      <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-var(--navbar-height))] items-center justify-center bg-[#1f1f1f] p-6 text-zinc-100">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <Icon className="size-10 text-warning" icon="lucide:triangle-alert" />
          <div>
            <h1 className="m-0 text-xl font-semibold">缺少媒体 ID</h1>
            <p className="mt-2 text-sm text-zinc-400">请从媒体库列表进入详情页</p>
          </div>
          <Link to="/emby">
            <Button>返回 Emby</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100dvh-var(--navbar-height))] bg-[#1f1f1f] text-zinc-100">
      {itemQuery.isPending
        ? (
            <div className="flex h-[60vh] items-center justify-center gap-2 text-sm text-zinc-400">
              <Spinner color="current" size="sm" />
              加载媒体详情...
            </div>
          )
        : itemQuery.isError
          ? (
              <div className="px-6 py-8 md:px-10">
                <Card className="bg-[#2b2b2b] text-zinc-100">
                  <Card.Content className="flex flex-col items-center gap-3 py-12 text-center">
                    <Icon className="size-10 text-warning" icon="lucide:circle-alert" />
                    <div>
                      <h2 className="m-0 text-base font-semibold">无法加载媒体详情</h2>
                      <p className="mt-1 text-sm text-zinc-400">{itemQuery.error.message}</p>
                    </div>
                    <Button variant="secondary" onPress={() => itemQuery.refetch()}>
                      重试
                    </Button>
                  </Card.Content>
                </Card>
              </div>
            )
          : item && (
            <>
              <section className="relative min-h-[26rem] overflow-hidden">
                {backdropSrc && (
                  <img
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover opacity-45"
                    src={backdropSrc}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-[#1f1f1f] via-[#1f1f1f]/80 to-[#1f1f1f]/35" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#1f1f1f] via-transparent to-black/35" />
                <div className="relative mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-6 py-7 md:flex-row md:items-end md:px-10 md:pt-12">
                  <div className="w-36 shrink-0 overflow-hidden rounded-md bg-[#2f2f2f] ring-1 ring-white/10 md:w-52">
                    {posterSrc
                      ? <img alt="" className="aspect-[2/3] h-full w-full object-cover" src={posterSrc} />
                      : <div className="flex aspect-[2/3] items-center justify-center text-zinc-500"><Icon className="size-14" icon="lucide:film" /></div>}
                  </div>
                  <div className="min-w-0 max-w-4xl pb-1">
                    <Button
                      variant="ghost"
                      className="mb-4 -ml-3 text-zinc-300 hover:bg-white/10 hover:text-white"
                      onPress={() => window.history.back()}
                    >
                      <Icon className="size-4" icon="lucide:chevron-left" />
                      返回
                    </Button>
                    <h1 className="m-0 text-4xl font-bold tracking-tight text-white md:text-5xl">
                      {item.name || title}
                    </h1>
                    <p className="mt-3 text-sm text-zinc-300">
                      {itemMeta(item)}
                    </p>
                    {item.overview && (
                      <p className="mt-5 max-w-3xl text-sm leading-6 text-zinc-300 md:text-base">
                        {item.overview}
                      </p>
                    )}
                    {item.can_play && (
                      <Button
                        className="mt-6 bg-white text-black hover:bg-zinc-200"
                        onPress={() => {
                          void navigate({ to: '/emby-play', search: { itemId: item.id } })
                        }}
                      >
                        <Icon className="ml-0.5 size-5" icon="lucide:play" />
                        播放
                      </Button>
                    )}
                  </div>
                </div>
              </section>

              {isSeries && (
                <section className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-6 pb-10 md:px-10">
                  <h2 className="m-0 text-xl font-bold text-zinc-100">剧集</h2>
                  {seasonsQuery.isPending
                    ? (
                        <div className="flex h-32 items-center justify-center gap-2 text-sm text-zinc-400">
                          <Spinner color="current" size="sm" />
                          加载剧集...
                        </div>
                      )
                    : seasonItems.length
                      ? (
                          <div className="flex flex-col gap-7">
                            {seasonItems.map((season, index) => {
                              const episodes = episodeQueries[index]?.data?.items ?? []
                              return (
                                <div key={season.id} className="flex flex-col gap-2">
                                  <h3 className="m-0 text-base font-semibold text-zinc-200">{season.name}</h3>
                                  <div className="flex flex-col gap-1">
                                    {episodes.map(episode => (
                                      <EpisodeRow key={episode.id} item={episode} />
                                    ))}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      : (
                          <Card className="bg-[#2b2b2b] text-zinc-100">
                            <Card.Content className="py-10 text-center text-sm text-zinc-400">
                              暂无剧集
                            </Card.Content>
                          </Card>
                        )}
                </section>
              )}
            </>
          )}
    </div>
  )
}
