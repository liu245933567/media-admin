import type { EntityFilterValue, FilterRangePreset, RangeFilterValue, StashSceneFilterValues, TriState } from './stash-scenes-state'
import type { StashEntityKind, StashEntitySearchItem } from '@/api'
import { Button, Disclosure, Drawer, Input, ScrollShadow, Slider, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { searchEntitiesStash } from '@/api'
import { AGE_PRESETS, clampNumber, DEFAULT_ENTITY_FILTER_VALUE, DEFAULT_RANGE_FILTER, DURATION_PRESETS, formatMinutesPresetLabel, isEntityFilterEmpty, TRI_STATE_OPTIONS } from './stash-scenes-state'

interface StashFilterDrawerProps {
  open: boolean
  values: StashSceneFilterValues
  onOpenChange: (open: boolean) => void
  onApply: (values: StashSceneFilterValues) => void
  onReset: () => void
}

export function StashFilterDrawer({
  open,
  values,
  onOpenChange,
  onApply,
  onReset,
}: StashFilterDrawerProps) {
  const [draft, setDraft] = useState<StashSceneFilterValues>(values)

  function updateDraft<TKey extends keyof StashSceneFilterValues>(
    key: TKey,
    value: StashSceneFilterValues[TKey],
  ) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  return (
    <Drawer.Backdrop
      isOpen={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen)
          setDraft(values)
        onOpenChange(nextOpen)
      }}
    >
      <Drawer.Content placement="right" className="inset-y-0 right-0 left-auto w-[min(440px,calc(100vw-2rem))] sm:max-w-110">
        <Drawer.Dialog className="ml-auto flex h-dvh w-full flex-col bg-background">
          <Drawer.CloseTrigger />
          <Drawer.Header className="shrink-0 border-b border-separator">
            <Drawer.Heading>过滤器</Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body className="min-h-0 flex-1 overflow-y-auto bg-background px-0 py-0">
            {open
              ? (
                  <div className="flex flex-col">
                    <FilterDisclosure title="保存过滤器" defaultExpanded={false}>
                      <FilterSearchInput
                        ariaLabel="保存过滤器搜索"
                        placeholder="查找过滤器..."
                      />
                      <FilterMutedRow>当前仅支持临时筛选</FilterMutedRow>
                    </FilterDisclosure>

                    <FilterDisclosure title="工作室">
                      <EntityIncludeExcludeList
                        kind="studio"
                        placeholder="搜索工作室"
                        value={draft.studios}
                        onChange={value => updateDraft('studios', value)}
                      />
                    </FilterDisclosure>

                    <FilterDisclosure title="演员">
                      <EntityIncludeExcludeList
                        kind="performer"
                        placeholder="搜索演员"
                        value={draft.performers}
                        onChange={value => updateDraft('performers', value)}
                      />
                    </FilterDisclosure>

                    <FilterDisclosure title="标签">
                      <EntityIncludeExcludeList
                        kind="tag"
                        placeholder="搜索标签"
                        value={draft.tags}
                        onChange={value => updateDraft('tags', value)}
                      />
                    </FilterDisclosure>

                    <FilterDisclosure title="评分">
                      <RatingFilter
                        value={draft.rating}
                        onChange={value => updateDraft('rating', value)}
                      />
                    </FilterDisclosure>

                    <FilterDisclosure title="时长">
                      <RangeSliderFilter
                        ariaLabel="时长范围"
                        displayValue={formatMinutesPresetLabel}
                        value={draft.durationMinutes}
                        minValue={0}
                        maxValue={120}
                        presets={DURATION_PRESETS}
                        onChange={value => updateDraft('durationMinutes', value)}
                      />
                    </FilterDisclosure>

                    <FilterDisclosure title="文件夹">
                      <FilterSearchInput
                        ariaLabel="文件夹路径"
                        placeholder="搜索文件夹路径..."
                        value={draft.folderPath}
                        onChange={value => updateDraft('folderPath', value)}
                      />
                      {draft.folderPath.trim()
                        ? (
                            <FilterOptionRow
                              label={draft.folderPath.trim()}
                              prefixIcon="lucide:folder"
                              onInclude={() => updateDraft('folderPath', '')}
                            />
                          )
                        : <FilterMutedRow>输入路径片段后过滤文件夹</FilterMutedRow>}
                    </FilterDisclosure>

                    <FilterDisclosure title="章节标记">
                      <TriStateList
                        value={draft.hasMarkers}
                        onChange={value => updateDraft('hasMarkers', value)}
                      />
                    </FilterDisclosure>

                    <FilterDisclosure title="是否已经整理">
                      <TriStateList
                        value={draft.organized}
                        onChange={value => updateDraft('organized', value)}
                      />
                    </FilterDisclosure>

                    <FilterDisclosure title="重复">
                      <FilterToggleRow
                        label="感知码 PHash"
                        selected={draft.duplicatedPhash}
                        onChange={value => updateDraft('duplicatedPhash', value)}
                      />
                      <FilterToggleRow
                        label="Stash ID"
                        selected={draft.duplicatedOshash}
                        onChange={value => updateDraft('duplicatedOshash', value)}
                      />
                      <FilterToggleRow
                        label="标题"
                        selected={draft.duplicatedTitle}
                        onChange={value => updateDraft('duplicatedTitle', value)}
                      />
                      <FilterMutedRow>链接需要 Stash URL 重复字段，暂未接入</FilterMutedRow>
                    </FilterDisclosure>

                    <FilterDisclosure title="演员年龄">
                      <RangeSliderFilter
                        ariaLabel="演员年龄范围"
                        displayValue={value => `${value}`}
                        value={draft.performerAge}
                        minValue={18}
                        maxValue={80}
                        presets={AGE_PRESETS}
                        onChange={value => updateDraft('performerAge', value)}
                      />
                    </FilterDisclosure>
                  </div>
                )
              : null}
          </Drawer.Body>
          <Drawer.Footer className="shrink-0 border-t border-separator">
            <Button variant="tertiary" onPress={onReset}>
              重置
            </Button>
            <Button variant="secondary" onPress={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onPress={() => onApply(draft)}>
              应用筛选
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}

function FilterDisclosure({
  title,
  defaultExpanded = false,
  children,
}: {
  title: string
  defaultExpanded?: boolean
  children: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <Disclosure
      className="border-b border-separator"
      isExpanded={expanded}
      onExpandedChange={setExpanded}
    >
      <Disclosure.Heading>
        <Button className="h-10 w-full justify-start rounded-none px-4 text-sm font-medium" slot="trigger" variant="ghost">
          <Disclosure.Indicator className="text-muted" />
          <span>{title}</span>
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="px-4 pb-3">
          {expanded ? children : null}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}

function EntityIncludeExcludeList({
  kind,
  placeholder,
  value,
  onChange,
}: {
  kind: StashEntityKind
  placeholder: string
  value: EntityFilterValue
  onChange: (value: EntityFilterValue) => void
}) {
  const [q, setQ] = useState('')
  const query = useQuery({
    queryKey: ['stash-entities', kind, q],
    queryFn: () => searchEntitiesStash({ kind, q: q || undefined, page_size: 20 }),
    enabled: q.trim().length > 0 || !isEntityFilterEmpty(value),
  })
  const options = query.data?.items ?? []

  function toggleNone() {
    onChange({
      includes: [],
      excludes: [],
      none: !value.none,
    })
  }

  function setMode(item: StashEntitySearchItem, mode: 'include' | 'exclude') {
    const target = mode === 'include' ? value.includes : value.excludes
    const exists = target.some(selected => selected.id === item.id)
    onChange({
      none: false,
      includes: mode === 'include'
        ? exists ? value.includes.filter(selected => selected.id !== item.id) : [...value.includes, item]
        : value.includes.filter(selected => selected.id !== item.id),
      excludes: mode === 'exclude'
        ? exists ? value.excludes.filter(selected => selected.id !== item.id) : [...value.excludes, item]
        : value.excludes.filter(selected => selected.id !== item.id),
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <FilterSearchInput ariaLabel={placeholder} placeholder={placeholder} value={q} onChange={setQ} />
      <div className="overflow-hidden rounded-lg bg-surface-secondary">
        <FilterOptionRow
          label="(任意)"
          selected={isEntityFilterEmpty(value)}
          onInclude={() => onChange({ ...DEFAULT_ENTITY_FILTER_VALUE })}
        />
        <FilterOptionRow
          label="(无)"
          includeActive={value.none}
          onInclude={toggleNone}
        />
        <ScrollShadow className="max-h-56" hideScrollBar>
          {query.isFetching
            ? (
                <div className="flex items-center justify-center gap-2 px-3 py-4 text-sm text-muted">
                  <Spinner size="sm" />
                  搜索中
                </div>
              )
            : options.length
              ? options.map(item => (
                  <FilterOptionRow
                    key={item.id}
                    label={item.name}
                    description={item.disambiguation ?? undefined}
                    includeActive={value.includes.some(selected => selected.id === item.id)}
                    excludeActive={value.excludes.some(selected => selected.id === item.id)}
                    onInclude={() => setMode(item, 'include')}
                    onExclude={() => setMode(item, 'exclude')}
                  />
                ))
              : <FilterMutedRow>暂无结果</FilterMutedRow>}
        </ScrollShadow>
      </div>
    </div>
  )
}

function FilterSearchInput({
  ariaLabel,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string
  placeholder: string
  value?: string
  onChange?: (value: string) => void
}) {
  return (
    <Input
      aria-label={ariaLabel}
      className="h-9"
      placeholder={placeholder}
      value={value}
      variant="secondary"
      onChange={event => onChange?.(event.target.value)}
    />
  )
}

function FilterOptionRow({
  label,
  description,
  selected,
  includeActive,
  excludeActive,
  prefixIcon,
  onInclude,
  onExclude,
}: {
  label: string
  description?: string
  selected?: boolean
  includeActive?: boolean
  excludeActive?: boolean
  prefixIcon?: string
  onInclude?: () => void
  onExclude?: () => void
}) {
  return (
    <div className={`flex min-h-9 items-center gap-2 border-b border-separator/70 px-2 py-1.5 text-sm last:border-b-0 ${selected ? 'bg-accent/10 text-accent' : ''}`}>
      {prefixIcon ? <Icon className="size-4 shrink-0 text-muted" icon={prefixIcon} /> : null}
      <FilterSignButton
        ariaLabel={`包含 ${label}`}
        active={includeActive || selected}
        tone="include"
        onPress={onInclude}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate">{label}</div>
        {description ? <div className="truncate text-xs text-muted">{description}</div> : null}
      </div>
      {onExclude
        ? (
            <FilterSignButton
              ariaLabel={`排除 ${label}`}
              active={excludeActive}
              tone="exclude"
              onPress={onExclude}
            />
          )
        : null}
    </div>
  )
}

function FilterSignButton({
  ariaLabel,
  active,
  tone,
  onPress,
}: {
  ariaLabel: string
  active?: boolean
  tone: 'include' | 'exclude'
  onPress?: () => void
}) {
  const className = tone === 'include'
    ? active ? 'text-success bg-success/15' : 'text-success hover:bg-success/10'
    : active ? 'text-danger bg-danger/15' : 'text-danger hover:bg-danger/10'

  return (
    <Button
      isIconOnly
      aria-label={ariaLabel}
      className={`size-7 min-w-7 rounded-md ${className}`}
      size="sm"
      variant="ghost"
      onPress={onPress}
    >
      <Icon className="size-4" icon={tone === 'include' ? 'lucide:plus' : 'lucide:minus'} />
    </Button>
  )
}

function FilterMutedRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-2 text-sm text-muted">
      {children}
    </div>
  )
}

function FilterToggleRow({
  label,
  selected,
  onChange,
}: {
  label: string
  selected: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      className={`flex min-h-9 w-full items-center justify-between border-b border-separator/70 px-2 py-1.5 text-left text-sm last:border-b-0 hover:bg-surface-secondary ${selected ? 'text-accent' : 'text-foreground'}`}
      type="button"
      onClick={() => onChange(!selected)}
    >
      <span>{label}</span>
      {selected ? <Icon className="size-4" icon="lucide:check" /> : null}
    </button>
  )
}

function TriStateList({
  value,
  onChange,
}: {
  value: TriState
  onChange: (value: TriState) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg bg-surface-secondary">
      <FilterOptionRow
        label="(任意)"
        selected={value === 'any'}
        onInclude={() => onChange('any')}
      />
      {TRI_STATE_OPTIONS.map(option => (
        <FilterOptionRow
          key={option.value}
          label={option.label}
          selected={value === option.value}
          onInclude={() => onChange(option.value)}
        />
      ))}
    </div>
  )
}

function RatingFilter({
  value,
  onChange,
}: {
  value: RangeFilterValue
  onChange: (value: RangeFilterValue) => void
}) {
  const activeStars = value.modifier === 'GREATER_THAN' && typeof value.value === 'number'
    ? Math.max(1, Math.min(5, Math.floor(value.value / 20) + 1))
    : undefined

  return (
    <div className="overflow-hidden rounded-lg bg-surface-secondary">
      {[5, 4, 3, 2, 1].map(stars => (
        <RatingOptionRow
          key={stars}
          stars={stars}
          selected={activeStars === stars}
          onPress={() => onChange({
            modifier: 'GREATER_THAN',
            value: stars * 20 - 1,
          })}
        />
      ))}
      <FilterOptionRow
        label="(任意)"
        selected={value.modifier !== 'IS_NULL' && activeStars == null}
        onInclude={() => onChange({ ...DEFAULT_RANGE_FILTER })}
      />
      <FilterOptionRow
        label="(无)"
        selected={value.modifier === 'IS_NULL'}
        onInclude={() => onChange({ modifier: 'IS_NULL' })}
      />
    </div>
  )
}

function RatingOptionRow({
  stars,
  selected,
  onPress,
}: {
  stars: number
  selected?: boolean
  onPress: () => void
}) {
  return (
    <button
      className={`flex min-h-9 w-full items-center gap-2 border-b border-separator/70 px-2 py-1.5 text-left text-sm last:border-b-0 hover:bg-surface-secondary ${selected ? 'bg-accent/10 text-accent' : 'text-foreground'}`}
      type="button"
      onClick={onPress}
    >
      <span className="flex items-center">
        {Array.from({ length: 5 }, (_, index) => (
          <Icon
            key={index}
            className={`size-4 ${index < stars ? 'text-warning' : 'text-muted'}`}
            icon={index < stars ? 'lucide:star' : 'lucide:star'}
          />
        ))}
      </span>
      <span className="tabular-nums">
        {stars}
        +
      </span>
    </button>
  )
}

function RangeSliderFilter({
  ariaLabel,
  value,
  minValue,
  maxValue,
  presets,
  displayValue,
  onChange,
}: {
  ariaLabel: string
  value: RangeFilterValue
  minValue: number
  maxValue: number
  presets: FilterRangePreset[]
  displayValue: (value: number) => string
  onChange: (value: RangeFilterValue) => void
}) {
  const sliderValue: [number, number] = [
    clampNumber(value.value ?? minValue, minValue, maxValue),
    clampNumber(value.value2 ?? maxValue, minValue, maxValue),
  ]
  const active = value.modifier === 'BETWEEN' && typeof value.value === 'number' && typeof value.value2 === 'number'

  function setRange(nextValue: number | number[]) {
    if (!Array.isArray(nextValue))
      return
    const [from = minValue, to = maxValue] = nextValue
    onChange({
      modifier: 'BETWEEN',
      value: Math.min(from, to),
      value2: Math.max(from, to),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Slider
        aria-label={ariaLabel}
        maxValue={maxValue}
        minValue={minValue}
        step={1}
        value={sliderValue}
        onChange={setRange}
      >
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{displayValue(sliderValue[0])}</span>
          <Slider.Output className="text-xs text-foreground">
            {({ state }) => `${displayValue(state.values[0])} - ${displayValue(state.values[1])}`}
          </Slider.Output>
          <span>{displayValue(maxValue)}</span>
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb index={0} />
          <Slider.Thumb index={1} />
        </Slider.Track>
      </Slider>
      <div className="overflow-hidden rounded-lg bg-surface-secondary">
        <FilterOptionRow
          label="(任意)"
          selected={!active}
          onInclude={() => onChange({ ...DEFAULT_RANGE_FILTER })}
        />
        {presets.map(preset => (
          <FilterOptionRow
            key={preset.label}
            label={preset.label}
            selected={active && value.value === preset.value[0] && value.value2 === preset.value[1]}
            onInclude={() => onChange({
              modifier: 'BETWEEN',
              value: preset.value[0],
              value2: preset.value[1],
            })}
          />
        ))}
      </div>
    </div>
  )
}
