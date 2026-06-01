import type { ColumnDef } from '@tanstack/react-table'
import type { MediaRootRow } from '@/api'
import { Button, Card, Modal } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  createRootMediaLibrary,
  deleteRootMediaLibrary,
  getListRootsMediaLibraryQueryKey,
  listRootsMediaLibrary,
  scanRootMediaLibrary,
} from '@/api'
import { useAppToast } from './app-toast'
import { useConfirmDialog } from './confirm-dialog'
import { DataTable } from './data-table'
import { RhfTextField } from './rhf-heroui-fields'

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
  })

  const columns = useMemo<ColumnDef<MediaRootRow, unknown>[]>(() => [
    {
      header: '名称',
      accessorKey: 'name',
      cell: ({ row }) => (
        <span className="block max-w-[180px] truncate" title={row.original.name}>
          {row.original.name}
        </span>
      ),
    },
    {
      header: '路径',
      accessorKey: 'path',
      cell: ({ row }) => (
        <span className="block max-w-[360px] truncate font-mono text-xs" title={row.original.path}>
          {row.original.path}
        </span>
      ),
    },
    {
      header: '上次扫描',
      accessorKey: 'last_scanned_at',
      cell: ({ row }) => row.original.last_scanned_at
        ? dayjs(row.original.last_scanned_at).format('YYYY-MM-DD HH:mm:ss')
        : <span className="text-muted">未扫描</span>,
    },
    {
      header: '操作',
      id: 'action',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="tertiary"
            isPending={scanRootMutation.isPending}
            onPress={() => scanRootMutation.mutate(Number(row.original.id))}
          >
            扫描
          </Button>
          <Button
            size="sm"
            variant="danger-soft"
            onPress={() => confirm({
              title: '删除媒体资源路径',
              description: '会同时删除该路径下已扫描入库的文件记录。',
              confirmText: '删除',
              danger: true,
              onConfirm: () => deleteRootMutation.mutateAsync(Number(row.original.id)),
            })}
          >
            删除
          </Button>
        </div>
      ),
    },
  ], [confirm, deleteRootMutation, scanRootMutation])

  function handleCreate(values: CreateRootValues) {
    createRootMutation.mutate({
      path: values.path.trim(),
      name: values.name?.trim() || undefined,
    })
  }

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
      <Card.Header className="items-center justify-between">
        <Card.Title>媒体资源路径</Card.Title>
        {showCreate
          ? (
              <Button onPress={() => setCreateOpen(true)}>
                添加媒体资源路径
              </Button>
            )
          : null}
      </Card.Header>
      <Card.Content>
        <DataTable
          ariaLabel="媒体资源路径"
          columns={columns}
          data={rootsQuery.data ?? []}
          emptyText="暂无媒体资源路径"
          getRowId={row => String(row.id)}
          loading={rootsQuery.isFetching}
          minWidth={860}
          showPagination={false}
        />
      </Card.Content>
    </Card>
  )
}
