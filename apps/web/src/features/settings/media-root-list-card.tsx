import type { MediaRootRow } from '@/api'
import { Button, Card, Dropdown, Modal, Spinner } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Icon } from '@iconify/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  createRootMediaLibrary,
  deleteRootMediaLibrary,
  getListRootsMediaLibraryQueryKey,
  listRootsMediaLibrary,
  scanRootMediaLibrary,
} from '@/api'
import { useAppToast } from '@/components/app-toast'
import { useConfirmDialog } from '@/components/confirm-dialog'
import { RhfTextField } from '@/components/rhf-heroui-fields'

export interface MediaRootListCardProps {
  onChanged?: () => void
  showCreate?: boolean
}

const createRootSchema = z.object({
  path: z.string().min(1, '请输入绝对路径'),
  name: z.string().optional(),
})

type CreateRootValues = z.infer<typeof createRootSchema>

export function MediaRootListCard({ onChanged, showCreate = true }: MediaRootListCardProps) {
  const message = useAppToast()
  const confirm = useConfirmDialog()
  const queryClient = useQueryClient()
  const mediaRootsQueryKey = getListRootsMediaLibraryQueryKey()
  const [createOpen, setCreateOpen] = useState(false)
  const [scanningRootId, setScanningRootId] = useState<number | null>(null)
  const form = useForm<CreateRootValues>({
    resolver: zodResolver(createRootSchema),
    defaultValues: {
      path: '',
      name: '',
    },
  })

  const rootsQuery = useQuery({
    queryKey: mediaRootsQueryKey,
    queryFn: listRootsMediaLibrary,
  })

  const createRootMutation = useMutation({
    mutationFn: (body: Parameters<typeof createRootMediaLibrary>[0]) => createRootMediaLibrary(body),
    onSuccess: async () => {
      message.success('媒体资源路径已添加')
      setCreateOpen(false)
      form.reset()
      await queryClient.invalidateQueries({ queryKey: mediaRootsQueryKey })
      onChanged?.()
    },
    onError: error => message.error(error.message ?? '添加失败'),
  })

  const deleteRootMutation = useMutation({
    mutationFn: (id: number) => deleteRootMediaLibrary(id),
    onSuccess: async () => {
      message.success('媒体资源路径已删除')
      await queryClient.invalidateQueries({ queryKey: mediaRootsQueryKey })
      onChanged?.()
    },
    onError: error => message.error(error.message ?? '删除失败'),
  })

  const scanRootMutation = useMutation({
    mutationFn: (id: number) => scanRootMediaLibrary(id),
    onSuccess: () => message.success('扫描任务已提交，可在任务管理查看进度'),
    onError: error => message.error(error.message ?? '提交失败'),
    onSettled: () => setScanningRootId(null),
  })

  function handleCreate(values: CreateRootValues) {
    createRootMutation.mutate({
      path: values.path.trim(),
      name: values.name?.trim() || undefined,
    })
  }

  function handleScan(rootId: number) {
    setScanningRootId(rootId)
    scanRootMutation.mutate(rootId)
  }

  function handleDelete(root: MediaRootRow) {
    confirm({
      title: '删除媒体资源路径',
      description: '会同时删除该路径下已扫描入库的文件记录。',
      confirmText: '删除',
      danger: true,
      onConfirm: () => deleteRootMutation.mutateAsync(Number(root.id)),
    })
  }

  const roots = rootsQuery.data ?? []
  const hasRoots = roots.length > 0

  return (
    <Card>
      <Modal.Backdrop
        isOpen={createOpen}
        onOpenChange={(nextOpen) => {
          setCreateOpen(nextOpen)
          if (!nextOpen)
            form.reset()
        }}
      >
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>添加媒体资源路径</Modal.Heading>
            </Modal.Header>
            <form onSubmit={form.handleSubmit(handleCreate)}>
              <Modal.Body>
                <div className="flex flex-col gap-4">
                  <RhfTextField
                    control={form.control}
                    name="path"
                    label="路径"
                    placeholder="例如 D:\\Media"
                  />
                  <RhfTextField
                    control={form.control}
                    name="name"
                    label="名称"
                    placeholder="留空时使用文件夹名称"
                  />
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={() => setCreateOpen(false)}>
                  取消
                </Button>
                <Button type="submit" isPending={createRootMutation.isPending}>
                  添加
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <Card.Header className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <Card.Title>媒体资源路径</Card.Title>
          <Card.Description>
            管理可扫描入库的本地视频目录。
          </Card.Description>
        </div>
        {showCreate
          ? (
              <Button className="shrink-0" onPress={() => setCreateOpen(true)}>
                <Icon className="size-4" icon="lucide:plus" />
                添加
              </Button>
            )
          : null}
      </Card.Header>
      <Card.Content className="pt-0">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2 text-sm">
          <span className="text-muted">已配置路径</span>
          <span className="tabular-nums text-foreground">
            {roots.length}
            {' '}
            个
          </span>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          {rootsQuery.isFetching && !hasRoots
            ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
                  <Spinner size="sm" />
                  加载中
                </div>
              )
            : hasRoots
              ? (
                  <ul className="divide-y divide-border">
                    {roots.map((root) => {
                      const rootId = Number(root.id)
                      const isScanning = scanningRootId === rootId && scanRootMutation.isPending
                      const lastScannedText = root.last_scanned_at
                        ? dayjs(root.last_scanned_at).format('YYYY-MM-DD HH:mm')
                        : '未扫描'

                      return (
                        <li key={root.id} className="grid gap-3 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <Icon className="size-4 shrink-0 text-muted" icon="lucide:folder" />
                              <span className="truncate text-sm font-medium text-foreground" title={root.name}>
                                {root.name}
                              </span>
                            </div>
                            <div className="mt-1 truncate pl-6 font-mono text-xs text-muted" title={root.path}>
                              {root.path}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pl-6 text-xs text-muted sm:block sm:pl-0">
                            <span className="sm:block">上次扫描</span>
                            <span className="tabular-nums text-foreground sm:mt-0.5 sm:block">
                              {lastScannedText}
                            </span>
                          </div>

                          <div className="flex justify-end">
                            <Dropdown>
                              <Dropdown.Trigger>
                                <Button
                                  size="sm"
                                  variant="tertiary"
                                  isPending={isScanning}
                                  isDisabled={deleteRootMutation.isPending}
                                >
                                  {isScanning ? '提交中' : '操作'}
                                  <Icon className="size-4" icon="lucide:chevron-down" />
                                </Button>
                              </Dropdown.Trigger>
                              <Dropdown.Popover>
                                <Dropdown.Menu
                                  onAction={(key) => {
                                    if (key === 'scan')
                                      handleScan(rootId)
                                    if (key === 'delete')
                                      handleDelete(root)
                                  }}
                                >
                                  <Dropdown.Item id="scan" textValue="扫描">
                                    <Icon className="size-4" icon="lucide:scan-line" />
                                    扫描
                                  </Dropdown.Item>
                                  <Dropdown.Item id="delete" textValue="删除">
                                    <Icon className="size-4 text-danger" icon="lucide:trash-2" />
                                    删除
                                  </Dropdown.Item>
                                </Dropdown.Menu>
                              </Dropdown.Popover>
                            </Dropdown>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )
              : (
                  <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                    <Icon className="size-8 text-muted" icon="lucide:folder-plus" />
                    <div>
                      <div className="text-sm font-medium text-foreground">暂无媒体资源路径</div>
                      <div className="mt-1 text-xs text-muted">添加本地目录后即可扫描入库。</div>
                    </div>
                  </div>
                )}
        </div>
      </Card.Content>
    </Card>
  )
}
