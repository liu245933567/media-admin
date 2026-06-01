import type { ColumnDef } from '@tanstack/react-table'
import type { MediaVideoRow } from '@/api'
import { Chip, Drawer, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useEffect, useMemo, useState } from 'react'
import { formatBytes } from '@/utils'
import { getParentPath } from '@/utils/video-path'
import { DataTable } from './data-table'

const DEFAULT_PAGE_SIZE = 20

export interface VideoPlaylistDrawerProps {
  open: boolean
  onClose: () => void
  items: MediaVideoRow[]
  currentVideoPath: string
  onSelect: (item: MediaVideoRow) => void
  loading?: boolean
  rootName?: string
}

/** 播放页选集抽屉：分页浏览目录内视频并切换播放 */
export function VideoPlaylistDrawer({
  open,
  onClose,
  items,
  currentVideoPath,
  onSelect,
  loading = false,
  rootName,
}: VideoPlaylistDrawerProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const currentIndex = useMemo(
    () => items.findIndex(item => item.file_path === currentVideoPath),
    [items, currentVideoPath],
  )

  useEffect(() => {
    if (!open || currentIndex < 0)
      return
    setPage(Math.floor(currentIndex / pageSize) + 1)
  }, [open, currentIndex, pageSize])

  useEffect(() => {
    if (!open)
      return
    const maxPage = Math.max(1, Math.ceil(items.length / pageSize))
    if (page > maxPage)
      setPage(maxPage)
  }, [open, items.length, page, pageSize])

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  )

  const columns = useMemo<ColumnDef<MediaVideoRow, unknown>[]>(() => [
    {
      header: '视频',
      accessorKey: 'file_name',
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          {row.original.file_path === currentVideoPath && (
            <Chip color="accent" size="sm" variant="soft">
              播放中
            </Chip>
          )}
          <span className="truncate" title={row.original.file_name}>{row.original.file_name}</span>
        </span>
      ),
    },
    {
      header: '字幕',
      id: 'subtitle_count',
      cell: ({ row }) => {
        const n = row.original.subtitle_count ?? 0
        return n > 0 ? `${n}` : '-'
      },
    },
    {
      header: '目录',
      id: 'parent',
      cell: ({ row }) => {
        const parent = getParentPath(row.original.file_path)
        return (
          <span className="block max-w-[140px] truncate text-xs text-muted" title={parent}>
            {parent || '-'}
          </span>
        )
      },
    },
    {
      header: '大小',
      id: 'file_size',
      cell: ({ row }) => (
        <span className="text-xs text-muted">
          {formatBytes(Number(row.original.file_size))}
        </span>
      ),
    },
  ], [currentVideoPath])

  const totalPage = Math.max(1, Math.ceil(items.length / pageSize))

  return (
    <Drawer.Backdrop isOpen={open} onOpenChange={nextOpen => !nextOpen && onClose()}>
      <Drawer.Content placement="right" className="sm:max-w-[520px]">
        <Drawer.Dialog>
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>选集</Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body className="gap-3">
            {rootName && (
              <p className="m-0 truncate text-xs text-muted" title={rootName}>
                媒体路径：
                {rootName}
              </p>
            )}
            {loading
              ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-muted">
                    <Spinner size="sm" />
                    加载中...
                  </div>
                )
              : null}
            <div className="flex flex-col gap-2">
              <DataTable
                ariaLabel="视频选集"
                columns={columns}
                data={pageItems}
                emptyText="暂无视频，请先在设置页添加媒体路径并扫描"
                getRowId={row => row.file_path}
                minWidth={460}
                onRowPress={(row) => {
                  if (row.file_path !== currentVideoPath)
                    onSelect(row)
                }}
                showPagination={false}
              />
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span>
                  共
                  {' '}
                  {items.length}
                  {' '}
                  个视频
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded px-2 py-1 hover:bg-surface-secondary disabled:opacity-40"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  <span>
                    {page}
                    {' '}
                    /
                    {' '}
                    {totalPage}
                  </span>
                  <button
                    type="button"
                    className="rounded px-2 py-1 hover:bg-surface-secondary disabled:opacity-40"
                    disabled={page >= totalPage}
                    onClick={() => setPage(p => Math.min(totalPage, p + 1))}
                  >
                    下一页
                  </button>
                  <select
                    className="rounded border border-border bg-surface px-1 py-1"
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
            <p className="m-0 flex items-center gap-1 text-xs text-muted">
              <Icon className="size-3" icon="lucide:circle-play" />
              点击行切换播放
            </p>
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}
