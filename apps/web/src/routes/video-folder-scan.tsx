import type { ActionType, ProColumns } from '@ant-design/pro-components'
import type { Key } from 'react'
import type { VideoFolderScanItem } from '@/types/api'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'

import { App, Button, Checkbox, Input, Tag, Typography } from 'antd'
import { useMemo, useRef, useState } from 'react'
import { createSubtitleTask, createSubtitleTasksBulk, scanVideoFolder } from '@/request'

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

  const columns = useMemo<ProColumns<VideoFolderScanItem>[]>(() => {
    return [
      {
        title: '视频名称',
        dataIndex: 'video_name',
        width: 220,
        ellipsis: true,
        search: false,
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
        width: 320,
        search: false,
        render: (_, row) => {
          const list = row.subtitle_names ?? []
          if (!list.length)
            return <Typography.Text type="secondary">-</Typography.Text>
          return (
            <div className="flex flex-wrap gap-1">
              {list.map(name => (
                <Tag key={name}>
                  {name}
                </Tag>
              ))}
            </div>
          )
        },
      },
      {
        title: '操作',
        valueType: 'option',
        width: 120,
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
      <ProTable<VideoFolderScanItem>
        rowKey="video_path"
        actionRef={actionRef}
        loading={loading}
        search={false}
        options={{ reload: false, density: false, setting: false }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys, rows) => {
            setSelectedRowKeys(keys)
            setSelectedRows(rows)
          },
        }}
        toolBarRender={() => [
          <Input
            key="root"
            style={{ width: 520 }}
            value={rootDir}
            placeholder="请输入后端可访问的文件夹绝对路径（递归扫描子目录）"
            onChange={e => setRootDir(e.target.value)}
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
