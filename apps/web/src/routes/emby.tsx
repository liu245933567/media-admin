import type { EmbyLibrarySection } from '@/api'
import { Button, Card, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { buildEmbyImageSrc, getListSectionsEmbyQueryKey, listSectionsEmby } from '@/api'

export const Route = createFileRoute('/emby')({
  component: EmbyPage,
})

function sectionTypeLabel(section: EmbyLibrarySection) {
  const map: Record<string, string> = {
    movies: '电影',
    tvshows: '剧集',
    homevideos: '视频',
    musicvideos: '音乐视频',
    boxsets: '合集',
  }
  return section.collection_type ? (map[section.collection_type] ?? section.collection_type) : '媒体库'
}

function sectionIcon(section: EmbyLibrarySection) {
  const map: Record<string, string> = {
    movies: 'lucide:film',
    tvshows: 'lucide:tv',
    homevideos: 'lucide:video',
    musicvideos: 'lucide:music',
    boxsets: 'lucide:layers-3',
  }
  return section.collection_type ? (map[section.collection_type] ?? 'lucide:folder-open') : 'lucide:folder-open'
}

function LibraryCard({ section }: { section: EmbyLibrarySection }) {
  const navigate = useNavigate()
  const coverItem = section.items.find(item => item.image_tag) ?? section.items[0]
  const coverSrc = buildEmbyImageSrc(section.id, undefined, 'Thumb')
  const fallbackCoverSrc = coverItem?.image_tag ? buildEmbyImageSrc(coverItem.id, coverItem.image_tag) : undefined

  return (
    <button
      type="button"
      className="group flex min-w-0 flex-col items-stretch text-left outline-none"
      onClick={() => {
        void navigate({
          to: '/emby-library',
          search: {
            sectionId: section.id,
            name: section.name,
            collectionType: section.collection_type ?? undefined,
            q: '',
            personId: '',
            personName: '',
            genre: '',
            tagFilter: '',
          },
        })
      }}
    >
      <div className="relative aspect-[16/9] overflow-hidden rounded-md bg-surface-secondary shadow-sm ring-1 ring-border transition group-hover:ring-accent/35 group-focus-visible:ring-2 group-focus-visible:ring-accent/60">
        {coverSrc
          ? (
              <img
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-65 transition duration-200 group-hover:scale-[1.03] group-hover:opacity-80"
                loading="lazy"
                src={coverSrc}
                onError={(event) => {
                  if (!fallbackCoverSrc || event.currentTarget.src.endsWith(fallbackCoverSrc))
                    return
                  event.currentTarget.src = fallbackCoverSrc
                }}
              />
            )
          : null}
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
        <div className="absolute inset-x-5 top-1/2 flex -translate-y-1/2 items-center gap-3">
          <Icon className="size-9 shrink-0 text-white/75" icon={sectionIcon(section)} />
          <div className="min-w-0">
            <div className="truncate text-2xl font-black tracking-wide text-white/90">
              {section.name}
            </div>
            <div className="mt-1 h-0.5 w-28 max-w-full bg-white/65" />
          </div>
        </div>
      </div>
      <div className="px-1 pt-2 text-center">
        <div className="truncate text-sm font-semibold text-foreground" title={section.name}>
          {section.name}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {section.total}
          {' '}
          个资源 ·
          {' '}
          {sectionTypeLabel(section)}
        </div>
      </div>
    </button>
  )
}

function EmbyPage() {
  const sectionsQuery = useQuery({
    queryKey: getListSectionsEmbyQueryKey({ limit: 12 }),
    queryFn: () => listSectionsEmby({ limit: 12 }),
  })

  const sections = sectionsQuery.data?.sections ?? []

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100dvh-var(--navbar-height))] bg-background px-6 py-7 text-foreground md:px-10">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="m-0 text-2xl font-bold tracking-tight text-foreground">我的媒体</h1>
          <Button
            isIconOnly
            aria-label="刷新媒体库"
            variant="ghost"
            className="text-muted hover:bg-surface-secondary hover:text-foreground"
            onPress={() => sectionsQuery.refetch()}
          >
            <Icon className="size-5" icon="lucide:refresh-cw" />
          </Button>
        </div>

        {sectionsQuery.isPending
          ? (
              <div className="flex h-56 items-center justify-center gap-2 text-sm text-muted">
                <Spinner color="current" size="sm" />
                加载媒体库...
              </div>
            )
          : sectionsQuery.isError
            ? (
                <Card className="bg-surface text-foreground">
                  <Card.Content className="flex flex-col items-center gap-3 py-12 text-center">
                    <Icon className="size-10 text-warning" icon="lucide:circle-alert" />
                    <div>
                      <h2 className="m-0 text-base font-semibold">无法加载媒体库</h2>
                      <p className="mt-1 text-sm text-muted">{sectionsQuery.error.message}</p>
                    </div>
                    <Button variant="secondary" onPress={() => sectionsQuery.refetch()}>
                      重试
                    </Button>
                  </Card.Content>
                </Card>
              )
            : sections.length
              ? (
                  <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {sections.map(section => (
                      <LibraryCard key={section.id} section={section} />
                    ))}
                  </div>
                )
              : (
                  <Card className="bg-surface text-foreground">
                    <Card.Content className="flex flex-col items-center gap-2 py-12 text-center text-muted">
                      <Icon className="size-10" icon="lucide:inbox" />
                      <span className="text-sm">暂无媒体库</span>
                    </Card.Content>
                  </Card>
                )}
      </div>
    </div>
  )
}
