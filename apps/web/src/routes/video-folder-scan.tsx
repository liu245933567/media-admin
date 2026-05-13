import type { ActionType, ProColumns } from '@ant-design/pro-components'
import type { VideoFolderScanItem } from '@/types/api'
import { SearchOutlined } from '@ant-design/icons'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { useMutation } from '@tanstack/react-query'

import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Input, List, Popconfirm, Space, Table, Tooltip, Typography } from 'antd'
import { useCallback, useRef, useState } from 'react'
import { FsDirTreeSelect } from '@/component/fs-dir-tree-select'
import { SubtitleWebModal } from '@/component/subtitle-web-modal'
import { SubtitleDetailModal } from '@/components/subtitle-detail'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { fetchFsDeleteSubtitleApi, scanVideoFolder } from '@/request'
import { formatBytes } from '@/utils'

function getParentPath(videoPath: string): string {
  const i1 = videoPath.lastIndexOf('/')
  const i2 = videoPath.lastIndexOf('\\')
  const i = Math.max(i1, i2)
  if (i < 0)
    return ''
  return videoPath.slice(0, i)
}

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

function filterConfig(): ProColumns<VideoFolderScanItem> {
  return {
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
  }
}

export const Route = createFileRoute('/video-folder-scan')({
  component: PageComponent,
})

function PageComponent() {
  const actionRef = useRef<ActionType>(null)
  const { message } = App.useApp()

  const [params, setParams] = useState<{ rootDir: string }>({ rootDir: '' })

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
        params={params}
        request={async (params) => {
          const res = await scanVideoFolder({ root_dir: params.rootDir })
          return {
            data: res.items,
            success: true,
          }
        }}
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
                dataSource={list}
                className="ml-4!"
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
        manualRequest
        rowSelection={{
          selectedRowKeys: selectedRows.map(v => v.video_path),
          onChange: (_keys, rows) => {
            setSelectedRows(rows)
          },
        }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        toolBarRender={(_action, { selectedRows }) => [
          <Button
            key="bulk-enqueue"
            type="primary"
            disabled={!selectedRows?.length}
            onClick={() => openSubtitleCreateBulk(selectedRows ?? [])}
          >
            批量字幕生成
          </Button>,
        ]}
        onRequestError={(error) => {
          message.error(error.message ?? '查询失败')
        }}
        toolbar={{
          search: {
            onSearch: (value) => {
              setParams(prev => ({ ...prev, rootDir: value }))
            },
          },
        }}
        columns={[
          {
            title: '视频名称',
            dataIndex: 'video_name',
            ellipsis: true,
            search: false,
            copyable: true,
            ...filterConfig(),
          },
          Table.EXPAND_COLUMN,
          {
            title: '字幕文件',
            dataIndex: 'subtitle_names',
            width: 110,
            search: false,
            render: (_, row) => {
              const list = row.subtitle_names ?? []
              if (!list.length)
                return <Typography.Text type="secondary">-</Typography.Text>
              return (
                <span>
                  {list.length}
                  个
                </span>
              )
            },
          },
          {
            title: '文件夹',
            dataIndex: 'video_path',
            ellipsis: true,
            search: false,
            render: (_, row) => {
              const parentPath = getParentPath(row.video_path)

              return (
                <Typography.Text ellipsis={{ tooltip: parentPath }} className="max-w-[min(52vw,36rem)]">
                  {parentPath}
                </Typography.Text>
              )
            },
          },
          {
            title: '视频大小',
            dataIndex: 'video_size',
            width: 120,
            search: false,
            render: (_, row) => formatBytes(Number(row.video_size)),
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
