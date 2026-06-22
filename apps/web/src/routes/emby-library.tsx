import type { EmbyLibraryItem } from '@/api'
import { Button, Card, Input, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  buildEmbyImageSrc,
  getListItemsEmbyQueryKey,
  listItemsEmby,
} from '@/api'

export const Route = createFileRoute('/emby-library')({
  validateSearch: (search: Record<string, unknown>) => ({
    sectionId: typeof search.sectionId === 'string' ? search.sectionId : '',
    name: typeof search.name === 'string' ? search.name : '媒体库',
    collectionType: typeof search.collectionType === 'string' ? search.collectionType : undefined,
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

function MediaCard({ item, mode }: { item: EmbyLibraryItem, mode: 'media' | 'series' }) {
  const navigate = useNavigate()
  const imageSrc = item.image_tag ? buildEmbyImageSrc(item.id, item.image_tag) : undefined
  const meta = formatItemMeta(item, mode)

  return (
    <button
      type="button"
      className="group min-w-0 text-left outline-none"
      onClick={() => {
        void navigate({
          to: '/emby-detail',
          search: {
            itemId: item.id,
            title: item.name,
          },
        })
      }}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-[#2f2f2f] ring-1 ring-white/5 transition group-hover:ring-white/20 group-focus-visible:ring-2 group-focus-visible:ring-white/60">
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
              <div className="flex h-full items-center justify-center text-zinc-500">
                <Icon className="size-12" icon={itemIcon(item)} />
              </div>
            )}
        <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/20" />
      </div>
      <div className="px-1 pt-2 text-center">
        <div className="truncate text-sm font-semibold text-zinc-100" title={item.name}>
          {item.name}
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">
          {meta}
        </div>
      </div>
    </button>
  )
}

function EmbyLibraryPage() {
  const { sectionId, name, collectionType } = Route.useSearch()
  const [q, setQ] = useState('')
  const mode = libraryMode(collectionType)

  const itemsQuery = useQuery({
    queryKey: getListItemsEmbyQueryKey({
      parent_id: sectionId,
      q: q || undefined,
      include_item_types: includeTypesForLibrary(collectionType),
      recursive: true,
      limit: 200,
    }),
    queryFn: () => listItemsEmby({
      parent_id: sectionId,
      q: q || undefined,
      include_item_types: includeTypesForLibrary(collectionType),
      recursive: true,
      limit: 200,
    }),
    enabled: Boolean(sectionId),
    placeholderData: keepPreviousData,
  })

  const items = useMemo(
    () => itemsQuery.data?.items ?? [],
    [itemsQuery.data?.items],
  )

  if (!sectionId) {
    return (
      <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-var(--navbar-height))] items-center justify-center bg-[#1f1f1f] p-6 text-zinc-100">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <Icon className="size-10 text-warning" icon="lucide:triangle-alert" />
          <div>
            <h1 className="m-0 text-xl font-semibold">缺少媒体库 ID</h1>
            <p className="mt-2 text-sm text-zinc-400">请从 Emby 媒体库进入详情页</p>
          </div>
          <Link to="/emby">
            <Button>返回 Emby</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100dvh-var(--navbar-height))] bg-[#1f1f1f] px-6 py-6 text-zinc-100 md:px-10">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <Link to="/emby" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-400 no-underline hover:text-zinc-100">
              <Icon className="size-4" icon="lucide:chevron-left" />
              返回媒体库
            </Link>
            <h1 className="m-0 truncate text-2xl font-bold tracking-tight text-zinc-100 md:text-3xl" title={name}>
              {name}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {itemsQuery.data?.total ?? 0}
              {' '}
              {mode === 'series' ? '部剧集' : '个媒体'}
            </p>
          </div>
          <div className="flex w-full gap-2 md:w-auto">
            <Input
              aria-label="搜索媒体"
              value={q}
              placeholder={mode === 'series' ? '搜索剧集' : '搜索电影或视频'}
              className="min-w-0 md:w-72"
              variant="secondary"
              onChange={event => setQ(event.target.value)}
            />
            <Button
              isIconOnly
              aria-label="刷新媒体列表"
              variant="ghost"
              className="shrink-0 text-zinc-300 hover:bg-white/10 hover:text-white"
              onPress={() => itemsQuery.refetch()}
            >
              <Icon className="size-5" icon="lucide:refresh-cw" />
            </Button>
          </div>
        </header>

        {itemsQuery.isPending
          ? (
              <div className="flex h-56 items-center justify-center gap-2 text-sm text-zinc-400">
                <Spinner color="current" size="sm" />
                加载媒体列表...
              </div>
            )
          : itemsQuery.isError
            ? (
                <Card className="bg-[#2b2b2b] text-zinc-100">
                  <Card.Content className="flex flex-col items-center gap-3 py-12 text-center">
                    <Icon className="size-10 text-warning" icon="lucide:circle-alert" />
                    <div>
                      <h2 className="m-0 text-base font-semibold">无法加载媒体列表</h2>
                      <p className="mt-1 text-sm text-zinc-400">{itemsQuery.error.message}</p>
                    </div>
                    <Button variant="secondary" onPress={() => itemsQuery.refetch()}>
                      重试
                    </Button>
                  </Card.Content>
                </Card>
              )
            : items.length
              ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-9">
                    {items.map(item => (
                      <MediaCard key={item.id} item={item} mode={mode} />
                    ))}
                  </div>
                )
              : (
                  <Card className="bg-[#2b2b2b] text-zinc-100">
                    <Card.Content className="flex flex-col items-center gap-2 py-12 text-center text-zinc-400">
                      <Icon className="size-10" icon="lucide:inbox" />
                      <span className="text-sm">暂无媒体</span>
                    </Card.Content>
                  </Card>
                )}
      </div>
    </div>
  )
}
