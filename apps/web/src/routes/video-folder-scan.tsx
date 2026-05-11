import type { ActionType, ProColumns } from '@ant-design/pro-components'
import type { Key } from 'react'
import type { VideoFolderScanItem } from '@/types/api'
import { SearchOutlined } from '@ant-design/icons'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'

import { App, Button, Checkbox, Input, Modal, Space, Tag, Typography } from 'antd'
import { useMemo, useRef, useState } from 'react'
import { FsDirTreeSelect } from '@/component/fs-dir-tree-select'
import { SubtitleWebModal } from '@/component/subtitle-web-modal'
import { createSubtitleTask, createSubtitleTasksBulk, fetchFsReadText, scanVideoFolder } from '@/request'

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
  const { message, modal } = App.useApp()
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
            onClick={async () => {
              try {
                await createSubtitleTask({ config: { video_path: row.video_path } })
                message.success('任务已添加')
              }
              catch (e) {
                message.error((e as Error).message || '添加失败')
              }
            }}
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
  }, [message])

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
        destroyOnClose
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
              <div className="flex flex-col gap-1 py-1">
                {list.map(name => (
                  <div key={name}>
                    <Tag
                      className="cursor-pointer"
                      onClick={() => void openSubtitlePreview(row.video_path, name)}
                    >
                      {name}
                    </Tag>
                  </div>
                ))}
              </div>
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
            onClick={() => {
              let skipExisting = true
              modal.confirm({
                title: '批量字幕生成',
                content: (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1">
                      <span>已选择</span>
                      <span className="font-semibold">{selectedRows.length}</span>
                      <span>个视频</span>
                    </div>
                    <Checkbox
                      defaultChecked
                      onChange={(e) => {
                        skipExisting = e.target.checked
                      }}
                    >
                      跳过已存在字幕文件的条目
                    </Checkbox>
                  </div>
                ),
                okText: '开始生成',
                cancelText: '取消',
                onOk: async () => {
                  const targets = (skipExisting
                    ? selectedRows.filter(v => (v.subtitle_names ?? []).length === 0)
                    : selectedRows)

                  if (!targets.length) {
                    message.warning('没有需要生成的条目（可能都已存在字幕）')
                    return
                  }

                  try {
                    const res = await createSubtitleTasksBulk({
                      configs: targets.map(v => ({ video_path: v.video_path })),
                      skip_if_exists: true,
                    })

                    const ok = res.created?.length ?? 0
                    const skipped = res.skipped?.length ?? 0
                    const failed = res.failed ?? []

                    if (failed.length === 0) {
                      const parts = [
                        `已添加 ${ok} 个任务`,
                        skipped ? `跳过 ${skipped} 个（已在队列中）` : '',
                      ].filter(Boolean)
                      message.success(parts.join('，'))
                      return
                    }

                    message.warning(`已添加 ${ok} 个任务，跳过 ${skipped} 个，失败 ${failed.length} 个（打开控制台查看详情）`)
                    console.error('[bulk subtitle generate] failed:', failed)
                  }
                  catch (e) {
                    message.error((e as Error).message || '批量添加失败')
                  }
                },
              })
            }}
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
