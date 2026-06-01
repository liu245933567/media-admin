import { useMutation } from '@tanstack/react-query'
import { App, Button, Drawer, Popconfirm, Result, Space, Spin } from 'antd'
import { useMemo, useState } from 'react'
import { deleteSubtitleFs, readTextFs } from '@/api'
import { deserializeSubtitleText } from '@/utils/subtitle'

export interface SubtitleDetailModalProps {
  /** 渲染触发器，将 open 绑定到点击等交互上以打开弹窗 */
  trigger: (props: { setOpen: (open: boolean) => void }) => React.ReactNode
  subtitlePath: string
  onDeleted?: () => void
}

export function SubtitleDetailModal({ trigger, subtitlePath, onDeleted }: SubtitleDetailModalProps) {
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)

  const subtitlePreviewTitle = useMemo(() => {
    return subtitlePath.split('/').pop()
  }, [subtitlePath])

  const fsReadTextQuery = useMutation({
    mutationFn: async () => {
      const res = await readTextFs({ path: subtitlePath })
      return deserializeSubtitleText(res.content)
    },
  })

  const deleteSubtitleMutation = useMutation({
    mutationFn: (body: Parameters<typeof deleteSubtitleFs>[0]) => deleteSubtitleFs(body),
    onSuccess: () => {
      message.success('字幕文件已删除')
      setOpen(false)
      onDeleted?.()
    },
    onError: error => message.error(error.message ?? '删除失败'),
  })

  const renderSubtitleContent = () => {
    if (fsReadTextQuery.isPending) {
      return <Spin spinning />
    }

    if (fsReadTextQuery.isError) {
      return <Result status="error" title="读取字幕失败" subTitle={fsReadTextQuery.error?.message ?? '未知错误'} />
    }

    return (
      <div>
        {
          fsReadTextQuery.data?.map(item => (
            <div key={item.startTime} className="flex gap-4">
              <div className="text-gray-500">
                <span>{item.startTime}</span>
                ~
                <span>{item.endTime}</span>
              </div>

              <div className="flex-1">{item.text}</div>
            </div>
          ))
        }
      </div>
    )
  }

  return (
    <>
      {trigger({ setOpen: (open) => {
        setOpen(open)
        if (open) {
          fsReadTextQuery.mutate()
        }
      } })}
      <Drawer
        title={subtitlePreviewTitle ? `字幕内容：${subtitlePreviewTitle}` : '字幕内容'}
        open={open}
        loading={fsReadTextQuery.isPending}
        onClose={() => {
          setOpen(false)
        }}
        size={1100}
        footer={(
          <Space>
            <Button onClick={() => fsReadTextQuery.mutate()}>
              刷新
            </Button>
            <Popconfirm
              title="删除字幕文件"
              description={`确定从磁盘删除「${subtitlePath}」？此操作不可恢复。`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteSubtitleMutation.mutate({ path: subtitlePath })}
            >
              <Button danger loading={deleteSubtitleMutation.isPending}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        )}
        destroyOnHidden
      >
        {renderSubtitleContent()}
      </Drawer>
    </>
  )
}
