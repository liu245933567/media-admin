import type { ColumnDef } from '@tanstack/react-table'
import type { SubtitleWebRow } from '@/api'
import { Button, Modal, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { downloadSubtitleWeb, searchSubtitleWeb } from '@/api'
import { useAppToast } from './app-toast'
import { DataTable } from './data-table'

function DownloadButton({ videoPath, subtitle, onDownloaded }: { videoPath: string, subtitle: SubtitleWebRow, onDownloaded?: () => void }) {
  const message = useAppToast()

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
    <Tooltip>
      <Button
        isIconOnly
        isPending={downloadSubtitleToDiskMutation.isPending}
        variant="tertiary"
        onPress={() => downloadSubtitleToDiskMutation.mutate({ video_path: videoPath, subtitle_id: subtitle.id })}
      >
        <Icon className="size-4" icon="lucide:download" />
      </Button>
      <Tooltip.Content>下载到与视频同目录</Tooltip.Content>
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

  const columns = useMemo<ColumnDef<SubtitleWebRow, unknown>[]>(
    () => [
      { header: '名称', accessorKey: 'name' },
      { header: '语言', accessorKey: 'langs' },
      { header: '扩展名', accessorKey: 'ext' },
      {
        header: 'Hash 匹配',
        accessorKey: 'is_hash_match',
        cell: ({ row }) => (row.original.is_hash_match ? '是' : '否'),
      },
      {
        header: '操作',
        id: 'action',
        enableSorting: false,
        cell: ({ row }) => (
          <DownloadButton videoPath={videoPath} subtitle={row.original} onDownloaded={onDownloaded} />
        ),
      },
    ],
    [onDownloaded, videoPath],
  )

  return (
    <>
      {trigger({ setOpen: (open) => {
        setOpen(open)
        if (open) {
          subtitleWebSearchQuery.refetch()
        }
      } })}
      <Modal.Backdrop
        isOpen={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen)
            onClose?.()
        }}
      >
        <Modal.Container size="lg" className="max-w-[900px]">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>网络字幕搜索/下载</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-muted">
                    当前视频
                  </div>
                  <div className="break-all font-mono text-xs">
                    {videoPath}
                  </div>
                </div>

                <DataTable
                  ariaLabel="网络字幕"
                  columns={columns}
                  data={subtitleWebSearchQuery.data?.items ?? []}
                  emptyText="无候选字幕"
                  getRowId={row => String(row.id)}
                  loading={subtitleWebSearchQuery.isFetching}
                  minWidth={760}
                />
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}
