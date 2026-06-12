import type { Selection } from '@heroui/react'
import type { ColumnDef, PaginationState, RowSelectionState, SortingState } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { ActionBar } from '@heroui-pro/react/action-bar'
import { Button, Checkbox, Chip, Separator, Spinner, Table, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { BasePagination } from '@/components/base-pagination'

/** 表格分页配置（同 antd TablePaginationConfig 子集） */
interface DataTablePaginationConfig {
  /** 当前页码 */
  current: number
  /** 每页条数 */
  pageSize: number
  /** 数据总数 */
  total: number
  /** 数据总量标签后缀，如 '个视频' */
  showTotalLabel?: string
  /** 指定每页可显示的数据条数 */
  pageSizeOptions?: readonly number[]
  /** 页码或 pageSize 变化时的回调 */
  onChange: (page: number, pageSize: number) => void
}

/** 表格行选择配置（同 antd rowSelection 子集） */
interface DataTableRowSelection<TData> {
  /** 选中项的行 key 数组 */
  selectedRowKeys?: string[]
  /** 选中项发生变化时的回调 */
  onChange?: (selectedRowKeys: string[], selectedRows: TData[]) => void
  /** 已选批量操作渲染函数 */
  actions?: (rows: TData[]) => ReactNode[]
}

/** 表格行属性回调返回值（同 antd onRow 子集） */
interface DataTableRowProps {
  /** 行点击回调 */
  onClick?: () => void
}

export interface DataTableProps<TData> {
  /** 表格 aria-label，用于无障碍访问 */
  ariaLabel: string
  /** 数据源 */
  data: TData[]
  /** 列定义（基于 @tanstack/react-table ColumnDef） */
  columns: ColumnDef<TData, unknown>[]
  /** 表格行 key 的取值，可为数据属性名字符串或取值函数（同 antd rowKey） */
  rowKey?: string | ((record: TData, index: number) => string)
  /** 加载中状态（同 antd loading） */
  loading?: boolean
  /** 国际化文案占位（同 antd locale 子集） */
  locale?: {
    /** 空数据提示文本 */
    emptyText?: string
  }
  /** 表格滚动配置（同 antd scroll 子集） */
  scroll?: {
    /** 横向滚动最小宽度 */
    x?: number | string
  }
  /** 分页配置：false 隐藏分页，对象开启受控分页（同 antd pagination） */
  pagination?: false | DataTablePaginationConfig
  /** 行选择配置（同 antd rowSelection） */
  rowSelection?: DataTableRowSelection<TData>
  /** 设置行属性回调（同 antd onRow） */
  onRow?: (record: TData, index: number) => DataTableRowProps
}

const PAGE_SIZE_DEFAULT = 10
const SCROLL_X_DEFAULT = 720
const EMPTY_TEXT_DEFAULT = '暂无数据'

export function DataTable<TData>(props: DataTableProps<TData>) {
  const {
    ariaLabel,
    data,
    columns,
    rowKey,
    loading,
    locale,
    scroll,
    pagination,
    rowSelection,
    onRow,
  } = props

  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelectionState, setRowSelectionState] = useState<RowSelectionState>({})
  const [localPagination, setLocalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE_DEFAULT,
  })

  const enableRowSelection = !!rowSelection

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

  const resolvedRowKey = useMemo(() => {
    if (rowKey === undefined)
      return undefined
    if (typeof rowKey === 'string') {
      return (record: TData) => String((record as Record<string, unknown>)[rowKey])
    }
    return rowKey
  }, [rowKey])

  const table = useReactTable({
    data,
    columns: tableColumns,
    getRowId: resolvedRowKey,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: pagination !== false && !pagination ? getPaginationRowModel() : undefined,
    state: {
      sorting,
      rowSelection: rowSelectionState,
      pagination: localPagination,
    },
    enableRowSelection,
    onSortingChange: setSorting,
    onPaginationChange: setLocalPagination,
    onRowSelectionChange: setRowSelectionState,
  })
  const headerGroup = table.getHeaderGroups()[0]
  const rowHeaderColumnId = headerGroup?.headers.find(header => header.id !== '__select')?.id
    ?? headerGroup?.headers[0]?.id
  const selectedKeys = useMemo<Selection>(
    () => new Set(
      Object.entries(rowSelectionState)
        .filter(([, selected]) => selected)
        .map(([rowId]) => rowId),
    ),
    [rowSelectionState],
  )
  const selectedRows = useMemo(() => {
    const rows = table.getCoreRowModel().rows
    return rows.filter(row => rowSelectionState[row.id]).map(row => row.original)
  }, [rowSelectionState, table])

  function handleSelectionChange(keys: Selection) {
    const nextSelection: RowSelectionState = {}
    const selectedRowIds = keys === 'all'
      ? table.getRowModel().rows.map(row => row.id)
      : Array.from(keys).map(key => String(key))

    for (const rowId of selectedRowIds) {
      nextSelection[rowId] = true
    }

    setRowSelectionState(nextSelection)
    const nextSelectedRows
      = table.getCoreRowModel().rows.filter(row => nextSelection[row.id]).map(row => row.original)
    const nextSelectedKeys = Object.keys(nextSelection)
    rowSelection?.onChange?.(nextSelectedKeys, nextSelectedRows)
  }

  function clearSelection() {
    setRowSelectionState({})
    rowSelection?.onChange?.([], [])
  }

  const selectedCount = selectedRows.length
  const footerPagination = pagination === false ? undefined : pagination
  const footerPageCount = footerPagination
    ? Math.max(1, Math.ceil(footerPagination.total / footerPagination.pageSize))
    : Math.max(table.getPageCount(), 1)
  const footerPage = footerPagination?.current ?? table.getState().pagination.pageIndex + 1
  const footerTotal = footerPagination?.total
  const footerShowTotalLabel = footerPagination?.showTotalLabel ?? '条'
  const footerPageSizeOptions = footerPagination?.pageSizeOptions ?? [10, 20, 50, 100]
  const localTotal = table.getPrePaginationRowModel().rows.length

  const scrollX = scroll?.x ?? SCROLL_X_DEFAULT

  return (
    <div className="flex flex-col gap-3">
      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content
            aria-label={ariaLabel}
            selectedKeys={enableRowSelection ? selectedKeys : undefined}
            selectionMode={enableRowSelection ? 'multiple' : undefined}
            style={{ minWidth: scrollX }}
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
                          className={onRow?.(row.original, row.index)?.onClick ? 'cursor-pointer' : undefined}
                          onClick={() => onRow?.(row.original, row.index)?.onClick?.()}
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
                          <div className="py-8 text-center text-sm text-muted">{locale?.emptyText ?? EMPTY_TEXT_DEFAULT}</div>
                        </Table.Cell>
                      </Table.Row>
                    )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
        {footerPagination !== undefined
          ? (
              <Table.Footer>
                <BasePagination
                  showSizeChanger={!!footerPagination}
                  className="px-2 py-2"
                  current={footerPage}
                  pageSize={footerPagination?.pageSize ?? table.getState().pagination.pageSize}
                  pageSizeOptions={footerPageSizeOptions}
                  size="small"
                  total={footerTotal ?? localTotal}
                  showTotal={(total, range) => footerTotal == null
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
                          {range[0]}
                          -
                          {range[1]}
                          <span className="mx-1 text-muted/70">/</span>
                          共
                          {' '}
                          {total}
                          {' '}
                          {footerShowTotalLabel}
                        </>
                      )}
                  onChange={(nextPage, nextPageSize) => {
                    if (footerPagination) {
                      footerPagination.onChange(nextPage, nextPageSize)
                      return
                    }
                    table.setPageIndex(nextPage - 1)
                  }}
                />
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
              {rowSelection?.actions
                ? (
                    <>
                      <Separator />
                      <ActionBar.Content>
                        {rowSelection?.actions(selectedRows)}
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
