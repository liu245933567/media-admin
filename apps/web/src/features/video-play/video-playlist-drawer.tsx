import type { ColumnDef } from '@tanstack/react-table'
import type { MediaVideoRow } from '@/api'
import { Chip, Drawer, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useMemo, useState } from 'react'
import { DataTable } from '@/components/data-table'
import { formatBytes } from '@/utils'
import { getParentPath } from '@/utils/video-path'

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
  const [pageState, setPageState] = useState({ page: 1, sessionKey: null as string | null })
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const currentIndex = useMemo(
    () => items.findIndex(item => item.file_path === currentVideoPath),
    [items, currentVideoPath],
  )

  const currentItemPage = currentIndex >= 0 ? Math.floor(currentIndex / pageSize) + 1 : null
  const sessionKey = getPlaylistSessionKey(open, currentVideoPath, items.length, pageSize)
  const requestedPage = pageState.sessionKey === sessionKey ? pageState.page : currentItemPage ?? 1
  const maxPage = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(Math.max(requestedPage, 1), maxPage)

  const pageItems = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, items, pageSize],
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
                locale={{ emptyText: '暂无视频，请先在设置页添加媒体路径并扫描' }}
                rowKey={row => row.file_path}
                scroll={{ x: 460 }}
                onRow={record => ({
                  onClick: record.file_path !== currentVideoPath ? () => onSelect(record) : undefined,
                })}
                pagination={{
                  showTotalLabel: '个视频',
                  current: currentPage,
                  pageSize,
                  pageSizeOptions: [10, 20, 50, 100],
                  total: items.length,
                  onChange: (nextPage, nextPageSize) => {
                    if (nextPageSize !== pageSize) {
                      setPageSize(nextPageSize)
                      const nextSessionKey = getPlaylistSessionKey(open, currentVideoPath, items.length, nextPageSize)
                      setPageState({ page: 1, sessionKey: nextSessionKey })
                    }
                    else {
                      setPageState({ page: nextPage, sessionKey })
                    }
                  },
                }}
              />
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

function getPlaylistSessionKey(
  open: boolean,
  currentVideoPath: string,
  itemCount: number,
  pageSize: number,
) {
  return open ? `${currentVideoPath}:${itemCount}:${pageSize}` : null
}
