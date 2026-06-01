import type { Selection } from '@heroui/react'
import type { ColumnDef, PaginationState, RowSelectionState, SortingState } from '@tanstack/react-table'
import { Button, Checkbox, Spinner, Table } from '@heroui/react'
import { Icon } from '@iconify/react'
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'

export interface DataTableProps<TData> {
  ariaLabel: string
  data: TData[]
  columns: ColumnDef<TData, unknown>[]
  getRowId?: (row: TData, index: number) => string
  loading?: boolean
  emptyText?: string
  pageSize?: number
  enableRowSelection?: boolean
  onRowSelectionChange?: (rows: TData[]) => void
  onRowPress?: (row: TData) => void
  minWidth?: number
  showPagination?: boolean
}

export function DataTable<TData>({
  ariaLabel,
  data,
  columns,
  getRowId,
  loading,
  emptyText = '暂无数据',
  pageSize = 10,
  enableRowSelection,
  onRowSelectionChange,
  onRowPress,
  minWidth = 720,
  showPagination = true,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  })

  const tableColumns = useMemo(() => {
    if (!enableRowSelection)
      return columns
    const selectColumn: ColumnDef<TData> = {
      id: '__select',
      size: 40,
      header: () => (
        <Checkbox
          aria-label="选择全部"
          slot="selection"
        >
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
        </Checkbox>
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`选择第 ${row.index + 1} 行`}
          slot="selection"
          variant="secondary"
        >
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
        </Checkbox>
      ),
      enableSorting: false,
    }
    return [selectColumn, ...columns]
  }, [columns, enableRowSelection])

  const table = useReactTable({
    data,
    columns: tableColumns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: {
      sorting,
      rowSelection,
      pagination,
    },
    enableRowSelection,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
  })
  const headerGroup = table.getHeaderGroups()[0]
  const rowHeaderColumnId = headerGroup?.headers.find(header => header.id !== '__select')?.id
    ?? headerGroup?.headers[0]?.id
  const selectedKeys = useMemo<Selection>(
    () => new Set(
      Object.entries(rowSelection)
        .filter(([, selected]) => selected)
        .map(([rowId]) => rowId),
    ),
    [rowSelection],
  )

  function handleSelectionChange(keys: Selection) {
    const nextSelection: RowSelectionState = {}
    const selectedRowIds = keys === 'all'
      ? table.getRowModel().rows.map(row => row.id)
      : Array.from(keys).map(key => String(key))

    for (const rowId of selectedRowIds) {
      nextSelection[rowId] = true
    }

    setRowSelection(nextSelection)
    onRowSelectionChange?.(
      table.getCoreRowModel().rows
        .filter(row => nextSelection[row.id])
        .map(row => row.original),
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content
            aria-label={ariaLabel}
            selectedKeys={enableRowSelection ? selectedKeys : undefined}
            selectionMode={enableRowSelection ? 'multiple' : undefined}
            style={{ minWidth }}
            onSelectionChange={enableRowSelection ? handleSelectionChange : undefined}
          >
            <Table.Header>
              {headerGroup?.headers.map(header => (
                <Table.Column
                  key={header.id}
                  allowsSorting={header.column.getCanSort()}
                  className={header.id === '__select' ? 'w-10 pr-0' : undefined}
                  id={header.id}
                  isRowHeader={header.id === rowHeaderColumnId}
                >
                  {header.column.getCanSort()
                    ? (
                        <button
                          type="button"
                          className="flex w-full items-center gap-1 text-left"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <Icon
                            className="size-3 text-muted"
                            icon={
                              header.column.getIsSorted() === 'desc'
                                ? 'lucide:chevron-down'
                                : header.column.getIsSorted() === 'asc'
                                  ? 'lucide:chevron-up'
                                  : 'lucide:chevrons-up-down'
                            }
                          />
                        </button>
                      )
                    : (
                        <span className="flex w-full items-center gap-1 text-left">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                      )}
                </Table.Column>
              ))}
            </Table.Header>
            <Table.Body>
              {loading
                ? (
                    <Table.Row>
                      <Table.Cell colSpan={tableColumns.length}>
                        <div className="flex items-center justify-center gap-2 py-8 text-muted">
                          <Spinner size="sm" />
                          加载中
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  )
                : table.getRowModel().rows.length
                  ? (
                      table.getRowModel().rows.map(row => (
                        <Table.Row
                          key={row.id}
                          id={row.id}
                          className={onRowPress ? 'cursor-pointer' : undefined}
                          onClick={() => onRowPress?.(row.original)}
                        >
                          {row.getVisibleCells().map(cell => (
                            <Table.Cell key={cell.id} className={cell.column.id === '__select' ? 'pr-0' : undefined}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </Table.Cell>
                          ))}
                        </Table.Row>
                      ))
                    )
                  : (
                      <Table.Row>
                        <Table.Cell colSpan={tableColumns.length}>
                          <div className="py-8 text-center text-sm text-muted">{emptyText}</div>
                        </Table.Cell>
                      </Table.Row>
                    )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
        {showPagination
          ? (
              <Table.Footer>
                <div className="flex items-center justify-between gap-3 px-2 py-2 text-sm text-muted">
                  <span>
                    第
                    {' '}
                    {table.getState().pagination.pageIndex + 1}
                    {' '}
                    /
                    {' '}
                    {Math.max(table.getPageCount(), 1)}
                    {' '}
                    页
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={!table.getCanPreviousPage()}
                      onPress={() => table.previousPage()}
                    >
                      上一页
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={!table.getCanNextPage()}
                      onPress={() => table.nextPage()}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              </Table.Footer>
            )
          : null}
      </Table>
    </div>
  )
}
