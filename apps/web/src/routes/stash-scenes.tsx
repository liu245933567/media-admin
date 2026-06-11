import type { StashSceneRow } from '@/api'
import type { StashScenesViewState, StashSort } from '@/features/stash-scenes/stash-scenes-state'
import { ActionBar } from '@heroui-pro/react/action-bar'
import { Button, Checkbox, Chip, Input, Label, ListBox, Select, Separator, Switch, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAppConfigSettings, getGetAppConfigSettingsQueryKey, listScenesStash } from '@/api'
import { BasePagination } from '@/components/base-pagination'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { StashFilterDrawer } from '@/features/stash-scenes/stash-filter-drawer'
import { StashSceneCardGrid } from '@/features/stash-scenes/stash-scene-card-grid'
import { buildStashSceneFilter, countActiveStashFilters, DEFAULT_STASH_FILTER_VALUES, isMappedStashSceneWithoutSubtitles, loadStashScenesFilterValues, loadStashScenesViewState, saveStashScenesFilterValues, saveStashScenesViewState, STASH_PAGE_SIZE_OPTIONS, STASH_SORT_OPTIONS, stashSceneToBulkSourceRow } from '@/features/stash-scenes/stash-scenes-state'
import { StashSubtitleDetailDrawer } from '@/features/stash-scenes/stash-subtitle-detail-drawer'

export const Route = createFileRoute('/stash-scenes')({
  component: PageComponent,
})

function PageComponent() {
  const navigate = useNavigate()
  const [viewState, setViewState] = useState(loadStashScenesViewState)
  const { direction, page, pageSize, q, screenshotShow, sort } = viewState
  const [filterOpen, setFilterOpen] = useState(false)
  const [stashFilterValues, setStashFilterValues] = useState(loadStashScenesFilterValues)
  const [subtitleTaskCreateOpen, setSubtitleTaskCreateOpen] = useState(false)
  const [subtitleTaskCreateInitialPath, setSubtitleTaskCreateInitialPath] = useState<string | undefined>()
  const [subtitleTaskBulkRows, setSubtitleTaskBulkRows] = useState<StashSceneRow[] | undefined>()
  const [subtitleDetailRow, setSubtitleDetailRow] = useState<StashSceneRow | undefined>()
  const [selectedSceneKeys, setSelectedSceneKeys] = useState<Set<string>>(() => new Set())

  const sceneFilter = useMemo(() => buildStashSceneFilter(stashFilterValues), [stashFilterValues])
  const activeFilterCount = useMemo(() => countActiveStashFilters(stashFilterValues), [stashFilterValues])
  const appConfigQuery = useQuery({
    queryKey: getGetAppConfigSettingsQueryKey(),
    queryFn: getAppConfigSettings,
  })

  useEffect(() => {
    saveStashScenesViewState(viewState)
  }, [viewState])

  useEffect(() => {
    saveStashScenesFilterValues(stashFilterValues)
  }, [stashFilterValues])

  const scenesQuery = useQuery({
    queryKey: ['stash-scenes', { direction, page, pageSize, q, sceneFilter, sort }],
    placeholderData: keepPreviousData,
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
  const stashBaseUrl = appConfigQuery.data?.stash_config?.base_url
  const selectedRows = useMemo(
    () => scenes.filter(row => selectedSceneKeys.has(String(row.id))),
    [scenes, selectedSceneKeys],
  )
  const selectedMappedRows = useMemo(
    () => selectedRows.filter(row => Boolean(row.files?.[0]?.local_path?.trim())),
    [selectedRows],
  )
  const mappedRowsWithoutSubtitles = useMemo(
    () => scenes.filter(isMappedStashSceneWithoutSubtitles),
    [scenes],
  )
  const selectedCount = selectedSceneKeys.size
  const currentPageKeys = useMemo(() => scenes.map(row => String(row.id)), [scenes])
  const selectedCurrentPageCount = currentPageKeys.filter(key => selectedSceneKeys.has(key)).length
  const isCurrentPageSelected = currentPageKeys.length > 0 && selectedCurrentPageCount === currentPageKeys.length
  const isCurrentPageIndeterminate = selectedCurrentPageCount > 0 && selectedCurrentPageCount < currentPageKeys.length

  const updateViewState = useCallback((patch: Partial<StashScenesViewState>) => {
    setViewState(prev => ({ ...prev, ...patch }))
  }, [])

  const setSceneSelected = useCallback((row: StashSceneRow, selected: boolean) => {
    const key = String(row.id)
    setSelectedSceneKeys((prev) => {
      const next = new Set(prev)
      if (selected)
        next.add(key)
      else
        next.delete(key)
      return next
    })
  }, [])

  const setCurrentPageSelected = useCallback((selected: boolean) => {
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
  }, [currentPageKeys])

  const selectMappedRowsWithoutSubtitles = useCallback(() => {
    setSelectedSceneKeys(new Set(mappedRowsWithoutSubtitles.map(row => String(row.id))))
  }, [mappedRowsWithoutSubtitles])

  const clearSelection = useCallback(() => {
    setSelectedSceneKeys(new Set())
  }, [])

  const handlePlay = useCallback((videoPath: string) => {
    void navigate({
      to: '/video-play',
      search: { videoPath },
    })
  }, [navigate])

  const handleCreateSubtitle = useCallback((videoPath: string) => {
    setSubtitleTaskCreateInitialPath(videoPath)
    setSubtitleTaskCreateOpen(true)
  }, [])

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
          stashBaseUrl={stashBaseUrl}
          viewState={viewState}
          onSelectedChange={setSceneSelected}
          onPlay={handlePlay}
          onCreateSubtitle={handleCreateSubtitle}
          onOpenSubtitles={setSubtitleDetailRow}
        />
      </div>
      <div className="shrink-0">
        <BasePagination
          showSizeChanger
          showQuickJumper
          className="rounded-lg bg-surface-secondary px-3 py-2 text-sm text-muted"
          current={page}
          pageSize={pageSize}
          pageSizeOptions={STASH_PAGE_SIZE_OPTIONS}
          total={total}
          showTotal={(total, range) => (
            <>
              第
              {' '}
              {page}
              {' '}
              页
              <span className="mx-2 text-muted/70">/</span>
              {range[0]}
              -
              {range[1]}
              <span className="mx-1 text-muted/70">/</span>
              共
              {' '}
              {total}
              {' '}
              个场景
            </>
          )}
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
          <Button
            isDisabled={!mappedRowsWithoutSubtitles.length || scenesQuery.isFetching}
            size="sm"
            variant="tertiary"
            onPress={selectMappedRowsWithoutSubtitles}
          >
            <Icon className="size-4" icon="lucide:badge-alert" />
            选中无字幕影片
            {mappedRowsWithoutSubtitles.length
              ? (
                  <Chip className="ml-1 tabular-nums" size="sm" variant="soft">
                    {mappedRowsWithoutSubtitles.length}
                  </Chip>
                )
              : null}
          </Button>
          {selectedCount > 0
            ? (
                <Button
                  isDisabled={!selectedMappedRows.length}
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setSubtitleTaskCreateInitialPath(undefined)
                    setSubtitleTaskBulkRows(selectedMappedRows)
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
