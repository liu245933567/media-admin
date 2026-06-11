import { Button, ListBox, Select } from '@heroui/react'

interface StashScenePaginationProps {
  current: number
  pageSize: number
  pageSizeOptions: readonly number[]
  total: number
  onChange: (page: number, pageSize: number) => void
}

export function StashScenePagination({
  current,
  pageSize,
  pageSizeOptions,
  total,
  onChange,
}: StashScenePaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-secondary px-3 py-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2 tabular-nums">
        <span>
          第
          {' '}
          {current}
          {' '}
          /
          {' '}
          {pageCount}
          {' '}
          页
        </span>
        <span className="text-muted/70">/</span>
        <span>
          共
          {' '}
          {total}
          {' '}
          个场景
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={current <= 1}
          onPress={() => onChange(Math.max(1, current - 1), pageSize)}
        >
          上一页
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={current >= pageCount}
          onPress={() => onChange(Math.min(pageCount, current + 1), pageSize)}
        >
          下一页
        </Button>
        <Select
          aria-label="每页数量"
          className="w-28"
          value={String(pageSize)}
          variant="secondary"
          onChange={(key) => {
            const next = Number(key)
            if (Number.isFinite(next))
              onChange(1, next)
          }}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {pageSizeOptions.map(size => (
                <ListBox.Item key={size} id={String(size)} textValue={`${size} 个场景`}>
                  {size}
                  {' '}
                  个场景
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
    </div>
  )
}
