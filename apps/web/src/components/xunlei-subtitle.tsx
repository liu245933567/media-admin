import type { ColumnDef } from '@tanstack/react-table'
import type { SubtitleWebRow } from '@/api'
import { Button, Drawer } from '@heroui/react'
import { useMemo, useState } from 'react'
import { DataTable } from './data-table'

interface XunleiSubtitleSearchDrawerProps {
  trigger: React.ReactNode
}

export function XunleiSubtitleSearchDrawer({ trigger }: XunleiSubtitleSearchDrawerProps) {
  const [open, setOpen] = useState(false)
  const columns = useMemo<ColumnDef<SubtitleWebRow, unknown>[]>(
    () => [
      { header: 'ID', accessorKey: 'id' },
      { header: '名称', accessorKey: 'name' },
      { header: '语言', accessorKey: 'langs' },
      { header: '扩展名', accessorKey: 'ext' },
      {
        header: 'Hash 匹配',
        accessorKey: 'is_hash_match',
        cell: ({ row }) => row.original.is_hash_match ? '是' : '否',
      },
      {
        header: '操作',
        id: 'action',
        enableSorting: false,
        cell: () => (
          <Button size="sm" variant="tertiary">
            下载
          </Button>
        ),
      },
    ],
    [],
  )

  return (
    <>
      <Button variant="ghost" onPress={() => setOpen(true)}>{trigger}</Button>
      <Drawer.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>迅雷字幕</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>
              <DataTable
                ariaLabel="迅雷字幕"
                columns={columns}
                data={[]}
                emptyText="暂无字幕"
                getRowId={row => String(row.id)}
                minWidth={760}
              />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  )
}
