import type { ColumnDef } from '@tanstack/react-table'
import type { StashSceneRow } from '@/api'
import { Button, Input, Label, Switch } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { listScenesStash } from '@/api'
import { DataTable } from '@/components/data-table'
import { StashSceneCover } from '@/components/stash-scene-cover'
import { SubtitleWebModal } from '@/components/subtitle-web-modal'

export const Route = createFileRoute('/stash-scenes')({
  component: PageComponent,
})

function PageComponent() {
  const [screenshotShow, setScreenshotShow] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const scenesQuery = useQuery({
    queryKey: ['stash-scenes', { q, page, pageSize }],
    queryFn: () => listScenesStash({
      filter: {
        page,
        page_size: pageSize,
        q: q || undefined,
        sort: 'updated_at',
        direction: 'DESC',
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
            <span className="block max-w-[320px] whitespace-pre-wrap text-sm">
              {row.original.files.map(f => f.basename).join('\n')}
            </span>
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
        header: '操作',
        id: 'action',
        enableSorting: false,
        cell: ({ row }) => {
          const videoPath = row.original.files?.[0]?.path
          if (!videoPath) {
            return (
              <Button size="sm" variant="tertiary" isDisabled>
                查询字幕
              </Button>
            )
          }

          return (
            <SubtitleWebModal
              videoPath={videoPath}
              trigger={({ setOpen }) => (
                <Button size="sm" variant="tertiary" onPress={() => setOpen(true)}>
                  查询字幕
                </Button>
              )}
            />
          )
        },
      },
    )
    return nextColumns
  }, [screenshotShow])

  const total = Number(scenesQuery.data?.total ?? 0)
  const totalPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex w-full max-w-md flex-col gap-1">
          <Label>搜索</Label>
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
        <Switch isSelected={screenshotShow} onChange={setScreenshotShow}>
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
        emptyText="暂无场景"
        getRowId={row => String(row.id)}
        loading={scenesQuery.isFetching}
        minWidth={760}
        showPagination={false}
      />
      <div className="flex items-center justify-end gap-2 text-sm text-muted">
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={page <= 1}
          onPress={() => setPage(prev => Math.max(1, prev - 1))}
        >
          上一页
        </Button>
        <span>
          {page}
          {' '}
          /
          {' '}
          {totalPage}
        </span>
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={page >= totalPage}
          onPress={() => setPage(prev => Math.min(totalPage, prev + 1))}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
