import type { ReactNode } from 'react'
import type { EmbyLibraryItem } from '@/api'
import { Button, Card, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  buildEmbyImageSrc,
  getGetItemEmbyQueryKey,
  getItemEmby,
  getListItemsEmbyQueryKey,
  listItemsEmby,
} from '@/api'
import { BasePagination } from '@/components/base-pagination'
import { EmbyVideoPlayerModal } from '@/features/emby/emby-video-player-modal'

const DEFAULT_EPISODE_PAGE_SIZE = 50
const EPISODE_PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const
const MAX_VISIBLE_PEOPLE = 12

interface SeasonEpisodePage {
  page: number
  pageSize: number
}

export const Route = createFileRoute('/emby-detail')({
  validateSearch: (search: Record<string, unknown>) => ({
    itemId: typeof search.itemId === 'string' ? search.itemId : '',
    title: typeof search.title === 'string' ? search.title : undefined,
    sectionId: typeof search.sectionId === 'string' ? search.sectionId : undefined,
    sectionName: typeof search.sectionName === 'string' ? search.sectionName : undefined,
    collectionType: typeof search.collectionType === 'string' ? search.collectionType : undefined,
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

function getSeasonEpisodePage(
  pages: Record<string, SeasonEpisodePage>,
  seasonId: string,
): SeasonEpisodePage {
  return pages[seasonId] ?? {
    page: 1,
    pageSize: DEFAULT_EPISODE_PAGE_SIZE,
  }
}

function personTypeLabel(type?: string | null) {
  const map: Record<string, string> = {
    Actor: '演员',
    Director: '导演',
    GuestStar: '客串',
    Producer: '制片',
    Writer: '编剧',
  }
  return type ? map[type] ?? type : '演职员'
}

function buildLibrarySearch(search: {
  collectionType?: string
  genre?: string
  personId?: string
  personName?: string
  q?: string
  sectionId?: string
  sectionName?: string
  tagFilter?: string
}) {
  return {
    sectionId: search.sectionId ?? '',
    name: search.sectionName ?? '媒体库',
    collectionType: search.collectionType,
    q: search.q ?? '',
    personId: search.personId ?? '',
    personName: search.personName ?? '',
    genre: search.genre ?? '',
    tagFilter: search.tagFilter ?? '',
  }
}

function MetadataPill({
  children,
  search,
}: {
  children: ReactNode
  search: ReturnType<typeof buildLibrarySearch>
}) {
  return (
    <Link
      to="/emby-library"
      search={search}
      className="inline-flex max-w-full items-center rounded-full border border-border bg-surface-secondary px-2.5 py-1 text-xs text-muted no-underline hover:border-accent/35 hover:bg-surface hover:text-foreground"
    >
      <span className="truncate">{children}</span>
    </Link>
  )
}

function MetadataSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function EpisodeRow({ item, onPlay }: { item: EmbyLibraryItem, onPlay: (item: EmbyLibraryItem) => void }) {
  const imageSrc = item.image_tag ? buildEmbyImageSrc(item.id, item.image_tag, 'Primary') : undefined

  return (
    <button
      type="button"
      className="group grid w-full grid-cols-[9rem_minmax(0,1fr)] gap-4 rounded-md p-2 text-left outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent/60 sm:grid-cols-[12rem_minmax(0,1fr)]"
      onClick={() => onPlay(item)}
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-surface-secondary">
        {imageSrc
          ? <img alt="" className="h-full w-full object-cover" loading="lazy" src={imageSrc} />
          : <div className="flex h-full items-center justify-center text-muted"><Icon className="size-8" icon="lucide:clapperboard" /></div>}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
          <div className="flex size-9 items-center justify-center rounded-full bg-white/90 text-black">
            <Icon className="ml-0.5 size-4" icon="lucide:play" />
          </div>
        </div>
      </div>
      <div className="min-w-0 py-1">
        <div className="truncate text-sm font-semibold text-foreground" title={episodeTitle(item)}>
          {episodeTitle(item)}
        </div>
        <div className="mt-1 text-xs text-muted">
          {[formatDate(item.premiere_date), formatRuntime(item.run_time_ticks)].filter(Boolean).join(' · ')}
        </div>
        {item.overview && (
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted">
            {item.overview}
          </p>
        )}
      </div>
    </button>
  )
}

function EmbyDetailPage() {
  const { itemId, title, sectionId, sectionName, collectionType } = Route.useSearch()
  const [playingItem, setPlayingItem] = useState<EmbyLibraryItem | undefined>()
  const [episodePages, setEpisodePages] = useState<Record<string, SeasonEpisodePage>>({})

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
    queries: seasonItems.map((season) => {
      const pageState = getSeasonEpisodePage(episodePages, season.id)
      const startIndex = (pageState.page - 1) * pageState.pageSize

      return {
        queryKey: getListItemsEmbyQueryKey({
          parent_id: season.id,
          include_item_types: 'Episode',
          recursive: true,
          start_index: startIndex,
          limit: pageState.pageSize,
        }),
        queryFn: () => listItemsEmby({
          parent_id: season.id,
          include_item_types: 'Episode',
          recursive: true,
          start_index: startIndex,
          limit: pageState.pageSize,
        }),
        enabled: Boolean(itemId && isSeries),
      }
    }),
  })

  const episodeItems = useMemo(
    () => episodeQueries.flatMap(query => query.data?.items ?? []).filter(episode => episode.can_play),
    [episodeQueries],
  )

  const playbackPlaylist = useMemo(() => {
    if (!playingItem)
      return []
    if (playingItem.item_type === 'Episode')
      return episodeItems
    if (playingItem.can_play)
      return [playingItem]
    return []
  }, [episodeItems, playingItem])

  const posterSrc = item?.image_tag ? buildEmbyImageSrc(item.id, item.image_tag, 'Primary') : undefined
  const backdropSrc = item?.backdrop_image_tag
    ? buildEmbyImageSrc(item.id, item.backdrop_image_tag, 'Backdrop')
    : posterSrc
  const people = item?.people?.slice(0, MAX_VISIBLE_PEOPLE) ?? []
  const genres = item?.genres ?? []
  const tags = item?.tags ?? []
  const hasMetadata = Boolean(people.length || genres.length || tags.length)
  const librarySearchMeta = {
    collectionType,
    sectionId,
    sectionName,
  }

  if (!itemId) {
    return (
      <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-var(--navbar-height))] items-center justify-center bg-background p-6 text-foreground">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <Icon className="size-10 text-warning" icon="lucide:triangle-alert" />
          <div>
            <h1 className="m-0 text-xl font-semibold">缺少媒体 ID</h1>
            <p className="mt-2 text-sm text-muted">请从媒体库列表进入详情页</p>
          </div>
          <Link to="/emby">
            <Button>返回 Emby</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100dvh-var(--navbar-height))] bg-background text-foreground">
      {itemQuery.isPending
        ? (
            <div className="flex h-[60vh] items-center justify-center gap-2 text-sm text-muted">
              <Spinner color="current" size="sm" />
              加载媒体详情...
            </div>
          )
        : itemQuery.isError
          ? (
              <div className="px-6 py-8 md:px-10">
                <Card className="bg-surface text-foreground">
                  <Card.Content className="flex flex-col items-center gap-3 py-12 text-center">
                    <Icon className="size-10 text-warning" icon="lucide:circle-alert" />
                    <div>
                      <h2 className="m-0 text-base font-semibold">无法加载媒体详情</h2>
                      <p className="mt-1 text-sm text-muted">{itemQuery.error.message}</p>
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
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/35" />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-black/35" />
                <div className="relative mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-6 py-7 md:flex-row md:items-end md:px-10 md:pt-12">
                  <div className="w-36 shrink-0 overflow-hidden rounded-md bg-surface-secondary ring-1 ring-border md:w-52">
                    {posterSrc
                      ? <img alt="" className="aspect-[2/3] h-full w-full object-cover" src={posterSrc} />
                      : <div className="flex aspect-[2/3] items-center justify-center text-muted"><Icon className="size-14" icon="lucide:film" /></div>}
                  </div>
                  <div className="min-w-0 max-w-4xl pb-1">
                    <Button
                      variant="ghost"
                      className="mb-4 -ml-3 text-muted hover:bg-surface-secondary hover:text-foreground"
                      onPress={() => window.history.back()}
                    >
                      <Icon className="size-4" icon="lucide:chevron-left" />
                      返回
                    </Button>
                    <h1 className="m-0 text-4xl font-bold tracking-tight text-foreground md:text-5xl">
                      {item.name || title}
                    </h1>
                    <p className="mt-3 text-sm text-muted">
                      {itemMeta(item)}
                    </p>
                    {item.overview && (
                      <p className="mt-5 max-w-3xl text-sm leading-6 text-foreground/80 md:text-base">
                        {item.overview}
                      </p>
                    )}
                    {item.can_play && (
                      <Button className="mt-6" onPress={() => setPlayingItem(item)}>
                        <Icon className="ml-0.5 size-5" icon="lucide:play" />
                        播放
                      </Button>
                    )}
                  </div>
                </div>
              </section>

              {hasMetadata && (
                <section className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-6 py-8 md:px-10">
                  {people.length > 0 && (
                    <MetadataSection title="演员">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                        {people.map(person => (
                          <Link
                            key={`${person.id}-${person.name}`}
                            to="/emby-library"
                            search={buildLibrarySearch({
                              ...librarySearchMeta,
                              personId: person.id,
                              personName: person.name,
                            })}
                            className="group flex min-w-0 items-center gap-3 rounded-md p-2 text-left no-underline hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent/60"
                          >
                            <div className="size-11 shrink-0 overflow-hidden rounded-full bg-surface-secondary ring-1 ring-border">
                              {person.image_tag
                                ? (
                                    <img
                                      alt=""
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                      src={buildEmbyImageSrc(person.id, person.image_tag, 'Primary')}
                                    />
                                  )
                                : (
                                    <div className="flex h-full w-full items-center justify-center text-muted">
                                      <Icon className="size-5" icon="lucide:user" />
                                    </div>
                                  )}
                            </div>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground group-hover:text-accent" title={person.name}>
                                {person.name}
                              </span>
                              <span className="block truncate text-xs text-muted" title={person.role ?? personTypeLabel(person.person_type)}>
                                {person.role ?? personTypeLabel(person.person_type)}
                              </span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    </MetadataSection>
                  )}

                  {genres.length > 0 && (
                    <MetadataSection title="类型">
                      <div className="flex flex-wrap gap-2">
                        {genres.map(genre => (
                          <MetadataPill
                            key={genre}
                            search={buildLibrarySearch({ ...librarySearchMeta, genre })}
                          >
                            {genre}
                          </MetadataPill>
                        ))}
                      </div>
                    </MetadataSection>
                  )}

                  {tags.length > 0 && (
                    <MetadataSection title="标签">
                      <div className="flex flex-wrap gap-2">
                        {tags.map(tag => (
                          <MetadataPill
                            key={tag}
                            search={buildLibrarySearch({ ...librarySearchMeta, tagFilter: tag })}
                          >
                            {tag}
                          </MetadataPill>
                        ))}
                      </div>
                    </MetadataSection>
                  )}
                </section>
              )}

              {isSeries && (
                <section className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-6 pb-10 md:px-10">
                  <h2 className="m-0 text-xl font-bold text-foreground">剧集</h2>
                  {seasonsQuery.isPending
                    ? (
                        <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted">
                          <Spinner color="current" size="sm" />
                          加载剧集...
                        </div>
                      )
                    : seasonItems.length
                      ? (
                          <div className="flex flex-col gap-7">
                            {seasonItems.map((season, index) => {
                              const pageState = getSeasonEpisodePage(episodePages, season.id)
                              const query = episodeQueries[index]
                              const episodes = query?.data?.items ?? []
                              const total = query?.data?.total ?? 0
                              return (
                                <div key={season.id} className="flex flex-col gap-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="m-0 text-base font-semibold text-foreground">{season.name}</h3>
                                    {query?.isFetching && (
                                      <span className="flex items-center gap-1.5 text-xs text-muted">
                                        <Spinner color="current" size="sm" />
                                        加载中...
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    {episodes.map(episode => (
                                      <EpisodeRow key={episode.id} item={episode} onPlay={setPlayingItem} />
                                    ))}
                                  </div>
                                  <BasePagination
                                    current={pageState.page}
                                    disabled={query?.isFetching}
                                    hideOnSinglePage
                                    pageSize={pageState.pageSize}
                                    pageSizeOptions={EPISODE_PAGE_SIZE_OPTIONS}
                                    showLessItems
                                    showSizeChanger
                                    showTotal={(total, range) => (
                                      <>
                                        {range[0]}
                                        -
                                        {range[1]}
                                        {' '}
                                        / 共
                                        {' '}
                                        {total}
                                        {' '}
                                        集
                                      </>
                                    )}
                                    size="small"
                                    total={total}
                                    onChange={(page, pageSize) => {
                                      setEpisodePages(prev => ({
                                        ...prev,
                                        [season.id]: { page, pageSize },
                                      }))
                                    }}
                                  />
                                </div>
                              )
                            })}
                          </div>
                        )
                      : (
                          <Card className="bg-surface text-foreground">
                            <Card.Content className="py-10 text-center text-sm text-muted">
                              暂无剧集
                            </Card.Content>
                          </Card>
                        )}
                </section>
              )}
              <EmbyVideoPlayerModal
                itemId={playingItem?.id}
                playlist={playbackPlaylist}
                title={playingItem?.name}
                open={Boolean(playingItem)}
                onItemChange={setPlayingItem}
                onOpenChange={(open) => {
                  if (!open)
                    setPlayingItem(undefined)
                }}
              />
            </>
          )}
    </div>
  )
}
