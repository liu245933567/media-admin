import type { ActionType } from '@ant-design/pro-components'
import type { VideoFolderScanItem } from '@/types/api'
import { SearchOutlined } from '@ant-design/icons'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { useMutation } from '@tanstack/react-query'

import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Input, List, Popconfirm, Space, Tooltip, Typography } from 'antd'
import { useCallback, useRef, useState } from 'react'
import { FsDirTreeSelect } from '@/component/fs-dir-tree-select'
import { SubtitleWebModal } from '@/component/subtitle-web-modal'
import { SubtitleDetailModal } from '@/components/subtitle-detail'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { fetchFsDeleteSubtitleApi, scanVideoFolder } from '@/request'
import { formatBytes } from '@/utils'

function joinVideoDir(videoPath: string, filename: string): string {
  const i1 = videoPath.lastIndexOf('/')
  const i2 = videoPath.lastIndexOf('\\')
  const i = Math.max(i1, i2)
  if (i < 0)
    return filename
  const base = videoPath.slice(0, i + 1)
  return `${base}${filename}`
}

function DeleteSubtitleButton({ videoPath, subtitleName, onDeleted }: { videoPath: string, subtitleName: string, onDeleted?: () => void }) {
  const { message } = App.useApp()

  const subtitlePath = joinVideoDir(videoPath, subtitleName)

  const fetchFsDeleteSubtitleMutation = useMutation({
    mutationFn: fetchFsDeleteSubtitleApi,
    onSuccess: () => {
      message.success('字幕文件已删除')
      onDeleted?.()
    },
    onError: (error) => {
      message.error(error.message ?? '删除失败')
    },
  })

  return (
    <Popconfirm
      key="delete"
      title="删除字幕文件"
      description={`确定从磁盘删除「${subtitlePath}」？此操作不可恢复。`}
      okText="删除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      onConfirm={() => void fetchFsDeleteSubtitleMutation.mutate({ path: subtitlePath })}
    >
      <Button
        type="link"
        danger
        loading={fetchFsDeleteSubtitleMutation.isPending}
        size="small"
      >
        删除
      </Button>
    </Popconfirm>

  )
}

export const Route = createFileRoute('/video-folder-scan')({
  component: PageComponent,
})

