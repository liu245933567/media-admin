import { Button, Input, ListBox, Pagination, Select } from '@heroui/react'
import { useMemo, useState } from 'react'

type PaginationSize = 'default' | 'small'
type HeroPaginationSize = 'sm' | 'md' | 'lg'
type PaginationAlign = 'start' | 'center' | 'end'
type PaginationPosition = 'top' | 'bottom' | 'both'
type PaginationItem = number | 'prev-ellipsis' | 'next-ellipsis'

export interface BasePaginationProps {
  current?: number
  defaultCurrent?: number
  defaultPageSize?: number
  disabled?: boolean
  hideOnSinglePage?: boolean
  pageSize?: number
  pageSizeOptions?: readonly (number | string)[]
  position?: PaginationPosition
  showLessItems?: boolean
  showQuickJumper?: boolean | { goButton?: React.ReactNode }
  showSizeChanger?: boolean
  showTitle?: boolean
  showTotal?: (total: number, range: [number, number]) => React.ReactNode
  simple?: boolean
  size?: PaginationSize
  total?: number
  align?: PaginationAlign
  className?: string
  itemRender?: (
    page: number,
    type: 'page' | 'prev' | 'next' | 'jump-prev' | 'jump-next',
    originalElement: React.ReactNode,
  ) => React.ReactNode
  onChange?: (page: number, pageSize: number) => void
  onShowSizeChange?: (current: number, size: number) => void
}

const DEFAULT_CURRENT = 1
const DEFAULT_PAGE_SIZE = 10
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

