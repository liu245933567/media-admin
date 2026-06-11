import type { ColumnDef } from '@tanstack/react-table'
import type { SubtitleWebRow } from '@/api'
import { Button, Modal, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
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
  trigger?: (props: { setOpen: (open: boolean) => void }) => React.ReactNode
  videoPath: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  onDownloaded?: () => void
}

export function SubtitleWebModal({
  trigger,
  videoPath,
  open,
  onOpenChange,
  onClose,
  onDownloaded,
}: SubtitleWebModalProps) {
  const [innerOpen, setInnerOpen] = useState(false)
  const resolvedOpen = open ?? innerOpen

  const {
    data: subtitleWebSearchData,
    isFetching: subtitleWebSearchFetching,
    refetch: refetchSubtitleWebSearch,
  } = useQuery({
    queryKey: ['subtitle-web-search', videoPath],
    queryFn: () => searchSubtitleWeb({ video_path: videoPath }),
    enabled: false,
  })

  function setResolvedOpen(open: boolean) {
    if (onOpenChange)
      onOpenChange(open)
    else
      setInnerOpen(open)

    if (!open)
      onClose?.()
  }

  useEffect(() => {
    if (resolvedOpen)
      void refetchSubtitleWebSearch()
  }, [refetchSubtitleWebSearch, resolvedOpen])

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
      {trigger?.({ setOpen: setResolvedOpen })}
      <Modal.Backdrop
        isOpen={resolvedOpen}
        onOpenChange={setResolvedOpen}
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
                  data={subtitleWebSearchData?.items ?? []}
                  locale={{ emptyText: '无候选字幕' }}
                  rowKey={row => String(row.id)}
                  loading={subtitleWebSearchFetching}
                  scroll={{ x: 760 }}
                />
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}
