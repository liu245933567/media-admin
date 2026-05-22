import type { ActionType, ProColumns } from '@ant-design/pro-components'
import type { MediaSubtitleRow, MediaVideoRow } from '@/types'
import { DownOutlined } from '@ant-design/icons'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { App, Button, Dropdown, List, Popover, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useMemo, useRef, useState } from 'react'
import { SubtitleDetailModal } from '@/components/subtitle-detail'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { buildVideoPlaySearch } from '@/lib/video-play-search'
import {
  deleteMediaVideos,
  fetchMediaFiles,
  fetchMediaRoots,
  mediaRootsQueryKey,
} from '@/request'
import { formatBytes } from '@/utils'

export const Route = createFileRoute('/media-library')({
  component: PageComponent,
})

function PageComponent() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const filesActionRef = useRef<ActionType>(null)
  const [fileKeyword, setFileKeyword] = useState('')
  const [selectedRows, setSelectedRows] = useState<MediaVideoRow[]>([])
  const [subtitleTaskCreateOpen, setSubtitleTaskCreateOpen] = useState(false)
  const [subtitleTaskCreateInitialPath, setSubtitleTaskCreateInitialPath] = useState<string | undefined>()
  const [subtitleTaskBulkRows, setSubtitleTaskBulkRows] = useState<MediaVideoRow[] | undefined>()

  const rootsQuery = useQuery({
    queryKey: mediaRootsQueryKey,
    queryFn: fetchMediaRoots,
  })

  const rootOptions = useMemo(() => {
    return (rootsQuery.data ?? []).map(root => ({
      label: root.name,
      value: Number(root.id),
    }))
  }, [rootsQuery.data])

  const reloadList = useCallback(() => {
    filesActionRef.current?.reload()
  }, [])

  const deleteVideosMutation = useMutation({
    mutationFn: deleteMediaVideos,
    onSuccess: (res) => {
      message.success(`已删除 ${res.deleted_videos} 个视频，${res.deleted_subtitles} 个字幕`)
      setSelectedRows([])
      reloadList()
    },
    onError: error => message.error(error.message ?? '删除失败'),
  })

  const confirmDeleteVideos = useCallback((rows: MediaVideoRow[]) => {
    if (!rows.length) {
      return
    }
    modal.confirm({
      title: rows.length > 1 ? '批量删除视频' : '删除此视频',
      content: (
        <div className="space-y-2">
          <Typography.Paragraph className="mb-0">
            将从磁盘删除
            <Typography.Text strong className="mx-1">{rows.length}</Typography.Text>
            个视频，并同步删除与视频相关的字幕文件。
          </Typography.Paragraph>
          <Typography.Paragraph className="mb-0 text-neutral-500">
            此操作不可恢复。
          </Typography.Paragraph>
        </div>
      ),
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => deleteVideosMutation.mutateAsync({
        video_paths: rows.map(row => row.file_path),
      }),
    })
  }, [deleteVideosMutation, modal])

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

  const fileColumns = useMemo<ProColumns<MediaVideoRow>[]>(() => [
    {
      title: '文件名',
      dataIndex: 'file_name',
      ellipsis: true,
      copyable: true,
    },
    {
      title: '资源路径',
      dataIndex: 'root_id',
      width: 180,
      valueType: 'select',
      fieldProps: {
        options: rootOptions,
        showSearch: true,
        optionFilterProp: 'label',
      },
      render: (_, row) => {
        const root = (rootsQuery.data ?? []).find(item => Number(item.id) === Number(row.root_id))
        return root?.name ?? row.root_id
      },
    },
    {
      title: '字幕数量',
      dataIndex: 'subtitle_count',
      width: 110,
      search: false,
      render: (_, row) => (
        <SubtitleCountPopover
          videoName={row.file_name}
          subtitles={row.subtitles ?? []}
          onChanged={() => filesActionRef.current?.reload()}
        />
      ),
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      width: 120,
      search: false,
      render: (_, row) => formatBytes(Number(row.file_size)),
    },
    {
      title: '修改时间',
      dataIndex: 'modified_at',
      width: 180,
      search: false,
      render: (_, row) => dayjs(row.modified_at).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '完整路径',
      dataIndex: 'file_path',
      ellipsis: true,
      copyable: true,
      search: false,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 110,
      render: (_, row) => (
        <Dropdown
          menu={{
            items: [
              { key: 'play', label: '播放' },
              { key: 'delete', label: '删除此视频', danger: true },
              { key: 'generate', label: '生成字幕' },
            ],
            onClick: ({ key }) => {
              if (key === 'play') {
                void navigate({
                  to: '/video-play',
                  search: buildVideoPlaySearch(row),
                })
              }
              if (key === 'delete') {
                confirmDeleteVideos([row])
              }
              if (key === 'generate') {
                openSubtitleCreateSingle(row.file_path)
              }
            },
          }}
        >
          <Button type="link" className="m-0! p-0!">
            操作
            <DownOutlined />
          </Button>
        </Dropdown>
      ),
    },
  ], [confirmDeleteVideos, navigate, openSubtitleCreateSingle, rootOptions, rootsQuery.data])

  return (
    <PageContainer title={false}>
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
      />
      <Space direction="vertical" size={16} className="w-full">
        <ProTable<MediaVideoRow>
          rowKey="id"
          actionRef={filesActionRef}
          columns={fileColumns}
          request={async (params) => {
            const res = await fetchMediaFiles({
              root_id: params.root_id ? Number(params.root_id) : undefined,
              q: fileKeyword,
              current: params.current,
              page_size: params.pageSize,
            })
            return {
              data: res.data,
              total: Number(res.total),
              success: true,
            }
          }}
          search={{ labelWidth: 88 }}
          options={{ density: false, setting: false }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          rowSelection={{
            selectedRowKeys: selectedRows.map(row => row.id),
            onChange: (_, rows) => setSelectedRows(rows),
          }}
          toolBarRender={() => [
            <Button
              key="bulk-delete"
              danger
              disabled={!selectedRows.length}
              loading={deleteVideosMutation.isPending}
              onClick={() => confirmDeleteVideos(selectedRows)}
            >
              批量删除
            </Button>,
            <Button
              key="bulk-generate"
              type="primary"
              disabled={!selectedRows.length}
              onClick={() => openSubtitleCreateBulk(selectedRows)}
            >
              批量生成字幕
            </Button>,
          ]}
          toolbar={{
            search: {
              placeholder: '搜索文件名或路径',
              onSearch: (value) => {
                setFileKeyword(value.trim())
                filesActionRef.current?.reload()
              },
            },
          }}
        />
      </Space>
    </PageContainer>
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
    return <Tag>0</Tag>
  }

  const content = (
    <List
      size="small"
      dataSource={subtitles}
      className="min-w-64 max-w-[28rem]"
      renderItem={subtitle => (
        <List.Item
          actions={[
            <SubtitleDetailModal
              key="detail"
              subtitlePath={subtitle.file_path}
              onDeleted={onChanged}
              trigger={({ setOpen }) => (
                <Button
                  type="link"
                  size="small"
                  className="m-0! p-0!"
                  onClick={() => setOpen(true)}
                >
                  详情
                </Button>
              )}
            />,
          ]}
        >
          <Typography.Text ellipsis={{ tooltip: subtitle.file_name }}>
            {subtitleDisplayName(videoName, subtitle.file_name)}
          </Typography.Text>
        </List.Item>
      )}
    />
  )

  return (
    <Popover content={content} trigger="hover">
      <Tag color="blue" className="cursor-pointer">
        {subtitles.length}
      </Tag>
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
