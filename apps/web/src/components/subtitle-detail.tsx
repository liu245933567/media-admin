import { useMutation } from '@tanstack/react-query'
import { Modal, Result, Spin } from 'antd'
import { useMemo, useState } from 'react'
import { fetchFsReadText } from '@/request'
import { deserializeSubtitleText } from '@/utils/subtitle'

export interface SubtitleDetailModalProps {
  /** 渲染触发器，将 open 绑定到点击等交互上以打开弹窗 */
  trigger: (props: { setOpen: (open: boolean) => void }) => React.ReactNode
  subtitlePath: string
}

export function SubtitleDetailModal({ trigger, subtitlePath }: SubtitleDetailModalProps) {
  const [open, setOpen] = useState(false)

  const subtitlePreviewTitle = useMemo(() => {
    return subtitlePath.split('/').pop()
  }, [subtitlePath])

  const fsReadTextQuery = useMutation({
    mutationFn: async () => {
      const res = await fetchFsReadText({ path: subtitlePath })
      return deserializeSubtitleText(res.content)
    },
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
            <div key={item.startTime}>
              <div>
                <span>{item.startTime}</span>
                ~
                <span>{item.endTime}</span>
              </div>

              <div>{item.text}</div>
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
      <Modal
        title={subtitlePreviewTitle ? `字幕内容：${subtitlePreviewTitle}` : '字幕内容'}
        open={open}
        loading={fsReadTextQuery.isPending}
        onCancel={() => {
          setOpen(false)
        }}
        footer={null}
        width={900}
        destroyOnHidden
      >
        {renderSubtitleContent()}
      </Modal>
    </>
  )
}
