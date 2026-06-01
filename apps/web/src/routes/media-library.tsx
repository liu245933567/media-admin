import type { ColumnDef } from '@tanstack/react-table'
import type { MediaSubtitleRow, MediaVideoRow } from '@/api'
import { Button, Chip, Input, Label, ListBox, Popover, Select } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import {
  deleteVideosMediaLibrary,
  getListRootsMediaLibraryQueryKey,
  listFilesMediaLibrary,
  listRootsMediaLibrary,
} from '@/api'
import { AppPage } from '@/components/app-page'
import { useAppToast } from '@/components/app-toast'
import { useConfirmDialog } from '@/components/confirm-dialog'
import { DataTable } from '@/components/data-table'
import { SubtitleDetailModal } from '@/components/subtitle-detail'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { buildVideoPlaySearch } from '@/lib/video-play-search'
import { formatBytes } from '@/utils'

export const Route = createFileRoute('/media-library')({
  component: PageComponent,
})

function PageComponent() {
  const message = useAppToast()
  const confirm = useConfirmDialog()
  const navigate = useNavigate()
  const [selectedRows, setSelectedRows] = useState<MediaVideoRow[]>([])
  const [subtitleTaskCreateOpen, setSubtitleTaskCreateOpen] = useState(false)
  const [subtitleTaskCreateInitialPath, setSubtitleTaskCreateInitialPath]
    = useState<string | undefined>()
  const [subtitleTaskBulkRows, setSubtitleTaskBulkRows] = useState<
    MediaVideoRow[] | undefined
  >()
  const [rootId, setRootId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [hasSubtitle, setHasSubtitle] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const rootsQuery = useQuery({
    queryKey: getListRootsMediaLibraryQueryKey(),
    queryFn: listRootsMediaLibrary,
  })

  const filesQuery = useQuery({
    queryKey: ['media-library-files', { rootId, q, hasSubtitle, page, pageSize }],
    queryFn: () => listFilesMediaLibrary({
      root_id: rootId ? Number(rootId) : undefined,
      q: q || undefined,
      has_subtitle:
        hasSubtitle == null
          ? undefined
          : hasSubtitle === 'true',
      current: page,
      page_size: pageSize,
    }),
  })

  const reloadList = useCallback(() => {
    void filesQuery.refetch()
  }, [filesQuery])

  const deleteVideosMutation = useMutation({
    mutationFn: (body: Parameters<typeof deleteVideosMediaLibrary>[0]) => deleteVideosMediaLibrary(body),
    onSuccess: (res) => {
      message.success(
        `已删除 ${res.deleted_videos} 个视频，${res.deleted_subtitles} 个字幕`,
      )
      setSelectedRows([])
      reloadList()
    },
    onError: error => message.error(error.message ?? '删除失败'),
  })

  const confirmDeleteVideos = useCallback(
    (rows: MediaVideoRow[]) => {
      if (!rows.length) {
        return
      }
      confirm({
        title: rows.length > 1 ? '批量删除视频' : '删除此视频',
        description: (
          <div className="space-y-2">
            <p className="m-0">
              将从磁盘删除
              <strong className="mx-1">
                {rows.length}
              </strong>
              个视频，并同步删除与视频相关的字幕文件。
            </p>
            <p className="m-0 text-neutral-500">
              此操作不可恢复。
            </p>
          </div>
        ),
        confirmText: '删除',
        danger: true,
        onConfirm: () =>
          deleteVideosMutation.mutateAsync({
            video_paths: rows.map(row => row.file_path),
          }),
      })
    },
    [confirm, deleteVideosMutation],
  )

  const openSubtitleCreateSingle = useCallback((videoPath: string) => {
    setSubtitleTaskBulkRows(undefined)
    setSubtitleTaskCreateInitialPath(videoPath)
    setSubtitleTaskCreateOpen(true)
  }, [])

  const openSubtitleCreateBulk = useCallback((rows: MediaVideoRow[]) => {
    setSubtitleTaskCreateInitialPath(undefined)
    setSubtitleTaskBulkRows(rows)
    setSubtitleTaskCreateOpen(true)
  }, [])

  const fileColumns = useMemo<ColumnDef<MediaVideoRow, unknown>[]>(
    () => [
      {
        header: '文件名',
        accessorKey: 'file_name',
        cell: ({ row }) => (
          <span className="block max-w-[260px] truncate" title={row.original.file_name}>
            {row.original.file_name}
          </span>
        ),
      },
      {
        header: '资源路径',
        accessorKey: 'root_id',
        cell: ({ row }) => {
          const root = (rootsQuery.data ?? []).find(
            item => Number(item.id) === Number(row.original.root_id),
          )
          return root?.name ?? row.original.root_id
        },
      },
      {
        header: '字幕数量',
        accessorKey: 'subtitle_count',
        enableSorting: false,
        cell: ({ row }) => (
          <SubtitleCountPopover
            videoName={row.original.file_name}
            subtitles={row.original.subtitles ?? []}
            onChanged={reloadList}
          />
        ),
      },
      {
        header: '大小',
        accessorKey: 'file_size',
        cell: ({ row }) => formatBytes(Number(row.original.file_size)),
      },
      {
        header: '修改时间',
        accessorKey: 'modified_at',
        cell: ({ row }) =>
          dayjs(row.original.modified_at).format('YYYY-MM-DD HH:mm:ss'),
      },
      {
        header: '完整路径',
        accessorKey: 'file_path',
        cell: ({ row }) => (
          <span className="block max-w-[360px] truncate font-mono text-xs" title={row.original.file_path}>
            {row.original.file_path}
          </span>
        ),
      },
      {
        header: '操作',
        id: 'action',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={() => {
                void navigate({
                  to: '/video-play',
                  search: buildVideoPlaySearch(row.original),
                })
              }}
            >
              <Icon className="size-4" icon="lucide:play" />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={() => openSubtitleCreateSingle(row.original.file_path)}
            >
              <Icon className="size-4" icon="lucide:captions" />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="danger-soft"
              onPress={() => confirmDeleteVideos([row.original])}
            >
              <Icon className="size-4" icon="lucide:trash-2" />
            </Button>
          </div>
        ),
      },
    ],
    [
      confirmDeleteVideos,
      navigate,
      openSubtitleCreateSingle,
      reloadList,
      rootsQuery.data,
    ],
  )

  const total = Number(filesQuery.data?.total ?? 0)
  const totalPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <AppPage title="媒体库">
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
        bulkSourceRows={subtitleTaskBulkRows?.map(mediaVideoToScanItem)}
        onCreated={reloadList}
      />
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_220px_180px_auto] md:items-end">
          <div className="flex flex-col gap-1">
            <Label>文件名</Label>
            <Input
              value={q}
              placeholder="搜索文件名"
              variant="secondary"
              onChange={(event) => {
                setQ(event.target.value)
                setPage(1)
              }}
            />
          </div>
          <Select
            selectedKey={rootId}
            onSelectionChange={(key) => {
              setRootId(key as string | null)
              setPage(1)
            }}
          >
            <Label>资源路径</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="" textValue="全部">
                  全部
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {(rootsQuery.data ?? []).map(root => (
                  <ListBox.Item key={root.id} id={String(root.id)} textValue={root.name}>
                    {root.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <Select
            selectedKey={hasSubtitle}
            onSelectionChange={(key) => {
              setHasSubtitle(key as string | null)
              setPage(1)
            }}
          >
            <Label>是否有字幕</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="" textValue="全部">
                  全部
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="true" textValue="有字幕">
                  有字幕
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="false" textValue="无字幕">
                  无字幕
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <div className="flex gap-2">
            <Button
              variant="danger-soft"
              isDisabled={!selectedRows.length}
              isPending={deleteVideosMutation.isPending}
              onPress={() => confirmDeleteVideos(selectedRows)}
            >
              批量删除
            </Button>
            <Button
              isDisabled={!selectedRows.length}
              onPress={() => openSubtitleCreateBulk(selectedRows)}
            >
              批量生成字幕
            </Button>
          </div>
        </div>
        <DataTable
          ariaLabel="媒体文件"
          columns={fileColumns}
          data={filesQuery.data?.data ?? []}
          emptyText="暂无媒体文件"
          enableRowSelection
          getRowId={row => String(row.id)}
          loading={filesQuery.isFetching}
          minWidth={1120}
          onRowSelectionChange={setSelectedRows}
          showPagination={false}
        />
        <div className="flex flex-col gap-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            共
            {' '}
            {total}
            {' '}
            个视频
          </span>
          <div className="flex items-center gap-2">
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
            <select
              className="rounded border border-border bg-surface px-2 py-1"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
            >
              {[10, 20, 50, 100].map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </AppPage>
  )
}

function mediaVideoToScanItem(row: MediaVideoRow) {
  return {
    video_name: row.file_name,
    video_path: row.file_path,
    video_size: Number(row.file_size),
    subtitle_names: row.subtitles.map(subtitle => subtitle.file_name),
  }
}

function SubtitleCountPopover({
  videoName,
  subtitles,
  onChanged,
}: {
  videoName: string
  subtitles: MediaSubtitleRow[]
  onChanged: () => void
}) {
  if (!subtitles.length) {
    return <Chip size="sm" variant="soft">0</Chip>
  }

  return (
    <Popover>
      <Button size="sm" variant="tertiary">
        {subtitles.length}
      </Button>
      <Popover.Content>
        <div className="flex min-w-64 max-w-[28rem] flex-col gap-2 p-2">
          {subtitles.map(subtitle => (
            <div key={subtitle.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm" title={subtitle.file_name}>
                {subtitleDisplayName(videoName, subtitle.file_name)}
              </span>
              <SubtitleDetailModal
                subtitlePath={subtitle.file_path}
                onDeleted={onChanged}
                trigger={({ setOpen }) => (
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={() => setOpen(true)}
                  >
                    详情
                  </Button>
                )}
              />
            </div>
          ))}
        </div>
      </Popover.Content>
    </Popover>
  )
}

function subtitleDisplayName(videoName: string, subtitleName: string): string {
  const videoStem = trimExtension(videoName)
  const subtitleStem = trimExtension(subtitleName)
  const subtitleExt = subtitleName.slice(subtitleStem.length)
  if (subtitleStem === videoStem) {
    return subtitleExt || subtitleName
  }
  const prefix = `${videoStem}.`
  if (subtitleStem.startsWith(prefix)) {
    return `${subtitleStem.slice(prefix.length)}${subtitleExt}`
  }
  return subtitleName
}

function trimExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  return idx > 0 ? fileName.slice(0, idx) : fileName
}
