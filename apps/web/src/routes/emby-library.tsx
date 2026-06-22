import type { EmbyLibraryItem } from '@/api'
import { Button, Card, Input, Spinner, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  buildEmbyImageSrc,
  getListItemsEmbyQueryKey,
  listItemsEmby,
} from '@/api'
import { BasePagination } from '@/components/base-pagination'
import { EmbyVideoPlayerModal } from '@/features/emby/emby-video-player-modal'

const DEFAULT_LIBRARY_PAGE_SIZE = 50
const LIBRARY_PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const

export const Route = createFileRoute('/emby-library')({
  validateSearch: (search: Record<string, unknown>) => ({
    sectionId: typeof search.sectionId === 'string' ? search.sectionId : '',
    name: typeof search.name === 'string' ? search.name : '媒体库',
    collectionType: typeof search.collectionType === 'string' ? search.collectionType : undefined,
    q: typeof search.q === 'string' ? search.q : '',
    personId: typeof search.personId === 'string' ? search.personId : '',
    personName: typeof search.personName === 'string' ? search.personName : '',
    genre: typeof search.genre === 'string' ? search.genre : '',
    tagFilter: typeof search.tagFilter === 'string' ? search.tagFilter : '',
  }),
  component: EmbyLibraryPage,
})

function libraryMode(collectionType?: string) {
  return collectionType === 'tvshows' ? 'series' : 'media'
}

function includeTypesForLibrary(collectionType?: string) {
  if (collectionType === 'tvshows')
    return 'Series'
  if (collectionType === 'movies')
    return 'Movie'
  return 'Movie,Series,Video'
}

function formatItemMeta(item: EmbyLibraryItem, mode: 'media' | 'series') {
  if (mode === 'series') {
    if (item.child_count != null)
      return `${item.child_count} 季`
    return item.production_year ? String(item.production_year) : '剧集'
  }
  return [item.production_year, item.official_rating].filter(Boolean).join(' · ') || '媒体'
}

function itemIcon(item: EmbyLibraryItem) {
  const map: Record<string, string> = {
    Movie: 'lucide:film',
    Series: 'lucide:tv',
    Episode: 'lucide:clapperboard',
    Video: 'lucide:video',
  }
  return map[item.item_type] ?? 'lucide:play-square'
}

function filterLabel(filter: {
  genre: string
  personName: string
  tagFilter: string
}) {
  if (filter.personName)
    return `演员：${filter.personName}`
  if (filter.genre)
    return `类型：${filter.genre}`
  if (filter.tagFilter)
    return `标签：${filter.tagFilter}`
  return undefined
}

function MediaCard({
  item,
  mode,
  onPlay,
  sectionId,
  sectionName,
  collectionType,
}: {
  item: EmbyLibraryItem
  mode: 'media' | 'series'
  onPlay: (item: EmbyLibraryItem) => void
  sectionId: string
  sectionName: string
  collectionType?: string
}) {
  const navigate = useNavigate()
  const imageSrc = item.image_tag ? buildEmbyImageSrc(item.id, item.image_tag) : undefined
  const meta = formatItemMeta(item, mode)

  const navigateToDetail = () => {
    void navigate({
      to: '/emby-detail',
      search: {
        itemId: item.id,
        title: item.name,
        sectionId,
        sectionName,
        collectionType,
      },
    })
  }

  return (
    <div className="group min-w-0 text-left">
      <div className="relative">
        <button
          type="button"
          className="block w-full outline-none"
          onClick={navigateToDetail}
        >
          <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-surface-secondary ring-1 ring-border transition group-hover:ring-accent/35 focus-visible:ring-2 focus-visible:ring-accent/60">
            {imageSrc
              ? (
                  <img
                    alt=""
                    className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                    loading="lazy"
                    src={imageSrc}
                  />
                )
              : (
                  <div className="flex h-full items-center justify-center text-muted">
                    <Icon className="size-12" icon={itemIcon(item)} />
                  </div>
                )}
            <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/20" />
          </div>
        </button>
        {item.can_play && (
          <Tooltip delay={0}>
            <Button
              isIconOnly
              aria-label={`快速播放 ${item.name}`}
              className="absolute bottom-2 right-2 z-10 size-9 bg-white/90 text-black opacity-0 shadow-sm backdrop-blur transition hover:bg-white group-hover:opacity-100 focus-visible:opacity-100"
              variant="secondary"
              onPress={() => onPlay(item)}
            >
              <Icon className="ml-0.5 size-4" icon="lucide:play" />
            </Button>
            <Tooltip.Content>快速播放</Tooltip.Content>
          </Tooltip>
        )}
      </div>
      <button
        type="button"
        className="block w-full px-1 pt-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        onClick={navigateToDetail}
      >
        <div className="truncate text-sm font-semibold text-foreground" title={item.name}>
          {item.name}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">
          {meta}
        </div>
      </button>
    </div>
  )
}

