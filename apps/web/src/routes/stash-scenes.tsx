import type { StashEntityKind, StashEntitySearchItem, StashSceneCaption, StashSceneFilterType, StashSceneRow } from '@/api'
import { ActionBar } from '@heroui-pro/react/action-bar'
import { Alert, Button, Card, Checkbox, Chip, Disclosure, Drawer, Dropdown, Input, Label, ListBox, ScrollShadow, Select, Separator, Slider, Spinner, Switch, Tabs, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { listScenesStash, readTextFs, searchEntitiesStash } from '@/api'
import { StashSceneCover } from '@/components/stash-scene-cover'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { SubtitleWebModal } from '@/components/subtitle-web-modal'
import { deserializeSubtitleText } from '@/utils/subtitle'

export const Route = createFileRoute('/stash-scenes')({
  component: PageComponent,
})

const STASH_SORT_OPTIONS = [
  { label: '最近更新', value: 'updated_at', defaultDirection: 'DESC' },
  { label: '最后播放时间', value: 'last_played_at', defaultDirection: 'DESC' },
  { label: '创建时间', value: 'created_at', defaultDirection: 'DESC' },
  { label: '场景日期', value: 'date', defaultDirection: 'DESC' },
  { label: '标题', value: 'title', defaultDirection: 'ASC' },
  { label: '文件路径', value: 'path', defaultDirection: 'ASC' },
  { label: '播放次数', value: 'play_count', defaultDirection: 'DESC' },
  { label: '时长', value: 'duration', defaultDirection: 'DESC' },
] as const

const STASH_PAGE_SIZE_OPTIONS = [20, 40, 80, 120] as const
const STASH_SCENES_VIEW_STORAGE_KEY = 'media-admin:stash-scenes:view'

type StashSort = typeof STASH_SORT_OPTIONS[number]['value']
type StashSortDirection = 'ASC' | 'DESC'
type TriState = 'any' | 'yes' | 'no'
type IntModifier = 'EQUALS' | 'GREATER_THAN' | 'LESS_THAN' | 'BETWEEN'

interface RangeFilterValue {
  modifier: IntModifier
  value?: number
  value2?: number
}

interface EntityFilterValue {
  includes: StashEntitySearchItem[]
  excludes: StashEntitySearchItem[]
  none: boolean
}

interface StashSceneFilterValues {
  studios: EntityFilterValue
  performers: EntityFilterValue
  tags: EntityFilterValue
  rating: RangeFilterValue
  durationMinutes: RangeFilterValue
  folderPath: string
  hasMarkers: TriState
  organized: TriState
  duplicatedTitle: boolean
  duplicatedPhash: boolean
  duplicatedOshash: boolean
  performerAge: RangeFilterValue
}

const DEFAULT_RANGE_FILTER: RangeFilterValue = {
  modifier: 'EQUALS',
}

const DEFAULT_ENTITY_FILTER_VALUE: EntityFilterValue = {
  includes: [],
  excludes: [],
  none: false,
}

const DEFAULT_STASH_FILTER_VALUES: StashSceneFilterValues = {
  studios: { ...DEFAULT_ENTITY_FILTER_VALUE },
  performers: { ...DEFAULT_ENTITY_FILTER_VALUE },
  tags: { ...DEFAULT_ENTITY_FILTER_VALUE },
  rating: { ...DEFAULT_RANGE_FILTER },
  durationMinutes: { ...DEFAULT_RANGE_FILTER },
  folderPath: '',
  hasMarkers: 'any',
  organized: 'any',
  duplicatedTitle: false,
  duplicatedPhash: false,
  duplicatedOshash: false,
  performerAge: { ...DEFAULT_RANGE_FILTER },
}

const TRI_STATE_OPTIONS: { label: string, value: Exclude<TriState, 'any'> }[] = [
  { label: '是', value: 'yes' },
  { label: '否', value: 'no' },
]

const DURATION_PRESETS: FilterRangePreset[] = [
  { label: '0 - 5 min', value: [0, 5] },
  { label: '5 - 10 min', value: [5, 10] },
  { label: '10 - 15 min', value: [10, 15] },
  { label: '15 - 20 min', value: [15, 20] },
  { label: '20 - 25 min', value: [20, 25] },
  { label: '25 - 30 min', value: [25, 30] },
  { label: '30+ min', value: [30, 120] },
]

const AGE_PRESETS: FilterRangePreset[] = [
  { label: '18 - 25', value: [18, 25] },
  { label: '25 - 30', value: [25, 30] },
  { label: '30 - 35', value: [30, 35] },
  { label: '35 - 40', value: [35, 40] },
  { label: '40+', value: [40, 80] },
]

interface FilterRangePreset {
  label: string
  value: [number, number]
}

interface StashScenesViewState {
  screenshotShow: boolean
  q: string
  page: number
  sort: StashSort
  direction: StashSortDirection
  pageSize: number
}

const DEFAULT_STASH_SCENES_VIEW_STATE: StashScenesViewState = {
  screenshotShow: false,
  q: '',
  page: 1,
  sort: 'last_played_at',
  direction: 'ASC',
  pageSize: 20,
}

function loadStashScenesViewState(): StashScenesViewState {
  if (typeof window === 'undefined')
    return DEFAULT_STASH_SCENES_VIEW_STATE

  try {
    const raw = window.localStorage.getItem(STASH_SCENES_VIEW_STORAGE_KEY)
    if (!raw)
      return DEFAULT_STASH_SCENES_VIEW_STATE

    const parsed = JSON.parse(raw) as Partial<StashScenesViewState>
    const sort = isStashSort(parsed.sort) ? parsed.sort : DEFAULT_STASH_SCENES_VIEW_STATE.sort
    const direction = parsed.direction === 'ASC' || parsed.direction === 'DESC'
      ? parsed.direction
      : DEFAULT_STASH_SCENES_VIEW_STATE.direction
    const pageSize = typeof parsed.pageSize === 'number' && STASH_PAGE_SIZE_OPTIONS.includes(parsed.pageSize as typeof STASH_PAGE_SIZE_OPTIONS[number])
      ? parsed.pageSize
      : DEFAULT_STASH_SCENES_VIEW_STATE.pageSize
    const page = typeof parsed.page === 'number' && Number.isFinite(parsed.page) && parsed.page > 0
      ? Math.floor(parsed.page)
      : DEFAULT_STASH_SCENES_VIEW_STATE.page

    return {
      screenshotShow: typeof parsed.screenshotShow === 'boolean'
        ? parsed.screenshotShow
        : DEFAULT_STASH_SCENES_VIEW_STATE.screenshotShow,
      q: typeof parsed.q === 'string' ? parsed.q : DEFAULT_STASH_SCENES_VIEW_STATE.q,
      page,
      sort,
      direction,
      pageSize,
    }
  }
  catch {
    return DEFAULT_STASH_SCENES_VIEW_STATE
  }
}

function saveStashScenesViewState(value: StashScenesViewState) {
  try {
    window.localStorage.setItem(STASH_SCENES_VIEW_STORAGE_KEY, JSON.stringify(value))
  }
  catch {
    // 忽略隐私模式或存储配额导致的失败。
  }
}

function isStashSort(value: unknown): value is StashSort {
  return typeof value === 'string' && STASH_SORT_OPTIONS.some(option => option.value === value)
}

function PageComponent() {
  const navigate = useNavigate()
  const [viewState, setViewState] = useState(loadStashScenesViewState)
  const { direction, page, pageSize, q, screenshotShow, sort } = viewState
  const [filterOpen, setFilterOpen] = useState(false)
  const [stashFilterValues, setStashFilterValues] = useState<StashSceneFilterValues>(DEFAULT_STASH_FILTER_VALUES)
  const [subtitleTaskCreateOpen, setSubtitleTaskCreateOpen] = useState(false)
  const [subtitleTaskCreateInitialPath, setSubtitleTaskCreateInitialPath] = useState<string | undefined>()
  const [subtitleTaskBulkRows, setSubtitleTaskBulkRows] = useState<StashSceneRow[] | undefined>()
  const [subtitleDetailRow, setSubtitleDetailRow] = useState<StashSceneRow | undefined>()
  const [selectedSceneKeys, setSelectedSceneKeys] = useState<Set<string>>(() => new Set())

  const sceneFilter = useMemo(() => buildStashSceneFilter(stashFilterValues), [stashFilterValues])
  const activeFilterCount = useMemo(() => countActiveStashFilters(stashFilterValues), [stashFilterValues])

  useEffect(() => {
    saveStashScenesViewState(viewState)
  }, [viewState])

  const scenesQuery = useQuery({
    queryKey: ['stash-scenes', { direction, page, pageSize, q, sceneFilter, sort }],
    queryFn: () => listScenesStash({
      filter: {
        page,
        page_size: pageSize,
        q: q || undefined,
        sort,
        direction,
      },
      scene_filter: sceneFilter,
    }),
  })

  const total = Number(scenesQuery.data?.total ?? 0)
  const scenes = useMemo(() => scenesQuery.data?.data ?? [], [scenesQuery.data?.data])
  const selectedRows = useMemo(
    () => scenes.filter(row => selectedSceneKeys.has(String(row.id))),
    [scenes, selectedSceneKeys],
  )
  const selectedCount = selectedSceneKeys.size
  const currentPageKeys = useMemo(() => scenes.map(row => String(row.id)), [scenes])
  const selectedCurrentPageCount = currentPageKeys.filter(key => selectedSceneKeys.has(key)).length
  const isCurrentPageSelected = currentPageKeys.length > 0 && selectedCurrentPageCount === currentPageKeys.length
  const isCurrentPageIndeterminate = selectedCurrentPageCount > 0 && selectedCurrentPageCount < currentPageKeys.length

  function updateViewState(patch: Partial<StashScenesViewState>) {
    setViewState(prev => ({ ...prev, ...patch }))
  }

  function setSceneSelected(row: StashSceneRow, selected: boolean) {
    const key = String(row.id)
    setSelectedSceneKeys((prev) => {
      const next = new Set(prev)
      if (selected)
        next.add(key)
      else
        next.delete(key)
      return next
    })
  }

  function setCurrentPageSelected(selected: boolean) {
    setSelectedSceneKeys((prev) => {
      const next = new Set(prev)
      for (const key of currentPageKeys) {
        if (selected)
          next.add(key)
        else
          next.delete(key)
      }
      return next
    })
  }

  function clearSelection() {
    setSelectedSceneKeys(new Set())
  }

  return (
    <div className="flex h-full max-h-[calc(100dvh-5rem)] min-h-0 flex-col gap-3">
      <SubtitleTaskCreateDrawerForm
        open={subtitleTaskCreateOpen}
        onOpenChange={(open) => {
          setSubtitleTaskCreateOpen(open)
          if (!open) {
            setSubtitleTaskCreateInitialPath(undefined)
            setSubtitleTaskBulkRows(undefined)
          }
        }}
        initialVideoPath={subtitleTaskCreateInitialPath}
        bulkSourceRows={subtitleTaskBulkRows?.map(stashSceneToBulkSourceRow)}
        onCreated={() => scenesQuery.refetch()}
      />
      <StashFilterDrawer
        open={filterOpen}
        values={stashFilterValues}
        onOpenChange={setFilterOpen}
        onApply={(values) => {
          setStashFilterValues(values)
          updateViewState({ page: 1 })
          clearSelection()
          setFilterOpen(false)
        }}
        onReset={() => {
          setStashFilterValues(DEFAULT_STASH_FILTER_VALUES)
          updateViewState({ page: 1 })
          clearSelection()
          setFilterOpen(false)
        }}
      />
      <StashSubtitleDetailDrawer
        key={subtitleDetailRow?.id ?? 'stash-subtitle-detail'}
        row={subtitleDetailRow}
        open={Boolean(subtitleDetailRow)}
        onOpenChange={(open) => {
          if (!open)
            setSubtitleDetailRow(undefined)
        }}
      />
      <div className="shrink-0 grid gap-3 md:grid-cols-[minmax(220px,1fr)_280px_auto] md:items-end">
        <div className="flex min-w-0 flex-col gap-1">

          <Input
            value={q}
            placeholder="搜索标题或文件名"
            variant="secondary"
            onChange={(event) => {
              updateViewState({ q: event.target.value, page: 1 })
              clearSelection()
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-stretch">
            <Select
              aria-label="排序字段"
              className="min-w-0 flex-1"
              value={sort}
              variant="secondary"
              onChange={(key) => {
                if (typeof key !== 'string')
                  return
                const nextSort = key as StashSort
                updateViewState({
                  sort: nextSort,
                  direction: STASH_SORT_OPTIONS.find(option => option.value === nextSort)?.defaultDirection ?? 'DESC',
                  page: 1,
                })
                clearSelection()
              }}
            >
              <Select.Trigger className="rounded-r-none">
                <Select.Value />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {STASH_SORT_OPTIONS.map(option => (
                    <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                      {option.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Tooltip>
              <Button
                isIconOnly
                aria-label={direction === 'DESC' ? '切换为正序' : '切换为倒序'}
                className="rounded-l-none"
                variant="secondary"
                onPress={() => {
                  updateViewState({
                    direction: direction === 'DESC' ? 'ASC' : 'DESC',
                    page: 1,
                  })
                  clearSelection()
                }}
              >
                <Icon className="size-4" icon={direction === 'DESC' ? 'lucide:arrow-down' : 'lucide:arrow-up'} />
              </Button>
              <Tooltip.Content>{direction === 'DESC' ? '倒序' : '正序'}</Tooltip.Content>
            </Tooltip>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-1 md:justify-self-end">
          <Switch isSelected={screenshotShow} onChange={value => updateViewState({ screenshotShow: value })}>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <Switch.Content>
              <Label className="text-sm">显示封面</Label>
            </Switch.Content>
          </Switch>
          <Button size="sm" variant={activeFilterCount > 0 ? 'secondary' : 'tertiary'} onPress={() => setFilterOpen(true)}>
            <Icon className="size-4" icon="lucide:sliders-horizontal" />
            筛选
            {activeFilterCount > 0
              ? (
                  <Chip className="ml-1 tabular-nums" size="sm" variant="soft">
                    {activeFilterCount}
                  </Chip>
                )
              : null}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <StashSceneCardGrid
          rows={scenes}
          loading={scenesQuery.isFetching}
          screenshotShow={screenshotShow}
          selectedKeys={selectedSceneKeys}
          onSelectedChange={setSceneSelected}
          onPlay={(videoPath) => {
            void navigate({
              to: '/video-play',
              search: { videoPath },
            })
          }}
          onCreateSubtitle={(videoPath) => {
            setSubtitleTaskCreateInitialPath(videoPath)
            setSubtitleTaskCreateOpen(true)
          }}
          onOpenSubtitles={setSubtitleDetailRow}
        />
      </div>
      <div className="shrink-0">
        <StashScenePagination
          current={page}
          pageSize={pageSize}
          pageSizeOptions={STASH_PAGE_SIZE_OPTIONS}
          total={total}
          onChange={(nextPage, nextPageSize) => {
            updateViewState({
              pageSize: nextPageSize,
              page: nextPage,
            })
            clearSelection()
          }}
        />
      </div>

      <ActionBar aria-label="Stash 场景批量操作" isOpen={selectedCount > 0}>
        <ActionBar.Prefix>
          <Checkbox
            aria-label="选择本页场景"
            isIndeterminate={isCurrentPageIndeterminate}
            isSelected={isCurrentPageSelected}
            isDisabled={!currentPageKeys.length || scenesQuery.isFetching}
            variant="secondary"
            onChange={setCurrentPageSelected}
          >
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Checkbox.Content>
              选择本页
            </Checkbox.Content>
          </Checkbox>
          <Chip className="shrink-0 tabular-nums" size="sm">
            已选
            {selectedCount}
          </Chip>
        </ActionBar.Prefix>
        <Separator />
        <ActionBar.Content>
          {selectedCount > 0
            ? (
                <Button
                  isDisabled={!selectedRows.some(row => Boolean(row.files?.[0]?.local_path?.trim()))}
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setSubtitleTaskCreateInitialPath(undefined)
                    setSubtitleTaskBulkRows(selectedRows.filter(row => Boolean(row.files?.[0]?.local_path?.trim())))
                    setSubtitleTaskCreateOpen(true)
                  }}
                >
                  <Icon className="size-4" icon="lucide:captions" />
                  批量生成字幕
                </Button>
              )
            : null}
        </ActionBar.Content>
        {selectedCount > 0
          ? (
              <>
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
              </>
            )
          : null}
      </ActionBar>
    </div>
  )
}

interface StashSceneCardGridProps {
  rows: StashSceneRow[]
  loading?: boolean
  screenshotShow: boolean
  selectedKeys: Set<string>
  onSelectedChange: (row: StashSceneRow, selected: boolean) => void
  onPlay: (videoPath: string) => void
  onCreateSubtitle: (videoPath: string) => void
  onOpenSubtitles: (row: StashSceneRow) => void
}

function StashSceneCardGrid({
  rows,
  loading,
  screenshotShow,
  selectedKeys,
  onSelectedChange,
  onPlay,
  onCreateSubtitle,
  onOpenSubtitles,
}: StashSceneCardGridProps) {
  if (loading && !rows.length) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg bg-surface-secondary py-12 text-sm text-muted">
        <Spinner size="sm" />
        加载中
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-surface-secondary px-4 py-12 text-center">
        <Icon className="size-8 text-muted" icon="lucide:film" />
        <div>
          <div className="text-sm font-medium text-foreground">暂无场景</div>
          <div className="mt-1 text-xs text-muted">调整搜索条件后重新查看。</div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-3">
      {rows.map(row => (
        <StashSceneCard
          key={row.id}
          row={row}
          screenshotShow={screenshotShow}
          selected={selectedKeys.has(String(row.id))}
          onSelectedChange={selected => onSelectedChange(row, selected)}
          onPlay={onPlay}
          onCreateSubtitle={onCreateSubtitle}
          onOpenSubtitles={() => onOpenSubtitles(row)}
        />
      ))}
    </div>
  )
}

interface StashSceneCardProps {
  row: StashSceneRow
  screenshotShow: boolean
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  onPlay: (videoPath: string) => void
  onCreateSubtitle: (videoPath: string) => void
  onOpenSubtitles: () => void
}

function StashSceneCard({
  row,
  screenshotShow,
  selected,
  onSelectedChange,
  onPlay,
  onCreateSubtitle,
  onOpenSubtitles,
}: StashSceneCardProps) {
  const firstFile = row.files?.[0]
  const stashPath = firstFile?.path
  const localPath = firstFile?.local_path?.trim() || undefined
  const videoPath = localPath ?? stashPath
  const displayTitle = row.title?.trim() || firstFile?.basename || row.id
  const fullPath = localPath ?? stashPath ?? displayTitle
  const lastPlayedText = row.last_played_at
    ? dayjs(row.last_played_at).format('MM-DD HH:mm')
    : '未播放'
  const dateText = row.date ? dayjs(row.date).format('MM-DD') : undefined
  const durationText = formatDurationSeconds(firstFile?.duration)
  const subtitles = row.captions ?? []
  const subtitleCount = subtitles.length

  return (
    <Card className={`gap-0 overflow-hidden p-0 [contain-intrinsic-size:220px] [content-visibility:auto] ${selected ? 'ring-2 ring-accent/60' : ''}`}>
      {screenshotShow
        ? (
            <StashSceneCover
              className="h-28 w-full rounded-t-lg rounded-b-none"
              screenshot={row.paths?.screenshot}
              preview={row.paths?.preview}
            />
          )
        : (
            <div
              aria-hidden="true"
              className="flex h-28 w-full items-center justify-center rounded-t-lg rounded-b-none bg-surface-secondary text-muted"
            >
              <Icon className="size-6" icon="lucide:image-off" />
            </div>
          )}
      <Card.Header className="flex-row items-start justify-between gap-2 p-3 pt-2">
        <div className="min-w-0">
          <Card.Title className="truncate text-base" title={fullPath}>
            {displayTitle}
          </Card.Title>
          <Card.Description className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <Chip className="shrink-0" size="sm" variant="soft">
              {localPath ? '已映射' : '未映射'}
            </Chip>
            {localPath
              ? (
                  <Button
                    className="h-6 min-w-0 gap-1 rounded-full px-2 text-xs tabular-nums"
                    size="sm"
                    variant="tertiary"
                    onPress={onOpenSubtitles}
                  >
                    <Icon className="size-3.5" icon="lucide:captions" />
                    字幕
                    {' '}
                    {subtitleCount}
                  </Button>
                )
              : null}
            <span className="tabular-nums">{lastPlayedText}</span>
            {dateText
              ? (
                  <>
                    <span className="text-muted/60">/</span>
                    <span className="tabular-nums">{dateText}</span>
                  </>
                )
              : null}
            {durationText
              ? (
                  <>
                    <span className="text-muted/60">/</span>
                    <span className="tabular-nums">{durationText}</span>
                  </>
                )
              : null}
          </Card.Description>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Checkbox
            aria-label={`选择 ${displayTitle}`}
            isSelected={selected}
            variant="secondary"
            onChange={onSelectedChange}
          >
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox>
          <StashSceneActions
            localPath={localPath}
            videoPath={videoPath}
            onPlay={onPlay}
            onCreateSubtitle={onCreateSubtitle}
          />
        </div>
      </Card.Header>
    </Card>
  )
}

interface StashSubtitleDetailDrawerProps {
  row?: StashSceneRow
  open: boolean
  onOpenChange: (open: boolean) => void
}

function StashSubtitleDetailDrawer({
  row,
  open,
  onOpenChange,
}: StashSubtitleDetailDrawerProps) {
  const captions = useMemo(() => row?.captions ?? [], [row?.captions])
  const captionOptions = useMemo(() => {
    const keyCounts = new Map<string, number>()

    return captions.map((caption, index) => {
      const baseKey = caption.local_path?.trim()
        || caption.path?.trim()
        || `${caption.language_code?.trim() || 'unknown'}-${caption.caption_type?.trim() || 'caption'}`
      const count = keyCounts.get(baseKey) ?? 0
      keyCounts.set(baseKey, count + 1)

      return {
        caption,
        index,
        key: count ? `${baseKey}-${count + 1}` : baseKey,
        label: formatCaptionLabel(caption, index),
        localPath: caption.local_path?.trim() || undefined,
        stashPath: caption.path?.trim() || undefined,
      }
    })
  }, [captions])
  const [selectedCaptionKey, setSelectedCaptionKey] = useState<string>()
  const effectiveSelectedCaptionKey = captionOptions.some(option => option.key === selectedCaptionKey)
    ? selectedCaptionKey
    : captionOptions[0]?.key
  const selectedOption = captionOptions.find(option => option.key === effectiveSelectedCaptionKey)
  const selectedPath = selectedOption?.localPath
  const selectedDisplayPath = selectedOption?.localPath ?? selectedOption?.stashPath
  const title = row?.title?.trim() || row?.files?.[0]?.basename || row?.id || '字幕详情'

  const readSubtitleQuery = useQuery({
    queryKey: ['stash-subtitle-content', selectedPath],
    queryFn: async () => {
      if (!selectedPath)
        return []
      const res = await readTextFs({ path: selectedPath })
      return deserializeSubtitleText(res.content)
    },
    enabled: open && Boolean(selectedPath),
  })

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen)
      setSelectedCaptionKey(undefined)
  }

  return (
    <Drawer.Backdrop
      isOpen={open}
      onOpenChange={handleOpenChange}
    >
      <Drawer.Content placement="right" className="inset-y-0 right-0 left-auto w-[min(720px,calc(100vw-2rem))] sm:max-w-180">
        <Drawer.Dialog className="ml-auto flex h-dvh w-full flex-col">
          <Drawer.CloseTrigger />
          <Drawer.Header className="shrink-0 border-b border-separator pr-12">
            <Drawer.Heading className="truncate text-base" title={title}>
              字幕详情
            </Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body className="min-h-0 flex-1 overflow-hidden p-0">
            {captionOptions.length
              ? (
                  <Tabs
                    className="flex h-full min-h-0 flex-col"
                    selectedKey={effectiveSelectedCaptionKey}
                    onSelectionChange={key => setSelectedCaptionKey(String(key))}
                  >
                    <div className="shrink-0 border-b border-separator px-3 py-1.5">
                      <div className="overflow-x-auto">
                        <Tabs.ListContainer>
                          <Tabs.List
                            aria-label="字幕列表"
                            className="w-max *:h-6 *:w-fit *:px-2 *:text-xs *:font-normal"
                          >
                            {captionOptions.map(option => (
                              <Tabs.Tab
                                key={option.key}
                                id={option.key}
                                className={option.localPath ? undefined : 'text-muted'}
                              >
                                {option.index > 0 ? <Tabs.Separator /> : null}
                                {option.label}
                                <Tabs.Indicator />
                              </Tabs.Tab>
                            ))}
                          </Tabs.List>
                        </Tabs.ListContainer>
                      </div>
                      <div
                        className="mt-1 truncate font-mono text-[11px] text-muted"
                        title={selectedDisplayPath}
                      >
                        {selectedDisplayPath ?? '未映射字幕路径'}
                      </div>
                    </div>
                    {captionOptions.map(option => (
                      <Tabs.Panel
                        key={option.key}
                        id={option.key}
                        className="min-h-0 flex-1 overflow-hidden"
                      >
                        {selectedOption?.key === option.key
                          ? (
                              <ScrollShadow className="h-full px-3 py-2" hideScrollBar>
                                <StashSubtitleContent
                                  isPending={readSubtitleQuery.isFetching}
                                  error={readSubtitleQuery.error}
                                  items={readSubtitleQuery.data}
                                  selectedPath={selectedPath}
                                />
                              </ScrollShadow>
                            )
                          : null}
                      </Tabs.Panel>
                    ))}
                  </Tabs>
                )
              : <div className="px-3 py-4 text-sm text-muted">暂无字幕</div>}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}

function StashSubtitleContent({
  isPending,
  error,
  items,
  selectedPath,
}: {
  isPending: boolean
  error: Error | null
  items?: ReturnType<typeof deserializeSubtitleText>
  selectedPath?: string
}) {
  if (!selectedPath) {
    return (
      <div className="py-8 text-center text-sm text-muted">
        选择已映射字幕查看内容
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted">
        <Spinner size="sm" />
        加载中
      </div>
    )
  }

  if (error) {
    return (
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>读取字幕失败</Alert.Title>
          <Alert.Description>{error.message}</Alert.Description>
        </Alert.Content>
      </Alert>
    )
  }

  if (!items?.length) {
    return <div className="py-8 text-center text-sm text-muted">暂无内容</div>
  }

  return (
    <div className="flex flex-col text-xs">
      {items.map(item => (
        <div key={`${item.startTime}-${item.endTime}`} className="grid grid-cols-[12.5rem_minmax(0,1fr)] gap-2 rounded px-1.5 py-1 hover:bg-surface-secondary max-sm:grid-cols-1 max-sm:gap-0.5">
          <div className="whitespace-nowrap font-mono text-[10px] leading-5 tabular-nums text-muted">
            {item.startTime}
            <span className="mx-1">~</span>
            {item.endTime}
          </div>
          <div className="min-w-0 whitespace-pre-wrap leading-5">
            {item.text}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatCaptionLabel(caption: StashSceneCaption, index: number): string {
  const lang = caption.language_code?.trim() || `字幕 ${index + 1}`
  const type = caption.caption_type?.trim()
  return type ? `${lang}.${type}` : lang
}

interface StashFilterDrawerProps {
  open: boolean
  values: StashSceneFilterValues
  onOpenChange: (open: boolean) => void
  onApply: (values: StashSceneFilterValues) => void
  onReset: () => void
}

function StashFilterDrawer({
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
      <Drawer.Content placement="right" className="sm:max-w-[440px]">
        <Drawer.Dialog className="flex h-dvh w-full flex-col bg-background">
          <Drawer.CloseTrigger />
          <Drawer.Header className="shrink-0 border-b border-separator">
            <Drawer.Heading>过滤器</Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body className="min-h-0 flex-1 overflow-y-auto bg-background px-0 py-0">
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
                <RangeSliderFilter
                  ariaLabel="评分范围"
                  displayValue={value => `${value}`}
                  value={draft.rating}
                  minValue={0}
                  maxValue={100}
                  presets={[
                    { label: '0 - 20', value: [0, 20] },
                    { label: '20 - 40', value: [20, 40] },
                    { label: '40 - 60', value: [40, 60] },
                    { label: '60 - 80', value: [60, 80] },
                    { label: '80 - 100', value: [80, 100] },
                  ]}
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
          {children}
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

function isEntityFilterEmpty(value: EntityFilterValue): boolean {
  return !value.none && value.includes.length === 0 && value.excludes.length === 0
}

function formatMinutesPresetLabel(value: number): string {
  return value >= 120 ? '2+ hrs' : `${value}m`
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value))
}

function formatDurationSeconds(seconds?: number | null): string | undefined {
  if (!Number.isFinite(seconds) || seconds == null || seconds <= 0)
    return undefined

  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  if (h > 0) {
    return [
      String(h),
      m.toString().padStart(2, '0'),
      s.toString().padStart(2, '0'),
    ].join(':')
  }

  return `${m}:${s.toString().padStart(2, '0')}`
}

interface StashSceneActionsProps {
  localPath?: string
  videoPath?: string
  onPlay: (videoPath: string) => void
  onCreateSubtitle: (videoPath: string) => void
}

function StashSceneActions({
  localPath,
  videoPath,
  onPlay,
  onCreateSubtitle,
}: StashSceneActionsProps) {
  const [subtitleWebOpen, setSubtitleWebOpen] = useState(false)
  const disabledActionKeys = [
    ...(!localPath ? ['play', 'create-subtitle'] : []),
    ...(!videoPath ? ['search-subtitle'] : []),
  ]

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger>
          <Button isIconOnly aria-label="场景操作" size="sm" variant="ghost">
            <Icon className="size-4" icon="lucide:ellipsis" />
          </Button>
        </Dropdown.Trigger>
        <Dropdown.Popover>
          <Dropdown.Menu
            disabledKeys={disabledActionKeys}
            onAction={(key) => {
              if (key === 'play' && localPath)
                onPlay(localPath)
              if (key === 'search-subtitle' && videoPath)
                setSubtitleWebOpen(true)
              if (key === 'create-subtitle' && localPath)
                onCreateSubtitle(localPath)
            }}
          >
            <Dropdown.Item id="play" textValue="播放">
              <Icon className="size-4 shrink-0 text-muted" icon="lucide:play" />
              播放
            </Dropdown.Item>
            <Dropdown.Item id="search-subtitle" textValue="查询字幕">
              <Icon className="size-4 shrink-0 text-muted" icon="lucide:search" />
              查询字幕
            </Dropdown.Item>
            <Dropdown.Item id="create-subtitle" textValue="生成字幕">
              <Icon className="size-4 shrink-0 text-muted" icon="lucide:captions" />
              生成字幕
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      {videoPath
        ? (
            <SubtitleWebModal
              open={subtitleWebOpen}
              videoPath={videoPath}
              onOpenChange={setSubtitleWebOpen}
            />
          )
        : null}
    </>
  )
}

interface StashScenePaginationProps {
  current: number
  pageSize: number
  pageSizeOptions: readonly number[]
  total: number
  onChange: (page: number, pageSize: number) => void
}

function StashScenePagination({
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

function stashSceneToBulkSourceRow(row: StashSceneRow) {
  const file = row.files?.[0]
  return {
    video_path: file?.local_path?.trim() ?? '',
    subtitle_names: [],
  }
}

function buildStashSceneFilter(values: StashSceneFilterValues): StashSceneFilterType | undefined {
  const filter: StashSceneFilterType = {}
  const rating = buildIntCriterion(values.rating)
  const duration = buildIntCriterion({
    ...values.durationMinutes,
    value: minutesToSeconds(values.durationMinutes.value),
    value2: minutesToSeconds(values.durationMinutes.value2),
  })
  const performerAge = buildIntCriterion(values.performerAge)
  const duplicated = buildDuplicationCriterion(values)
  const folderPath = values.folderPath.trim()

  if (!isEntityFilterEmpty(values.studios)) {
    filter.studios = {
      value: values.studios.includes.length ? values.studios.includes.map(item => item.id) : null,
      excludes: values.studios.excludes.length ? values.studios.excludes.map(item => item.id) : null,
      depth: null,
      modifier: values.studios.none ? 'IS_NULL' : 'INCLUDES',
    }
  }
  if (!isEntityFilterEmpty(values.performers)) {
    filter.performers = {
      value: values.performers.includes.length ? values.performers.includes.map(item => item.id) : null,
      excludes: values.performers.excludes.length ? values.performers.excludes.map(item => item.id) : null,
      modifier: values.performers.none ? 'IS_NULL' : 'INCLUDES',
    }
  }
  if (!isEntityFilterEmpty(values.tags)) {
    filter.tags = {
      value: values.tags.includes.length ? values.tags.includes.map(item => item.id) : null,
      excludes: values.tags.excludes.length ? values.tags.excludes.map(item => item.id) : null,
      depth: null,
      modifier: values.tags.none ? 'IS_NULL' : 'INCLUDES',
    }
  }
  if (rating)
    filter.rating100 = rating
  if (duration)
    filter.duration = duration
  if (folderPath) {
    filter.path = {
      value: folderPath,
      modifier: 'INCLUDES',
    }
  }
  if (values.hasMarkers !== 'any')
    filter.has_markers = values.hasMarkers === 'yes' ? 'true' : 'false'
  if (values.organized !== 'any')
    filter.organized = values.organized === 'yes'
  if (duplicated)
    filter.duplicated = duplicated
  if (performerAge)
    filter.performer_age = performerAge

  return Object.keys(filter).length ? filter : undefined
}

function countActiveStashFilters(values: StashSceneFilterValues): number {
  return [
    !isEntityFilterEmpty(values.studios),
    !isEntityFilterEmpty(values.performers),
    !isEntityFilterEmpty(values.tags),
    Boolean(buildIntCriterion(values.rating)),
    Boolean(buildIntCriterion(values.durationMinutes)),
    Boolean(values.folderPath.trim()),
    values.hasMarkers !== 'any',
    values.organized !== 'any',
    values.duplicatedTitle || values.duplicatedPhash || values.duplicatedOshash,
    Boolean(buildIntCriterion(values.performerAge)),
  ].filter(Boolean).length
}

function buildIntCriterion(value: RangeFilterValue): NonNullable<StashSceneFilterType['duration']> | undefined {
  if (typeof value.value !== 'number' || !Number.isFinite(value.value))
    return undefined

  if (value.modifier === 'BETWEEN') {
    if (typeof value.value2 !== 'number' || !Number.isFinite(value.value2))
      return undefined
    return {
      value: Math.floor(value.value),
      value2: Math.floor(value.value2),
      modifier: value.modifier,
    }
  }

  return {
    value: Math.floor(value.value),
    value2: null,
    modifier: value.modifier,
  }
}

function buildDuplicationCriterion(values: StashSceneFilterValues): StashSceneFilterType['duplicated'] | undefined {
  if (!values.duplicatedTitle && !values.duplicatedPhash && !values.duplicatedOshash)
    return undefined

  return {
    distance: null,
    title: values.duplicatedTitle || null,
    phash: values.duplicatedPhash || null,
    url: null,
    stash_id: values.duplicatedOshash || null,
  }
}

function minutesToSeconds(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value * 60
    : undefined
}
