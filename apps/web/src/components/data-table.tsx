import type { Selection } from '@heroui/react'
import type { ColumnDef, PaginationState, RowSelectionState, SortingState } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { ActionBar } from '@heroui-pro/react/action-bar'
import { Button, Checkbox, Chip, ListBox, Select, Separator, Spinner, Table, Tooltip } from '@heroui/react'
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
  pagination?: {
    page: number
    pageSize: number
    total: number
    pageSizeOptions?: readonly number[]
    itemLabel?: string
    onPageChange: (page: number) => void
    onPageSizeChange?: (pageSize: number) => void
  }
  selectionActionRender?: ((rows: TData[]) => ReactNode[])
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
  pagination: controlledPagination,
  selectionActionRender,
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
    getPaginationRowModel: showPagination && !controlledPagination ? getPaginationRowModel() : undefined,
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
  const selectedRows = useMemo(() => {
    const rows = table.getCoreRowModel().rows
    return rows.filter(row => rowSelection[row.id]).map(row => row.original)
  }, [rowSelection, table])

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

  function clearSelection() {
    setRowSelection({})
    onRowSelectionChange?.([])
  }

  const selectedCount = selectedRows.length
  const footerPagination = controlledPagination
  const footerPageCount = footerPagination
    ? Math.max(1, Math.ceil(footerPagination.total / footerPagination.pageSize))
    : Math.max(table.getPageCount(), 1)
  const footerPage = footerPagination?.page ?? table.getState().pagination.pageIndex + 1
  const footerTotal = footerPagination?.total
  const footerItemLabel = footerPagination?.itemLabel ?? '条'
  const footerPageSizeOptions = footerPagination?.pageSizeOptions ?? [10, 20, 50, 100]

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
        {showPagination || footerPagination
          ? (
              <Table.Footer>
                <div className="flex flex-col gap-2 px-2 py-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
                  <span className="tabular-nums">
                    {footerTotal == null
                      ? (
                          <>
                            第
                            {' '}
                            {footerPage}
                            {' '}
                            /
                            {' '}
                            {footerPageCount}
                            {' '}
                            页
                          </>
                        )
                      : (
                          <>
                            共
                            {' '}
                            {footerTotal}
                            {' '}
                            {footerItemLabel}
                          </>
                        )}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={footerPage <= 1}
                      onPress={() => {
                        if (footerPagination) {
                          footerPagination.onPageChange(Math.max(1, footerPage - 1))
                        }
                        else {
                          table.previousPage()
                        }
                      }}
                    >
                      上一页
                    </Button>
                    <span className="tabular-nums">
                      {footerPage}
                      {' '}
                      /
                      {' '}
                      {footerPageCount}
                    </span>
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={footerPage >= footerPageCount}
                      onPress={() => {
                        if (footerPagination) {
                          footerPagination.onPageChange(Math.min(footerPageCount, footerPage + 1))
                        }
                        else {
                          table.nextPage()
                        }
                      }}
                    >
                      下一页
                    </Button>
                    {footerPagination?.onPageSizeChange
                      ? (
                          <Select
                            aria-label="每页数量"
                            className="w-28"
                            value={String(footerPagination.pageSize)}
                            variant="secondary"
                            onChange={(key) => {
                              const next = Number(key)
                              if (!Number.isFinite(next))
                                return
                              footerPagination.onPageSizeChange?.(next)
                            }}
                          >
                            <Select.Trigger>
                              <Select.Value />
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                {footerPageSizeOptions.map(size => (
                                  <ListBox.Item key={size} id={String(size)} textValue={`${size} ${footerItemLabel}`}>
                                    {size}
                                    {' '}
                                    {footerItemLabel}
                                    <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                        )
                      : null}
                  </div>
                </div>
              </Table.Footer>
            )
          : null}
      </Table>
      {enableRowSelection
        ? (
            <ActionBar aria-label={`${ariaLabel} 批量操作`} isOpen={selectedCount > 0}>
              <ActionBar.Prefix>
                <Chip className="shrink-0 tabular-nums" size="sm">
                  已选
                  {' '}
                  {selectedCount}
                </Chip>
              </ActionBar.Prefix>
              {selectionActionRender
                ? (
                    <>
                      <Separator />
                      <ActionBar.Content>
                        {selectionActionRender(selectedRows)}
                      </ActionBar.Content>
                    </>
                  )
                : null}
              <Separator />
              <ActionBar.Suffix>
                <Tooltip delay={0}>
                  <Button
                    isIconOnly
                    aria-label="清空选择"
                    size="sm"
                    variant="ghost"
                    onPress={clearSelection}
                  >
                    <Icon className="size-4" icon="lucide:x" />
                  </Button>
                  <Tooltip.Content>清空选择</Tooltip.Content>
                </Tooltip>
              </ActionBar.Suffix>
            </ActionBar>
          )
        : null}
    </div>
  )
}