function EmbyLibraryPage() {
  const {
    collectionType,
    genre,
    name,
    personId,
    personName,
    q: initialQ,
    sectionId,
    tagFilter,
  } = Route.useSearch()
  const navigate = useNavigate()
  const [q, setQ] = useState(initialQ ?? '')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_LIBRARY_PAGE_SIZE)
  const [playingItem, setPlayingItem] = useState<EmbyLibraryItem | undefined>()
  const mode = libraryMode(collectionType)
  const startIndex = (page - 1) * pageSize
  const activeFilterLabel = filterLabel({ genre, personName, tagFilter })

  function setKeywordSearch(nextQ: string) {
    setQ(nextQ)
    setPage(1)
    if (activeFilterLabel) {
      void navigate({
        to: '/emby-library',
        search: {
          sectionId,
          name,
          collectionType,
          q: nextQ,
          personId: '',
          personName: '',
          genre: '',
          tagFilter: '',
        },
        replace: true,
      })
    }
  }

  const itemsQuery = useQuery({
    queryKey: getListItemsEmbyQueryKey({
      parent_id: sectionId,
      q: q || undefined,
      person_id: personId || undefined,
      genre: genre || undefined,
      tag_filter: tagFilter || undefined,
      include_item_types: includeTypesForLibrary(collectionType),
      recursive: true,
      start_index: startIndex,
      limit: pageSize,
    }),
    queryFn: () => listItemsEmby({
      parent_id: sectionId,
      q: q || undefined,
      person_id: personId || undefined,
      genre: genre || undefined,
      tag_filter: tagFilter || undefined,
      include_item_types: includeTypesForLibrary(collectionType),
      recursive: true,
      start_index: startIndex,
      limit: pageSize,
    }),
    enabled: Boolean(sectionId),
    placeholderData: keepPreviousData,
  })

  const items = useMemo(
    () => itemsQuery.data?.items ?? [],
    [itemsQuery.data?.items],
  )
  const playableItems = useMemo(
    () => items.filter(item => item.can_play),
    [items],
  )

  if (!sectionId) {
    return (
      <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-var(--navbar-height))] items-center justify-center bg-background p-6 text-foreground">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <Icon className="size-10 text-warning" icon="lucide:triangle-alert" />
          <div>
            <h1 className="m-0 text-xl font-semibold">缺少媒体库 ID</h1>
            <p className="mt-2 text-sm text-muted">请从 Emby 媒体库进入详情页</p>
          </div>
          <Link to="/emby">
            <Button>返回 Emby</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100dvh-var(--navbar-height))] bg-background px-6 py-6 text-foreground md:px-10">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <Link to="/emby" className="mb-3 inline-flex items-center gap-1 text-sm text-muted no-underline hover:text-foreground">
              <Icon className="size-4" icon="lucide:chevron-left" />
              返回媒体库
            </Link>
            <h1 className="m-0 truncate text-2xl font-bold tracking-tight text-foreground md:text-3xl" title={name}>
              {name}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {itemsQuery.data?.total ?? 0}
              {' '}
              {mode === 'series' ? '部剧集' : '个媒体'}
            </p>
            {activeFilterLabel && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-border bg-surface-secondary px-2.5 py-1 text-xs text-muted">
                  {activeFilterLabel}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted hover:bg-surface-secondary hover:text-foreground"
                  onPress={() => {
                    void navigate({
                      to: '/emby-library',
                      search: {
                        sectionId,
                        name,
                        collectionType,
                        q: '',
                        personId: '',
                        personName: '',
                        genre: '',
                        tagFilter: '',
                      },
                    })
                  }}
                >
                  清除筛选
                </Button>
              </div>
            )}
          </div>
          <div className="flex w-full gap-2 md:w-auto">
            <Input
              aria-label="搜索媒体"
              value={q}
              placeholder={mode === 'series' ? '搜索剧集' : '搜索电影或视频'}
              className="min-w-0 md:w-72"
              variant="secondary"
              onChange={event => setKeywordSearch(event.target.value)}
            />
            <Button
              isIconOnly
              aria-label="刷新媒体列表"
              variant="ghost"
              className="shrink-0 text-muted hover:bg-surface-secondary hover:text-foreground"
              onPress={() => itemsQuery.refetch()}
            >
              <Icon className="size-5" icon="lucide:refresh-cw" />
            </Button>
          </div>
        </header>

        {itemsQuery.isPending
          ? (
              <div className="flex h-56 items-center justify-center gap-2 text-sm text-muted">
                <Spinner color="current" size="sm" />
                加载媒体列表...
              </div>
            )
          : itemsQuery.isError
            ? (
                <Card className="bg-surface text-foreground">
                  <Card.Content className="flex flex-col items-center gap-3 py-12 text-center">
                    <Icon className="size-10 text-warning" icon="lucide:circle-alert" />
                    <div>
                      <h2 className="m-0 text-base font-semibold">无法加载媒体列表</h2>
                      <p className="mt-1 text-sm text-muted">{itemsQuery.error.message}</p>
                    </div>
                    <Button variant="secondary" onPress={() => itemsQuery.refetch()}>
                      重试
                    </Button>
                  </Card.Content>
                </Card>
              )
            : items.length
              ? (
                  <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-9">
                      {items.map(item => (
                        <MediaCard
                          key={item.id}
                          item={item}
                          mode={mode}
                          onPlay={setPlayingItem}
                          sectionId={sectionId}
                          sectionName={name}
                          collectionType={collectionType}
                        />
                      ))}
                    </div>
                    <BasePagination
                      current={page}
                      disabled={itemsQuery.isFetching}
                      hideOnSinglePage
                      pageSize={pageSize}
                      pageSizeOptions={LIBRARY_PAGE_SIZE_OPTIONS}
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
                          {mode === 'series' ? '部剧集' : '个媒体'}
                        </>
                      )}
                      total={itemsQuery.data?.total ?? 0}
                      onChange={(nextPage, nextPageSize) => {
                        if (nextPageSize !== pageSize)
                          setPageSize(nextPageSize)
                        setPage(nextPage)
                      }}
                    />
                  </div>
                )
              : (
                  <Card className="bg-surface text-foreground">
                    <Card.Content className="flex flex-col items-center gap-2 py-12 text-center text-muted">
                      <Icon className="size-10" icon="lucide:inbox" />
                      <span className="text-sm">暂无媒体</span>
                    </Card.Content>
                  </Card>
                )}
        <EmbyVideoPlayerModal
          itemId={playingItem?.id}
          playlist={playableItems}
          title={playingItem?.name}
          open={Boolean(playingItem)}
          onItemChange={setPlayingItem}
          onOpenChange={(open) => {
            if (!open)
              setPlayingItem(undefined)
          }}
        />
      </div>
    </div>
  )
}