function PageComponent() {
  const actionRef = useRef<ActionType>(null)
  const { message } = App.useApp()

  const [rootDir, setRootDir] = useState('')

  const [selectedRows, setSelectedRows] = useState<VideoFolderScanItem[]>([])

  const [subtitleTaskCreateOpen, setSubtitleTaskCreateOpen] = useState(false)
  const [subtitleTaskCreateInitialPath, setSubtitleTaskCreateInitialPath] = useState<string | undefined>()
  const [subtitleTaskBulkRows, setSubtitleTaskBulkRows] = useState<VideoFolderScanItem[] | undefined>()

  const openSubtitleCreateSingle = useCallback((videoPath: string) => {
    setSubtitleTaskBulkRows(undefined)
    setSubtitleTaskCreateInitialPath(videoPath)
    setSubtitleTaskCreateOpen(true)
  }, [])

  const openSubtitleCreateBulk = useCallback((rows: VideoFolderScanItem[]) => {
    setSubtitleTaskCreateInitialPath(undefined)
    setSubtitleTaskBulkRows(rows)
    setSubtitleTaskCreateOpen(true)
  }, [])

  const scanVideoFolderMutation = useMutation({
    mutationFn: () => scanVideoFolder({ root_dir: rootDir }),
    onError: (error) => {
      message.error(error.message ?? '查询失败')
    },
  })

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
        bulkSourceRows={subtitleTaskBulkRows}
      />

      <ProTable<VideoFolderScanItem>
        rowKey="video_path"
        actionRef={actionRef}
        search={false}
        loading={scanVideoFolderMutation.isPending}
        options={{ reload: false, density: false, setting: false }}
        expandable={{
          rowExpandable: row => (row.subtitle_names ?? []).length > 0,
          expandedRowRender: (row) => {
            const list = row.subtitle_names ?? []
            if (!list.length)
              return null
            return (
              <List
                size="small"
                bordered
                className="max-w-3xl bg-white"
                dataSource={list}
                renderItem={(name) => {
                  return (
                    <List.Item
                      actions={[
                        <SubtitleDetailModal
                          subtitlePath={joinVideoDir(row.video_path, name)}
                          key="preview"
                          trigger={({ setOpen }) => (
                            <Button
                              type="link"
                              size="small"
                              className="m-0! p-0!"
                              onClick={() => setOpen(true)}
                            >
                              预览
                            </Button>
                          )}
                        />,
                        <DeleteSubtitleButton
                          key="delete"
                          videoPath={row.video_path}
                          subtitleName={name}
                          onDeleted={() => {
                            actionRef.current?.reload()
                          }}
                        />,
                      ]}
                    >
                      <Typography.Text ellipsis={{ tooltip: name }} className="max-w-[min(52vw,36rem)]">
                        {name}
                      </Typography.Text>
                    </List.Item>
                  )
                }}
              />
            )
          },
        }}
        rowSelection={{
          selectedRowKeys: selectedRows.map(v => v.video_path),
          onChange: (_keys, rows) => {
            setSelectedRows(rows)
          },
        }}
        dataSource={scanVideoFolderMutation.data?.items ?? []}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        toolBarRender={() => [
          <FsDirTreeSelect
            key="root"
            style={{ width: 520 }}
            value={rootDir}
            placeholder="请选择后端可访问的文件夹（递归扫描子目录）"
            onChange={setRootDir}
            onPressEnter={() => scanVideoFolderMutation.mutate()}
          />,
          <Button
            key="scan"
            type="primary"
            loading={scanVideoFolderMutation.isPending}
            onClick={() => scanVideoFolderMutation.mutate()}
          >
            查询
          </Button>,
          <Button
            key="select-no-sub"
            disabled={!scanVideoFolderMutation.data?.items.length}
            onClick={() => {
              const rows = scanVideoFolderMutation.data?.items.filter(v => (v.subtitle_names ?? []).length === 0) ?? []
              setSelectedRows(rows)
            }}
          >
            选择无字幕视频
          </Button>,
          <Button
            key="bulk-enqueue"
            type="primary"
            disabled={!selectedRows.length}
            onClick={() => openSubtitleCreateBulk(selectedRows)}
          >
            批量字幕生成
          </Button>,
        ]}
        columns={[
          {
            title: '视频名称',
            dataIndex: 'video_name',
            width: 220,
            ellipsis: true,
            search: false,
            filterIcon: (filtered) => {
              return <SearchOutlined style={{ color: filtered ? '#1677ff' : undefined }} />
            },
            filterDropdown: ({ selectedKeys, setSelectedKeys, confirm, clearFilters, close }) => {
              const v = String(selectedKeys?.[0] ?? '')
              return (
                <div className="p-2">
                  <Input
                    autoFocus
                    placeholder="输入关键字筛选"
                    value={v}
                    onChange={(e) => {
                      const next = e.target.value
                      setSelectedKeys(next ? [next] : [])
                    }}
                    onPressEnter={() => confirm()}
                    style={{ width: 220 }}
                  />
                  <div className="mt-2">
                    <Space size={8}>
                      <Button
                        type="primary"
                        size="small"
                        onClick={() => confirm()}
                      >
                        确定
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          clearFilters?.()
                          confirm()
                        }}
                      >
                        重置
                      </Button>
                      <Button
                        size="small"
                        type="link"
                        onClick={() => close()}
                      >
                        关闭
                      </Button>
                    </Space>
                  </div>
                </div>
              )
            },
            onFilter: (val, record) => {
              const q = String(val ?? '').trim().toLowerCase()
              if (!q)
                return true
              return String(record.video_name ?? '').toLowerCase().includes(q)
            },
          },
          {
            title: '视频路径',
            dataIndex: 'video_path',
            ellipsis: true,
            search: false,
          },
          {
            title: '视频大小',
            dataIndex: 'video_size',
            width: 120,
            search: false,
            render: (_, row) => formatBytes(Number(row.video_size)),
          },
          {
            title: '字幕文件',
            dataIndex: 'subtitle_names',
            width: 110,
            search: false,
            render: (_, row) => {
              const list = row.subtitle_names ?? []
              if (!list.length)
                return <Typography.Text type="secondary">-</Typography.Text>
              return <span>{list.length}</span>
            },
          },
          {
            title: '操作',
            valueType: 'option',
            width: 200,
            render: (_, { video_path }, _index, action) => [
              <Button
                key="enqueue"
                type="link"
                className="m-0! p-0!"
                onClick={() => openSubtitleCreateSingle(video_path)}
              >
                生成字幕
              </Button>,
              <SubtitleWebModal
                key="subtitle-web"
                videoPath={video_path}
                trigger={({ setOpen }) => (
                  <Tooltip title="查询网络字幕">
                    <Button
                      type="link"
                      className="m-0! p-0!"
                      onClick={() => setOpen(true)}
                    >
                      查询网络字幕
                    </Button>
                  </Tooltip>
                )}
                onDownloaded={() => {
                  action?.reload()
                }}
              />,
            ],
          },
        ]}
      />
    </PageContainer>
  )
}
