import type { StashEntitySearchItem, StashSceneFilterType, StashSceneRow } from '@/api'

export const STASH_SORT_OPTIONS = [
  { label: '最近更新', value: 'updated_at', defaultDirection: 'DESC' },
  { label: '最后播放时间', value: 'last_played_at', defaultDirection: 'DESC' },
  { label: '创建时间', value: 'created_at', defaultDirection: 'DESC' },
  { label: '场景日期', value: 'date', defaultDirection: 'DESC' },
  { label: '标题', value: 'title', defaultDirection: 'ASC' },
  { label: '文件路径', value: 'path', defaultDirection: 'ASC' },
  { label: '播放次数', value: 'play_count', defaultDirection: 'DESC' },
  { label: '时长', value: 'duration', defaultDirection: 'DESC' },
] as const

export const STASH_PAGE_SIZE_OPTIONS = [40, 80, 160, 320] as const
const STASH_SCENES_VIEW_STORAGE_KEY = 'media-admin:stash-scenes:view'
const STASH_SCENES_FILTER_STORAGE_KEY = 'media-admin:stash-scenes:filter'

export type StashSort = typeof STASH_SORT_OPTIONS[number]['value']
export type StashSortDirection = 'ASC' | 'DESC'
export type TriState = 'any' | 'yes' | 'no'
type IntModifier = 'EQUALS' | 'GREATER_THAN' | 'LESS_THAN' | 'BETWEEN' | 'IS_NULL'

export interface RangeFilterValue {
  modifier: IntModifier
  value?: number
  value2?: number
}

export interface EntityFilterValue {
  includes: StashEntitySearchItem[]
  excludes: StashEntitySearchItem[]
  none: boolean
}

