import { Alert, Button, Drawer, Spinner } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { deleteSubtitleFs, readTextFs } from '@/api'
import { useAppToast } from '@/components/app-toast'
import { useConfirmDialog } from '@/components/confirm-dialog'
import { deserializeSubtitleText } from '@/utils/subtitle'

export interface SubtitleDetailModalProps {
  /** 渲染触发器，将 open 绑定到点击等交互上以打开弹窗 */
  trigger: (props: { setOpen: (open: boolean) => void }) => React.ReactNode
  subtitlePath: string
  onDeleted?: () => void
}

export function SubtitleDetailModal({ trigger, subtitlePath, onDeleted }: SubtitleDetailModalProps) {
  const message = useAppToast()
  const confirm = useConfirmDialog()
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
      return (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" />
          加载中...
        </div>
      )
    }

    if (fsReadTextQuery.isError) {
      return (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>读取字幕失败</Alert.Title>
            <Alert.Description>{fsReadTextQuery.error?.message ?? '未知错误'}</Alert.Description>
          </Alert.Content>
        </Alert>
      )
    }

    return (
      <div className="flex flex-col gap-2 text-sm">
        {fsReadTextQuery.data?.map(item => (
          <div key={item.startTime} className="flex gap-4">
            <div className="shrink-0 text-muted">
              <span>{item.startTime}</span>
              ~
              <span>{item.endTime}</span>
            </div>

            <div className="min-w-0 flex-1 whitespace-pre-wrap">{item.text}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      {trigger({ setOpen: (nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          fsReadTextQuery.mutate()
        }
      } })}
      <Drawer.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Drawer.Content placement="right" className="sm:max-w-[1100px]">
          <Drawer.Dialog>
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>
                {subtitlePreviewTitle ? `字幕内容：${subtitlePreviewTitle}` : '字幕内容'}
              </Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>
              {renderSubtitleContent()}
            </Drawer.Body>
            <Drawer.Footer>
              <Button variant="secondary" onPress={() => fsReadTextQuery.mutate()}>
                刷新
              </Button>
              <Button
                variant="danger-soft"
                isPending={deleteSubtitleMutation.isPending}
                onPress={() => confirm({
                  title: '删除字幕文件',
                  description: `确定从磁盘删除「${subtitlePath}」？此操作不可恢复。`,
                  confirmText: '删除',
                  danger: true,
                  onConfirm: () => deleteSubtitleMutation.mutateAsync({ path: subtitlePath }),
                })}
              >
                删除
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  )
}
