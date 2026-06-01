import type { SubtitleWebRow } from '@/api'
import { DownloadOutlined } from '@ant-design/icons'
import { ProTable } from '@ant-design/pro-components'
import { useMutation, useQuery } from '@tanstack/react-query'
import { App, Button, Modal, Tooltip } from 'antd'
import { useState } from 'react'
import { downloadSubtitleWeb, searchSubtitleWeb } from '@/api'

function DownloadButton({ videoPath, subtitle, onDownloaded }: { videoPath: string, subtitle: SubtitleWebRow, onDownloaded?: () => void }) {
  const { message } = App.useApp()

  const downloadSubtitleToDiskMutation = useMutation({
    mutationFn: (body: Parameters<typeof downloadSubtitleWeb>[0]) => downloadSubtitleWeb(body),
    onSuccess: (data) => {
      message.success(`已下载 ${data.subtitle_path}`)
      onDownloaded?.()
    },
    onError: (error) => {
      message.error(error.message ?? '下载失败')
    },
  })
  return (
    <Tooltip title="下载到与视频同目录">
      <Button
        loading={downloadSubtitleToDiskMutation.isPending}
        type="text"
        icon={<DownloadOutlined />}
        onClick={() => downloadSubtitleToDiskMutation.mutate({ video_path: videoPath, subtitle_id: subtitle.id })}
      />
    </Tooltip>
  )
}

export interface SubtitleWebModalProps {
  trigger: (props: { setOpen: (open: boolean) => void }) => React.ReactNode
  videoPath: string
  onClose?: () => void
  onDownloaded?: () => void
}

export function SubtitleWebModal({
  trigger,
  videoPath,
  onClose,
  onDownloaded,
}: SubtitleWebModalProps) {
  const [open, setOpen] = useState(false)

  const subtitleWebSearchQuery = useQuery({
    queryKey: ['subtitle-web-search', videoPath],
    queryFn: () => searchSubtitleWeb({ video_path: videoPath }),
    enabled: false,
  })

  return (
    <>
      {trigger({ setOpen: (open) => {
        setOpen(open)
        if (open) {
          subtitleWebSearchQuery.refetch()
        }
      } })}
      <Modal
        title="网络字幕搜索/下载"
        open={open}
        onCancel={() => {
          setOpen(false)
          onClose?.()
        }}
        footer={null}
        width={900}
        destroyOnHidden
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="text-xs text-gray-500">
              当前视频
            </div>
            <div className="break-all font-mono text-xs">
              {videoPath}
            </div>
          </div>

          <ProTable<SubtitleWebRow>
            rowKey="id"
            search={false}
            options={false}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            loading={subtitleWebSearchQuery.isFetching}
            dataSource={subtitleWebSearchQuery.data?.items ?? []}
            locale={{ emptyText: '无候选字幕' }}
            columns={[
              { title: '名称', dataIndex: 'name', ellipsis: true },
              { title: '语言', dataIndex: 'langs', width: 120 },
              { title: '扩展名', dataIndex: 'ext', width: 90 },
              {
                title: 'Hash 匹配',
                dataIndex: 'is_hash_match',
                width: 100,
                render: (_, row) => (row.is_hash_match ? '是' : '否'),
              },
              {
                title: '操作',
                width: 140,
                render: (_, row) => (
                  <DownloadButton videoPath={videoPath} subtitle={row} onDownloaded={onDownloaded} />
                ),
              },
            ]}
          />
        </div>
      </Modal>
    </>
  )
}