export interface StashSceneFilterValues {
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

export const DEFAULT_RANGE_FILTER: RangeFilterValue = {
  modifier: 'EQUALS',
}

export const DEFAULT_ENTITY_FILTER_VALUE: EntityFilterValue = {
  includes: [],
  excludes: [],
  none: false,
}

export const DEFAULT_STASH_FILTER_VALUES: StashSceneFilterValues = {
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

export const TRI_STATE_OPTIONS: { label: string, value: Exclude<TriState, 'any'> }[] = [
  { label: '是', value: 'yes' },
  { label: '否', value: 'no' },
]

export const DURATION_PRESETS: FilterRangePreset[] = [
  { label: '0 - 5 min', value: [0, 5] },
  { label: '5 - 10 min', value: [5, 10] },
  { label: '10 - 15 min', value: [10, 15] },
  { label: '15 - 20 min', value: [15, 20] },
  { label: '20 - 25 min', value: [20, 25] },
  { label: '25 - 30 min', value: [25, 30] },
  { label: '30+ min', value: [30, 120] },
]

export const AGE_PRESETS: FilterRangePreset[] = [
  { label: '18 - 25', value: [18, 25] },
  { label: '25 - 30', value: [25, 30] },
  { label: '30 - 35', value: [30, 35] },
  { label: '35 - 40', value: [35, 40] },
  { label: '40+', value: [40, 80] },
]

export interface FilterRangePreset {
  label: string
  value: [number, number]
}

export interface StashScenesViewState {
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
  pageSize: 40,
}

export function loadStashScenesViewState(): StashScenesViewState {
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

export function loadStashScenesFilterValues(): StashSceneFilterValues {
  if (typeof window === 'undefined')
    return DEFAULT_STASH_FILTER_VALUES

  try {
    const raw = window.localStorage.getItem(STASH_SCENES_FILTER_STORAGE_KEY)
    if (!raw)
      return DEFAULT_STASH_FILTER_VALUES

    return normalizeStashFilterValues(JSON.parse(raw))
  }
  catch {
    return DEFAULT_STASH_FILTER_VALUES
  }
}

export function saveStashScenesViewState(value: StashScenesViewState) {
  try {
    window.localStorage.setItem(STASH_SCENES_VIEW_STORAGE_KEY, JSON.stringify(value))
  }
  catch {
    // 忽略隐私模式或存储配额导致的失败。
  }
}

export function saveStashScenesFilterValues(value: StashSceneFilterValues) {
  try {
    window.localStorage.setItem(STASH_SCENES_FILTER_STORAGE_KEY, JSON.stringify(value))
  }
  catch {
    // 忽略隐私模式或存储配额导致的失败。
  }
}

function normalizeStashFilterValues(value: unknown): StashSceneFilterValues {
  if (!isPlainRecord(value))
    return DEFAULT_STASH_FILTER_VALUES

  return {
    studios: normalizeEntityFilterValue(value.studios),
    performers: normalizeEntityFilterValue(value.performers),
    tags: normalizeEntityFilterValue(value.tags),
    rating: normalizeRangeFilterValue(value.rating),
    durationMinutes: normalizeRangeFilterValue(value.durationMinutes),
    folderPath: typeof value.folderPath === 'string' ? value.folderPath : DEFAULT_STASH_FILTER_VALUES.folderPath,
    hasMarkers: normalizeTriState(value.hasMarkers),
    organized: normalizeTriState(value.organized),
    duplicatedTitle: typeof value.duplicatedTitle === 'boolean' ? value.duplicatedTitle : DEFAULT_STASH_FILTER_VALUES.duplicatedTitle,
    duplicatedPhash: typeof value.duplicatedPhash === 'boolean' ? value.duplicatedPhash : DEFAULT_STASH_FILTER_VALUES.duplicatedPhash,
    duplicatedOshash: typeof value.duplicatedOshash === 'boolean' ? value.duplicatedOshash : DEFAULT_STASH_FILTER_VALUES.duplicatedOshash,
    performerAge: normalizeRangeFilterValue(value.performerAge),
  }
}

function normalizeEntityFilterValue(value: unknown): EntityFilterValue {
  if (!isPlainRecord(value))
    return { ...DEFAULT_ENTITY_FILTER_VALUE }

  return {
    includes: normalizeEntitySearchItems(value.includes),
    excludes: normalizeEntitySearchItems(value.excludes),
    none: typeof value.none === 'boolean' ? value.none : DEFAULT_ENTITY_FILTER_VALUE.none,
  }
}

function normalizeEntitySearchItems(value: unknown): StashEntitySearchItem[] {
  if (!Array.isArray(value))
    return []

  return value.flatMap((item) => {
    if (!isPlainRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string')
      return []

    return [{
      id: item.id,
      name: item.name,
      disambiguation: typeof item.disambiguation === 'string' ? item.disambiguation : null,
    }]
  })
}

function normalizeRangeFilterValue(value: unknown): RangeFilterValue {
  if (!isPlainRecord(value))
    return { ...DEFAULT_RANGE_FILTER }

  const modifier = isIntModifier(value.modifier) ? value.modifier : DEFAULT_RANGE_FILTER.modifier
  const normalized: RangeFilterValue = { modifier }
  if (typeof value.value === 'number' && Number.isFinite(value.value))
    normalized.value = value.value
  if (typeof value.value2 === 'number' && Number.isFinite(value.value2))
    normalized.value2 = value.value2
  return normalized
}

function normalizeTriState(value: unknown): TriState {
  return value === 'yes' || value === 'no' || value === 'any' ? value : 'any'
}

function isIntModifier(value: unknown): value is IntModifier {
  return value === 'EQUALS' || value === 'GREATER_THAN' || value === 'LESS_THAN' || value === 'BETWEEN' || value === 'IS_NULL'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStashSort(value: unknown): value is StashSort {
  return typeof value === 'string' && STASH_SORT_OPTIONS.some(option => option.value === value)
}

export function buildStashSceneUrl(
  baseUrl: string | undefined,
  row: StashSceneRow,
  sceneQueueSearch: string,
): string | undefined {
  const base = baseUrl?.trim().replace(/\/+$/, '')
  if (!base)
    return undefined

  return `${base}/scenes/${encodeURIComponent(String(row.id))}${sceneQueueSearch}`
}

export function buildStashSceneQueueSearch(
  rows: StashSceneRow[],
  viewState: StashScenesViewState,
): string {
  const params = new URLSearchParams()
  for (const item of rows) {
    params.append('qs', String(item.id))
  }
  params.set('qsort', viewState.sort)
  params.set('qsortd', viewState.direction)
  params.set('qfp', String(viewState.page))
  if (viewState.q.trim()) {
    params.set('qfq', viewState.q.trim())
  }

  const query = params.toString()
  return query ? `?${query}` : ''
}

export function stashSceneToBulkSourceRow(row: StashSceneRow) {
  const file = row.files?.[0]
  return {
    video_path: file?.local_path?.trim() ?? '',
    subtitle_names: [],
  }
}

export function isMappedStashSceneWithoutSubtitles(row: StashSceneRow): boolean {
  return Boolean(row.files?.[0]?.local_path?.trim()) && (row.captions?.length ?? 0) === 0
}

export function isEntityFilterEmpty(value: EntityFilterValue): boolean {
  return !value.none && value.includes.length === 0 && value.excludes.length === 0
}

export function formatMinutesPresetLabel(value: number): string {
  return value >= 120 ? '2+ hrs' : `${value}m`
}

export function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value))
}

export function buildStashSceneFilter(values: StashSceneFilterValues): StashSceneFilterType | undefined {
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

export function countActiveStashFilters(values: StashSceneFilterValues): number {
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
  if (value.modifier === 'IS_NULL') {
    return {
      value: 0,
      value2: null,
      modifier: value.modifier,
    }
  }

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

export function formatDurationSeconds(seconds?: number | null): string | undefined {
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

function minutesToSeconds(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value * 60
    : undefined
}
