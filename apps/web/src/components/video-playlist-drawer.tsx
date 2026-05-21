import type { VideoFolderScanItem } from '@/types/api'
import { PlayCircleOutlined } from '@ant-design/icons'
import { Drawer, Table, Tag, Typography } from 'antd'
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table'
import { useEffect, useMemo, useState } from 'react'
import { formatBytes } from '@/utils'
import { getParentPath } from '@/utils/video-path'

const DEFAULT_PAGE_SIZE = 20

export interface VideoPlaylistDrawerProps {
  open: boolean
  onClose: () => void
  items: VideoFolderScanItem[]
  currentVideoPath: string
  onSelect: (item: VideoFolderScanItem) => void
  loading?: boolean
  rootDir?: string
}

/** 播放页选集抽屉：分页浏览目录内视频并切换播放 */
export function VideoPlaylistDrawer({
  open,
  onClose,
  items,
  currentVideoPath,
  onSelect,
  loading = false,
  rootDir,
}: VideoPlaylistDrawerProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const currentIndex = useMemo(
    () => items.findIndex(item => item.video_path === currentVideoPath),
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

  const columns = useMemo<ColumnsType<VideoFolderScanItem>>(() => [
    {
      title: '视频',
      dataIndex: 'video_name',
      ellipsis: true,
      render: (_, row) => (
        <span className="flex min-w-0 items-center gap-1.5">
          {row.video_path === currentVideoPath && (
            <Tag color="blue" className="mr-0 shrink-0">
              播放中
            </Tag>
          )}
          <Typography.Text ellipsis={{ tooltip: row.video_name }}>
            {row.video_name}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: '字幕',
      width: 64,
      align: 'center',
      render: (_, row) => {
        const n = row.subtitle_names?.length ?? 0
        return n > 0 ? `${n}` : '—'
      },
    },
    {
      title: '目录',
      ellipsis: true,
      width: 140,
      render: (_, row) => {
        const parent = getParentPath(row.video_path)
        return (
          <Typography.Text type="secondary" ellipsis={{ tooltip: parent }} className="text-xs">
            {parent || '—'}
          </Typography.Text>
        )
      },
    },
    {
      title: '大小',
      width: 88,
      align: 'right',
      render: (_, row) => (
        <span className="text-xs text-[var(--ant-color-text-secondary)]">
          {formatBytes(Number(row.video_size))}
        </span>
      ),
    },
  ], [currentVideoPath])

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize,
    total: items.length,
    showSizeChanger: true,
    pageSizeOptions: [10, 20, 50, 100],
    showTotal: total => `共 ${total} 个视频`,
    onChange: (nextPage, nextSize) => {
      setPage(nextPage)
      if (nextSize !== pageSize)
        setPageSize(nextSize)
    },
  }

  return (
    <Drawer
      title="选集"
      placement="right"
      width={Math.min(520, typeof window !== 'undefined' ? window.innerWidth * 0.92 : 520)}
      open={open}
      onClose={onClose}
      destroyOnHidden
      styles={{ body: { padding: '12px 16px' } }}
    >
      {rootDir && (
        <Typography.Paragraph
          type="secondary"
          ellipsis={{ tooltip: rootDir }}
          className="mb-3! text-xs"
        >
          扫描目录：
          {rootDir}
        </Typography.Paragraph>
      )}
      <Table<VideoFolderScanItem>
        rowKey="video_path"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={pagination}
        onRow={record => ({
          className: [
            'cursor-pointer',
            record.video_path === currentVideoPath
              ? '[&>td]:bg-[var(--ant-color-primary-bg)]!'
              : 'hover:[&>td]:bg-[var(--ant-color-fill-tertiary)]!',
          ].join(' '),
          onClick: () => {
            if (record.video_path !== currentVideoPath)
              onSelect(record)
          },
        })}
        locale={{ emptyText: '暂无视频，请先在「本地视频」扫描目录' }}
      />
      <Typography.Text type="secondary" className="mt-2 block text-xs">
        <PlayCircleOutlined className="mr-1" />
        点击行切换播放；无目录上下文时将跳转本地视频页
      </Typography.Text>
    </Drawer>
  )
}
