import type { ActionType, ProColumns } from '@ant-design/pro-components'
import type { Key } from 'react'
import type { VideoFolderScanItem } from '@/types/api'
import { SearchOutlined } from '@ant-design/icons'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'

import { App, Button, Input, List, Modal, Popconfirm, Space, Typography } from 'antd'
import { useCallback, useMemo, useRef, useState } from 'react'
import { FsDirTreeSelect } from '@/component/fs-dir-tree-select'
import { SubtitleWebModal } from '@/component/subtitle-web-modal'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { fetchFsDeleteSubtitle, fetchFsReadText, scanVideoFolder } from '@/request'

export const Route = createFileRoute('/video-folder-scan')({
  component: PageComponent,
})

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  const d = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(d)} ${units[i]}`
}

function PageComponent() {
  const { message } = App.useApp()
  const actionRef = useRef<ActionType>(null)

  const [rootDir, setRootDir] = useState('')
  const [data, setData] = useState<VideoFolderScanItem[]>([])
  const [loading, setLoading] = useState(false)

  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
  const [selectedRows, setSelectedRows] = useState<VideoFolderScanItem[]>([])

  const [subtitleModalOpen, setSubtitleModalOpen] = useState(false)
  const [subtitleTarget, setSubtitleTarget] = useState<VideoFolderScanItem | null>(null)

  const [subtitlePreviewOpen, setSubtitlePreviewOpen] = useState(false)
  const [subtitlePreviewTitle, setSubtitlePreviewTitle] = useState('')
  const [subtitlePreviewLoading, setSubtitlePreviewLoading] = useState(false)
  const [subtitlePreviewContent, setSubtitlePreviewContent] = useState('')

  const [deletingSubtitleKey, setDeletingSubtitleKey] = useState<string | null>(null)

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

  function joinVideoDir(videoPath: string, filename: string): string {
    const i1 = videoPath.lastIndexOf('/')
    const i2 = videoPath.lastIndexOf('\\')
    const i = Math.max(i1, i2)
    if (i < 0)
      return filename
    const base = videoPath.slice(0, i + 1)
    return `${base}${filename}`
  }

  async function openSubtitlePreview(videoPath: string, subtitleName: string) {
    const path = joinVideoDir(videoPath, subtitleName)
    setSubtitlePreviewTitle(subtitleName)
    setSubtitlePreviewContent('')
    setSubtitlePreviewOpen(true)
    setSubtitlePreviewLoading(true)
    try {
      const res = await fetchFsReadText({ path })
      setSubtitlePreviewContent(res.content ?? '')
    }
    catch (e) {
      setSubtitlePreviewContent('')
      message.error((e as Error).message || '读取字幕失败')
    }
    finally {
      setSubtitlePreviewLoading(false)
    }
  }

  function subtitleRowKey(videoPath: string, subtitleName: string): string {
    return `${videoPath}\u0000${subtitleName}`
  }

  async function deleteSubtitleFile(videoPath: string, subtitleName: string) {
    const path = joinVideoDir(videoPath, subtitleName)
    const key = subtitleRowKey(videoPath, subtitleName)
    setDeletingSubtitleKey(key)
    try {
      await fetchFsDeleteSubtitle({ path })
      message.success('字幕文件已删除')
      setData(prev =>
        prev.map((item) => {
          if (item.video_path !== videoPath)
            return item
          const names = item.subtitle_names ?? []
          return { ...item, subtitle_names: names.filter(n => n !== subtitleName) }
        }),
      )
    }
    catch (e) {
      message.error((e as Error).message || '删除失败')
    }
    finally {
      setDeletingSubtitleKey(null)
    }
  }

  const columns = useMemo<ProColumns<VideoFolderScanItem>[]>(() => {
    return [
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
        render: (_, row) => [
          <Button
            key="enqueue"
            type="link"
            className="m-0! p-0!"
            onClick={() => openSubtitleCreateSingle(row.video_path)}
          >
            字幕生成
          </Button>,
          <Button
            key="subtitle-web"
            type="link"
            className="m-0! p-0!"
            onClick={() => {
              setSubtitleTarget(row)
              setSubtitleModalOpen(true)
            }}
          >
            网络字幕
          </Button>,
        ],
      },
    ]
  }, [openSubtitleCreateSingle])

  async function runScan() {
    const p = rootDir.trim()
    if (!p) {
      message.warning('请输入文件夹绝对路径')
      return
    }
    setLoading(true)
    try {
      const res = await scanVideoFolder({ root_dir: p })
      setData(res.items ?? [])
      actionRef.current?.reload()
    }
    catch (e) {
      message.error((e as Error).message || '查询失败')
      setData([])
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <PageContainer title="视频文件查询">
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
      <Modal
        title={subtitlePreviewTitle ? `字幕内容：${subtitlePreviewTitle}` : '字幕内容'}
        open={subtitlePreviewOpen}
        onCancel={() => {
          setSubtitlePreviewOpen(false)
          setSubtitlePreviewTitle('')
          setSubtitlePreviewContent('')
        }}
        footer={null}
        width={900}
        destroyOnHidden
      >
        <div className="max-h-[65vh] overflow-auto rounded bg-gray-50 p-3">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-5">
            {subtitlePreviewLoading ? '加载中...' : (subtitlePreviewContent || '（空）')}
          </pre>
        </div>
      </Modal>

      <SubtitleWebModal
        open={subtitleModalOpen}
        videoPath={subtitleTarget?.video_path ?? null}
        onClose={() => {
          setSubtitleModalOpen(false)
          setSubtitleTarget(null)
        }}
        onDownloaded={async () => {
          if (rootDir.trim())
            await runScan()
        }}
      />

      <ProTable<VideoFolderScanItem>
        rowKey="video_path"
        actionRef={actionRef}
        loading={loading}
        search={false}
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
                  const delKey = subtitleRowKey(row.video_path, name)
                  return (
                    <List.Item
                      className="!px-3 !py-2"
                      actions={[
                        <Button
                          key="preview"
                          type="link"
                          size="small"
                          className="m-0! p-0!"
                          onClick={() => void openSubtitlePreview(row.video_path, name)}
                        >
                          预览
                        </Button>,
                        <Popconfirm
                          key="delete"
                          title="删除字幕文件"
                          description={`确定从磁盘删除「${name}」？此操作不可恢复。`}
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => void deleteSubtitleFile(row.video_path, name)}
                        >
                          <Button
                            type="link"
                            danger
                            size="small"
                            className="m-0! p-0!"
                            loading={deletingSubtitleKey === delKey}
                          >
                            删除
                          </Button>
                        </Popconfirm>,
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
          selectedRowKeys,
          onChange: (keys, rows) => {
            setSelectedRowKeys(keys)
            setSelectedRows(rows)
          },
        }}
        toolBarRender={() => [
          <FsDirTreeSelect
            key="root"
            style={{ width: 520 }}
            value={rootDir}
            placeholder="请选择后端可访问的文件夹（递归扫描子目录）"
            onChange={setRootDir}
            onPressEnter={() => void runScan()}
          />,
          <Button key="scan" type="primary" loading={loading} onClick={() => void runScan()}>
            查询
          </Button>,
          <Button
            key="select-no-sub"
            disabled={!data.length}
            onClick={() => {
              const rows = data.filter(v => (v.subtitle_names ?? []).length === 0)
              setSelectedRows(rows)
              setSelectedRowKeys(rows.map(v => v.video_path))
            }}
          >
            选择无字幕
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
        columns={columns}
        dataSource={data}
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />
    </PageContainer>
  )
}