export function BasePagination({
  current,
  defaultCurrent = DEFAULT_CURRENT,
  defaultPageSize = DEFAULT_PAGE_SIZE,
  disabled = false,
  hideOnSinglePage = false,
  pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  position,
  showLessItems = false,
  showQuickJumper = false,
  showSizeChanger = false,
  showTitle = false,
  showTotal,
  simple = false,
  size = 'default',
  total = 0,
  align = 'end',
  className,
  itemRender,
  onChange,
  onShowSizeChange,
}: BasePaginationProps) {
  const [innerCurrent, setInnerCurrent] = useState(defaultCurrent)
  const [innerPageSize, setInnerPageSize] = useState(defaultPageSize)
  const [quickPage, setQuickPage] = useState('')
  const mergedPageSize = normalizePositiveInt(pageSize ?? innerPageSize, DEFAULT_PAGE_SIZE)
  const pageCount = Math.max(1, Math.ceil(total / mergedPageSize))
  const mergedCurrent = clampPage(current ?? innerCurrent, pageCount)
  const range = getItemRange(mergedCurrent, mergedPageSize, total)
  void position
  const items = useMemo(
    () => getPaginationItems(mergedCurrent, pageCount, showLessItems),
    [mergedCurrent, pageCount, showLessItems],
  )

  if (hideOnSinglePage && pageCount <= 1)
    return null

  function setPage(nextPage: number, nextPageSize = mergedPageSize) {
    const safePage = clampPage(nextPage, Math.max(1, Math.ceil(total / nextPageSize)))
    if (current == null)
      setInnerCurrent(safePage)
    if (pageSize == null)
      setInnerPageSize(nextPageSize)
    onChange?.(safePage, nextPageSize)
  }

  function setPageSize(nextPageSize: number) {
    const safePageSize = normalizePositiveInt(nextPageSize, mergedPageSize)
    const safePage = clampPage(1, Math.max(1, Math.ceil(total / safePageSize)))
    if (pageSize == null)
      setInnerPageSize(safePageSize)
    if (current == null)
      setInnerCurrent(safePage)
    onShowSizeChange?.(safePage, safePageSize)
    onChange?.(safePage, safePageSize)
  }

  function jumpToQuickPage() {
    const next = Number(quickPage)
    if (!Number.isFinite(next))
      return
    setPage(next)
    setQuickPage('')
  }

  const heroSize = toHeroPaginationSize(size)
  const alignClass = align === 'start' ? 'justify-start' : align === 'center' ? 'justify-center' : 'justify-end'
  const renderedSummary = showTotal?.(total, range)

  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${className ?? ''}`}>
      {renderedSummary != null
        ? (
            <div className="text-sm text-muted tabular-nums">
              {renderedSummary}
            </div>
          )
        : null}
      <div className={`flex flex-wrap items-center gap-2 ${alignClass}`}>
        {showSizeChanger
          ? (
              <Select
                aria-label="每页数量"
                className="w-28"
                isDisabled={disabled}
                value={String(mergedPageSize)}
                variant="secondary"
                onChange={(key) => {
                  const next = Number(key)
                  if (Number.isFinite(next))
                    setPageSize(next)
                }}
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {pageSizeOptions.map(option => (
                      <ListBox.Item key={String(option)} id={String(option)} textValue={`${option} / 页`}>
                        {option}
                        {' '}
                        / 页
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )
          : null}
        <Pagination className="w-auto" size={heroSize}>
          <Pagination.Content>
            <Pagination.Item>
              <Pagination.Previous
                isDisabled={disabled || mergedCurrent <= 1}
                onPress={() => setPage(mergedCurrent - 1)}
              >
                <Pagination.PreviousIcon />
                {/* <span title={showTitle ? '上一页' : undefined}>{renderItem(mergedCurrent - 1, 'prev', '上一页', itemRender)}</span> */}
              </Pagination.Previous>
            </Pagination.Item>
            {simple
              ? (
                  <Pagination.Item>
                    <span className="px-2 text-sm text-muted tabular-nums">
                      {mergedCurrent}
                      {' '}
                      /
                      {' '}
                      {pageCount}
                    </span>
                  </Pagination.Item>
                )
              : items.map(item => item === 'prev-ellipsis' || item === 'next-ellipsis'
                  ? (
                      <Pagination.Item key={item}>
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    )
                  : (
                      <Pagination.Item key={item}>
                        <Pagination.Link
                          isActive={item === mergedCurrent}
                          isDisabled={disabled}
                          onPress={() => setPage(item)}
                        >
                          <span title={showTitle ? String(item) : undefined}>
                            {renderItem(item, 'page', item, itemRender)}
                          </span>
                        </Pagination.Link>
                      </Pagination.Item>
                    ))}
            <Pagination.Item>
              <Pagination.Next
                isDisabled={disabled || mergedCurrent >= pageCount}
                onPress={() => setPage(mergedCurrent + 1)}
              >
                {/* <span title={showTitle ? '下一页' : undefined}>{renderItem(mergedCurrent + 1, 'next', '下一页', itemRender)}</span> */}
                <Pagination.NextIcon />
              </Pagination.Next>
            </Pagination.Item>
          </Pagination.Content>
        </Pagination>
        {showQuickJumper
          ? (
              <div className="flex items-center gap-1 text-sm text-muted">
                <span>跳至</span>
                <Input
                  aria-label="跳转页码"
                  className="w-12 mx-1"
                  disabled={disabled}
                  value={quickPage}
                  variant="secondary"
                  onChange={event => setQuickPage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter')
                      jumpToQuickPage()
                  }}
                />
                <span>页</span>
                {typeof showQuickJumper === 'object' && showQuickJumper.goButton
                  ? (
                      <Button isDisabled={disabled} size="sm" variant="tertiary" onPress={jumpToQuickPage}>
                        {showQuickJumper.goButton}
                      </Button>
                    )
                  : null}
              </div>
            )
          : null}
      </div>
    </div>
  )
}

function getPaginationItems(current: number, pageCount: number, showLessItems: boolean): PaginationItem[] {
  if (pageCount <= 7)
    return Array.from({ length: pageCount }, (_, index) => index + 1)

  const siblingCount = showLessItems ? 0 : 1
  const items: PaginationItem[] = [1]
  const left = Math.max(2, current - siblingCount)
  const right = Math.min(pageCount - 1, current + siblingCount)

  if (left > 2)
    items.push('prev-ellipsis')

  for (let page = left; page <= right; page += 1)
    items.push(page)

  if (right < pageCount - 1)
    items.push('next-ellipsis')

  items.push(pageCount)
  return items
}

function getItemRange(current: number, pageSize: number, total: number): [number, number] {
  if (total <= 0)
    return [0, 0]
  const start = (current - 1) * pageSize + 1
  return [start, Math.min(current * pageSize, total)]
}

function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, Math.floor(page)), pageCount)
}

function normalizePositiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function toHeroPaginationSize(size: PaginationSize): HeroPaginationSize {
  return size === 'small' ? 'sm' : 'md'
}

function renderItem(
  page: number,
  type: 'page' | 'prev' | 'next',
  originalElement: React.ReactNode,
  itemRender?: BasePaginationProps['itemRender'],
): React.ReactNode {
  return itemRender?.(page, type, originalElement) ?? originalElement
}
