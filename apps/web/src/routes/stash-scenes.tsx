import type { ColumnDef } from '@tanstack/react-table'
import type { StashSceneRow } from '@/api'
import { Button, Chip, Input, Label, ListBox, Select, Switch, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { listScenesStash } from '@/api'
import { DataTable } from '@/components/data-table'
import { StashSceneCover } from '@/components/stash-scene-cover'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { SubtitleWebModal } from '@/components/subtitle-web-modal'

export const Route = createFileRoute('/stash-scenes')({
  component: PageComponent,
})

const STASH_SORT_OPTIONS = [
  { label: '最近更新', value: 'updated_at', defaultDirection: 'DESC' },
  { label: '最后播放时间', value: 'last_played_at', defaultDirection: 'DESC' },
  { label: '创建时间', value: 'created_at', defaultDirection: 'DESC' },
  { label: '场景日期', value: 'date', defaultDirection: 'DESC' },
  { label: '标题', value: 'title', defaultDirection: 'ASC' },
  { label: '文件路径', value: 'path', defaultDirection: 'ASC' },
  { label: '播放次数', value: 'play_count', defaultDirection: 'DESC' },
  { label: '时长', value: 'duration', defaultDirection: 'DESC' },
] as const

const STASH_PAGE_SIZE_OPTIONS = [20, 40, 80, 120] as const

type StashSort = typeof STASH_SORT_OPTIONS[number]['value']
type StashSortDirection = 'ASC' | 'DESC'

function PageComponent() {
  const navigate = useNavigate()
  const [screenshotShow, setScreenshotShow] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<StashSort>('last_played_at')
  const [direction, setDirection] = useState<StashSortDirection>('ASC')
  const [pageSize, setPageSize] = useState<number>(20)
  const [subtitleTaskCreateOpen, setSubtitleTaskCreateOpen] = useState(false)
  const [subtitleTaskCreateInitialPath, setSubtitleTaskCreateInitialPath] = useState<string | undefined>()
  const [subtitleTaskBulkRows, setSubtitleTaskBulkRows] = useState<StashSceneRow[] | undefined>()

  const scenesQuery = useQuery({
    queryKey: ['stash-scenes', { direction, page, pageSize, q, sort }],
    queryFn: () => listScenesStash({
      filter: {
        page,
        page_size: pageSize,
        q: q || undefined,
        sort,
        direction,
      },
    }),
  })

  const columns = useMemo<ColumnDef<StashSceneRow, unknown>[]>(() => {
    const nextColumns: ColumnDef<StashSceneRow, unknown>[] = []
    if (screenshotShow) {
      nextColumns.push({
        header: '封面',
        id: 'screenshot',
        enableSorting: false,
        cell: ({ row }) => screenshotShow
          ? (
              <div className="w-44">
                <StashSceneCover
                  screenshot={row.original.paths?.screenshot}
                  preview={row.original.paths?.preview}
                />
              </div>
            )
          : null,
      })
    }
    nextColumns.push(
      {
        header: '文件名',
        id: 'basename',
        cell: ({ row }) => {
          if (!row.original.files?.length)
            return '-'
          return (
            <div className="flex max-w-90 flex-col gap-1">
              {row.original.files.map(file => (
                <div key={file.path} className="min-w-0">
                  <div className="truncate text-sm" title={file.basename}>
                    {file.basename}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Chip size="sm" variant="soft">
                      {file.local_path ? '已映射' : '未映射'}
                    </Chip>
                    <span className="truncate font-mono text-[11px] text-muted" title={file.local_path ?? file.path}>
                      {file.local_path ?? file.path}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        },
      },
      {
        header: '标题',
        accessorKey: 'title',
        cell: ({ row }) => (
          <span className="block max-w-[320px] truncate" title={row.original.title}>
            {row.original.title}
          </span>
        ),
      },
      {
        header: '最后播放',
        accessorKey: 'last_played_at',
        cell: ({ row }) => row.original.last_played_at
          ? dayjs(row.original.last_played_at).format('YYYY-MM-DD HH:mm:ss')
          : '-',
      },
      {
        header: '操作',
        id: 'action',
        enableSorting: false,
        cell: ({ row }) => {
          const stashPath = row.original.files?.[0]?.path
          const mappedPath = row.original.files?.[0]?.local_path
          const localPath = mappedPath?.trim() || undefined
          const videoPath = localPath ?? stashPath
          if (!videoPath) {
            return (
              <div className="flex items-center gap-1">
                <Button isIconOnly aria-label="播放" size="sm" variant="tertiary" isDisabled>
                  <Icon className="size-4" icon="lucide:play" />
                </Button>
                <Button isIconOnly aria-label="查询字幕" size="sm" variant="tertiary" isDisabled>
                  <Icon className="size-4" icon="lucide:search" />
                </Button>
              </div>
            )
          }

          return (
            <div className="flex items-center gap-1">
              <Tooltip>
                <Button
                  isIconOnly
                  aria-label="播放"
                  isDisabled={!localPath}
                  size="sm"
                  variant="tertiary"
                  onPress={() => {
                    if (!localPath)
                      return
                    void navigate({
                      to: '/video-play',
                      search: { videoPath: localPath },
                    })
                  }}
                >
                  <Icon className="size-4" icon="lucide:play" />
                </Button>
                <Tooltip.Content>{localPath ? '播放本地文件' : '未配置本地路径映射'}</Tooltip.Content>
              </Tooltip>
              <SubtitleWebModal
                videoPath={videoPath}
                trigger={({ setOpen }) => (
                  <Tooltip>
                    <Button
                      isIconOnly
                      aria-label="查询字幕"
                      size="sm"
                      variant="tertiary"
                      onPress={() => setOpen(true)}
                    >
                      <Icon className="size-4" icon="lucide:search" />
                    </Button>
                    <Tooltip.Content>查询字幕</Tooltip.Content>
                  </Tooltip>
                )}
              />
              <Tooltip>
                <Button
                  isIconOnly
                  aria-label="生成字幕"
                  isDisabled={!localPath}
                  size="sm"
                  variant="tertiary"
                  onPress={() => {
                    setSubtitleTaskCreateInitialPath(localPath)
                    setSubtitleTaskCreateOpen(true)
                  }}
                >
                  <Icon className="size-4" icon="lucide:captions" />
                </Button>
                <Tooltip.Content>{localPath ? '生成字幕' : '未配置本地路径映射'}</Tooltip.Content>
              </Tooltip>
            </div>
          )
        },
      },
    )
    return nextColumns
  }, [navigate, screenshotShow])

  const total = Number(scenesQuery.data?.total ?? 0)

  return (
    <div className="flex flex-col gap-4">
      <SubtitleTaskCreateDrawerForm
        open={subtitleTaskCreateOpen}
        onOpenChange={(open) => {
          setSubtitleTaskCreateOpen(open)
          if (!open) {
            setSubtitleTaskCreateInitialPath(undefined)
            setSubtitleTaskBulkRows(undefined)
          }
        }}
        initialVideoPath={subtitleTaskCreateInitialPath}
        bulkSourceRows={subtitleTaskBulkRows?.map(stashSceneToBulkSourceRow)}
        onCreated={() => scenesQuery.refetch()}
      />
      <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_280px_auto] md:items-end">
        <div className="flex min-w-0 flex-col gap-1">

          <Input
            value={q}
            placeholder="搜索标题或文件名"
            variant="secondary"
            onChange={(event) => {
              setQ(event.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-stretch">
            <Select
              aria-label="排序字段"
              className="min-w-0 flex-1"
              value={sort}
              variant="secondary"
              onChange={(key) => {
                if (typeof key !== 'string')
                  return
                const nextSort = key as StashSort
                setSort(nextSort)
                setDirection(STASH_SORT_OPTIONS.find(option => option.value === nextSort)?.defaultDirection ?? 'DESC')
                setPage(1)
              }}
            >
              <Select.Trigger className="rounded-r-none">
                <Select.Value />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {STASH_SORT_OPTIONS.map(option => (
                    <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                      {option.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Tooltip>
              <Button
                isIconOnly
                aria-label={direction === 'DESC' ? '切换为正序' : '切换为倒序'}
                className="rounded-l-none"
                variant="secondary"
                onPress={() => {
                  setDirection(prev => prev === 'DESC' ? 'ASC' : 'DESC')
                  setPage(1)
                }}
              >
                <Icon className="size-4" icon={direction === 'DESC' ? 'lucide:arrow-down' : 'lucide:arrow-up'} />
              </Button>
              <Tooltip.Content>{direction === 'DESC' ? '倒序' : '正序'}</Tooltip.Content>
            </Tooltip>
          </div>
        </div>
        <Switch className="pb-1 md:justify-self-end" isSelected={screenshotShow} onChange={setScreenshotShow}>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label className="text-sm">显示封面</Label>
          </Switch.Content>
        </Switch>
      </div>
      <DataTable
        ariaLabel="Stash 场景"
        columns={columns}
        data={scenesQuery.data?.data ?? []}
        locale={{ emptyText: '暂无场景' }}
        rowSelection={{
          actions: (rows) => {
            const mappedRows = rows.filter(row => Boolean(row.files?.[0]?.local_path?.trim()))
            return [
              <Button
                key="subtitle"
                isDisabled={!mappedRows.length}
                size="sm"
                variant="secondary"
                onPress={() => {
                  setSubtitleTaskCreateInitialPath(undefined)
                  setSubtitleTaskBulkRows(mappedRows)
                  setSubtitleTaskCreateOpen(true)
                }}
              >
                <Icon className="size-4" icon="lucide:captions" />
                批量生成字幕
              </Button>,
            ]
          },
        }}
        rowKey={row => String(row.id)}
        loading={scenesQuery.isFetching}
        scroll={{ x: 760 }}
        pagination={{
          showTotalLabel: '个场景',
          current: page,
          pageSize,
          pageSizeOptions: STASH_PAGE_SIZE_OPTIONS,
          total,
          onChange: (nextPage, nextPageSize) => {
            if (nextPageSize !== pageSize)
              setPageSize(nextPageSize)
            setPage(nextPage)
          },
        }}

      />
    </div>
  )
}

function stashSceneToBulkSourceRow(row: StashSceneRow) {
  const file = row.files?.[0]
  return {
    video_path: file?.local_path?.trim() ?? '',
    subtitle_names: [],
  }
}
