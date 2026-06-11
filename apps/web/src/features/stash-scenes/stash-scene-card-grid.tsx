import type { StashScenesViewState } from './stash-scenes-state'
import type { StashSceneRow } from '@/api'
import { Button, Card, Checkbox, Chip, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import dayjs from 'dayjs'
import { memo, useCallback, useMemo } from 'react'
import { StashSceneCover } from '@/components/stash-scene-cover'
import { StashSceneActions } from './stash-scene-actions'
import { buildStashSceneQueueSearch, buildStashSceneUrl, formatDurationSeconds } from './stash-scenes-state'

interface StashSceneCardGridProps {
  rows: StashSceneRow[]
  loading?: boolean
  screenshotShow: boolean
  selectedKeys: Set<string>
  stashBaseUrl?: string
  viewState: StashScenesViewState
  onSelectedChange: (row: StashSceneRow, selected: boolean) => void
  onPlay: (videoPath: string) => void
  onCreateSubtitle: (videoPath: string) => void
  onOpenSubtitles: (row: StashSceneRow) => void
}

interface StashSceneCardProps {
  row: StashSceneRow
  sceneQueueSearch: string
  screenshotShow: boolean
  selected: boolean
  stashBaseUrl?: string
  onSelectedChange: (row: StashSceneRow, selected: boolean) => void
  onPlay: (videoPath: string) => void
  onCreateSubtitle: (videoPath: string) => void
  onOpenSubtitles: (row: StashSceneRow) => void
}

function StashSceneCardItemComponent({
  row,
  onSelectedChange,
  onOpenSubtitles,
  ...props
}: StashSceneCardProps) {
  const handleSelectedChange = useCallback(
    (selected: boolean) => onSelectedChange(row, selected),
    [onSelectedChange, row],
  )
  const handleOpenSubtitles = useCallback(() => onOpenSubtitles(row), [onOpenSubtitles, row])

  return (
    <StashSceneCard
      {...props}
      row={row}
      onSelectedChange={handleSelectedChange}
      onOpenSubtitles={handleOpenSubtitles}
    />
  )
}

const StashSceneCardItem = memo(StashSceneCardItemComponent)

interface StashSceneCardViewProps {
  row: StashSceneRow
  sceneQueueSearch: string
  screenshotShow: boolean
  selected: boolean
  stashBaseUrl?: string
  onSelectedChange: (selected: boolean) => void
  onPlay: (videoPath: string) => void
  onCreateSubtitle: (videoPath: string) => void
  onOpenSubtitles: () => void
}

function StashSceneCard({
  row,
  sceneQueueSearch,
  screenshotShow,
  selected,
  stashBaseUrl,
  onSelectedChange,
  onPlay,
  onCreateSubtitle,
  onOpenSubtitles,
}: StashSceneCardViewProps) {
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
  const stashSceneUrl = buildStashSceneUrl(stashBaseUrl, row, sceneQueueSearch)

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
          {stashSceneUrl
            ? (
                <Card.Title
                  className="truncate text-base"
                  title={fullPath}
                >
                  <a
                    className="truncate text-accent hover:underline"
                    href={stashSceneUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {displayTitle}
                  </a>
                </Card.Title>
              )
            : (
                <Card.Title className="truncate text-base" title={fullPath}>
                  {displayTitle}
                </Card.Title>
              )}
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

export function StashSceneCardGrid({
  rows,
  loading,
  screenshotShow,
  selectedKeys,
  stashBaseUrl,
  viewState,
  onSelectedChange,
  onPlay,
  onCreateSubtitle,
  onOpenSubtitles,
}: StashSceneCardGridProps) {
  const sceneQueueSearch = useMemo(() => buildStashSceneQueueSearch(rows, viewState), [rows, viewState])

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
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
      {rows.map(row => (
        <StashSceneCardItem
          key={row.id}
          row={row}
          sceneQueueSearch={sceneQueueSearch}
          screenshotShow={screenshotShow}
          selected={selectedKeys.has(String(row.id))}
          stashBaseUrl={stashBaseUrl}
          onSelectedChange={onSelectedChange}
          onPlay={onPlay}
          onCreateSubtitle={onCreateSubtitle}
          onOpenSubtitles={onOpenSubtitles}
        />
      ))}
    </div>
  )
}
