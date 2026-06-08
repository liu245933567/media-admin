import type { TaskmillSubtitlePreview } from '@/api'
import type { PipelineView, TaskLogGroup } from '@/components/taskmill-exec-log-shared'
import { Stepper } from '@heroui-pro/react/stepper'
import { Chip, Drawer, Spinner, Tabs } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useEffect, useRef } from 'react'
import {
  formatTaskmillTime,
  pipelineTitle,
  stageName,
  StatusChip,
  statusIcon,
  TaskDurationMeta,
  TaskMetaItem,
  TaskProgressBar,
  taskStatusColor,
} from '@/components/taskmill-exec-log-shared'

function formatSubtitleTime(cs: number): string {
  const safe = Math.max(0, Math.floor(cs))
  const totalSeconds = Math.floor(safe / 100)
  const centiseconds = safe % 100
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':').concat('.', String(centiseconds).padStart(2, '0'))
}

function formatSubtitleUpdatedAt(value: string | undefined): string {
  return value ? formatTaskmillTime(value) : '-'
}

function activeStepIndex(jobs: TaskLogGroup[], selectedJob: TaskLogGroup | undefined): number {
  if (jobs.length === 0) {
    return 0
  }
  const selectedIndex = selectedJob ? jobs.findIndex(job => job.taskId === selectedJob.taskId) : -1
  if (selectedIndex >= 0) {
    return selectedIndex
  }
  const runningIndex = jobs.findIndex(job => ['running', 'waiting', 'pending', 'paused', 'blocked'].includes(job.status))
  if (runningIndex >= 0) {
    return runningIndex
  }
  return Math.max(0, jobs.length - 1)
}

function StepIndicator({ task }: { task: TaskLogGroup }) {
  const tone = taskStatusColor(task.status)

  return (
    <Stepper.Indicator
      className={[
        tone === 'success' ? 'text-success' : '',
        tone === 'danger' ? 'text-danger' : '',
        tone === 'warning' ? 'text-warning' : '',
      ].filter(Boolean).join(' ')}
    >
      <Stepper.Icon>
        <Icon className={task.status === 'running' ? 'size-3.5 animate-spin' : 'size-3.5'} icon={statusIcon(task.status)} />
      </Stepper.Icon>
    </Stepper.Indicator>
  )
}

function PipelineStepTitle({ task }: { task: TaskLogGroup }) {
  const { status } = Stepper.useStep()

  return (
    <Stepper.Title className={status === 'active' ? 'text-foreground' : undefined}>
      <span className="block max-w-36 truncate" title={stageName(task)}>
        {stageName(task)}
      </span>
    </Stepper.Title>
  )
}

function PipelineDetailStepper({
  jobs,
  selectedJobId,
  onSelect,
}: {
  jobs: TaskLogGroup[]
  selectedJobId: number | null
  onSelect: (id: number) => void
}) {
  if (jobs.length === 0) {
    return <span className="px-3 py-2 text-sm text-muted">暂无子任务</span>
  }

  const selectedJob = jobs.find(job => job.taskId === selectedJobId)
  const currentStep = activeStepIndex(jobs, selectedJob)

  return (
    <div className="overflow-x-auto px-3 py-3">
      <Stepper
        className="min-w-max"
        currentStep={currentStep}
        size="sm"
        onStepChange={(step) => {
          const next = jobs[step]
          if (next) {
            onSelect(next.taskId)
          }
        }}
      >
        {jobs.map(job => (
          <Stepper.Step key={job.taskId}>
            <StepIndicator task={job} />
            <Stepper.Content>
              <PipelineStepTitle task={job} />
              <Stepper.Description>
                <span className="font-mono tabular-nums">
                  #
                  {job.taskId}
                </span>
              </Stepper.Description>
            </Stepper.Content>
            <Stepper.Separator />
          </Stepper.Step>
        ))}
      </Stepper>
    </div>
  )
}

function SubtitlePreviewView({
  preview,
  loading,
  autoScroll,
}: {
  preview: TaskmillSubtitlePreview | undefined
  loading: boolean
  autoScroll: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const items = preview?.items ?? []
  const lastItem = items.at(-1)

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) {
      return
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [autoScroll, items.length])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-surface">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-divider px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
          <Chip color={items.length > 0 ? 'accent' : 'default'} size="sm" variant="soft">
            <Icon className="size-3.5" icon="lucide:captions" />
            <span className="tabular-nums">
              {items.length}
              {' '}
              条
            </span>
          </Chip>
          {lastItem && (
            <span className="font-mono tabular-nums">
              {formatSubtitleTime(lastItem.start_cs)}
              {' '}
              -
              {' '}
              {formatSubtitleTime(lastItem.end_cs)}
            </span>
          )}
          <span className="tabular-nums">
            更新
            {' '}
            {formatSubtitleUpdatedAt(preview?.updated_at)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Spinner size="sm" />
              更新中
            </span>
          )}
          {preview?.completed && <Chip color="success" size="sm" variant="soft">已完成</Chip>}
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-surface-secondary px-3 py-3">
        {items.length === 0
          ? (
              <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-center text-sm text-muted">
                <Icon className="size-8 text-muted/70" icon="lucide:captions" />
                <span>正在等待字幕内容</span>
              </div>
            )
          : (
              <div className="flex flex-col gap-1">
                {items.map((item, index) => (
                  <div
                    key={`${item.start_cs}-${item.end_cs}-${item.text}`}
                    className="rounded-md bg-surface px-2.5 py-1.5 text-sm leading-5"
                  >
                    <span className="mr-2 align-baseline font-mono text-xs tabular-nums text-muted">
                      #
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="mr-2 align-baseline font-mono text-xs tabular-nums text-muted">
                      {formatSubtitleTime(item.start_cs)}
                      {' '}
                      -
                      {' '}
                      {formatSubtitleTime(item.end_cs)}
                    </span>
                    <span className="whitespace-pre-wrap wrap-break-word align-baseline">
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
      </div>
    </div>
  )
}

function JobLogView({
  job,
  autoScroll,
}: {
  job: TaskLogGroup | undefined
  autoScroll: boolean
}) {
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!autoScroll || !logRef.current) {
      return
    }
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.lines, autoScroll])

  if (!job) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center px-4 py-8 text-center text-sm text-muted">
        选择一个 job 后显示日志
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-[#1f1f27]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs text-neutral-300">
        <div className="flex min-w-0 items-center gap-2">
          <StatusChip task={job} />
          <span className="truncate">{stageName(job)}</span>
        </div>
        <span className="font-mono tabular-nums">
          #
          {job.taskId}
        </span>
      </div>
      <div
        ref={logRef}
        className="min-h-0 flex-1 overflow-auto px-3 py-2.5 font-mono text-[13px] leading-6 text-neutral-100"
      >
        {job.lines.length === 0
          ? <div className="text-neutral-400">暂无日志事件</div>
          : job.lines.map(line => (
              <div key={line.key} className="grid gap-2 border-b border-white/5 py-1.5 md:grid-cols-[9.5rem_4.5rem_minmax(0,1fr)]">
                <span className="text-neutral-500">{formatTaskmillTime(line.receivedAt)}</span>
                <span
                  className={[
                    line.tone === 'success' ? 'text-success' : '',
                    line.tone === 'danger' ? 'text-danger' : '',
                    line.tone === 'warning' ? 'text-warning' : '',
                    line.tone === 'accent' ? 'text-accent' : 'text-neutral-400',
                  ].filter(Boolean).join(' ')}
                >
                  {line.type}
                </span>
                <span className="min-w-0 whitespace-pre-wrap wrap-break-word">{line.summary}</span>
              </div>
            ))}
      </div>
    </div>
  )
}

export interface TaskmillPipelineDetailDrawerProps {
  pipeline: PipelineView | undefined
  stages: TaskLogGroup[]
  selectedJob: TaskLogGroup | undefined
  selectedJobId: number | null
  selectedJobSupportsSubtitlePreview: boolean
  subtitlePreview: TaskmillSubtitlePreview | undefined
  subtitlePreviewLoading: boolean
  autoScroll: boolean
  onSelectedJobIdChange: (id: number) => void
  onClose: () => void
}

export function TaskmillPipelineDetailDrawer({
  pipeline,
  stages,
  selectedJob,
  selectedJobId,
  selectedJobSupportsSubtitlePreview,
  subtitlePreview,
  subtitlePreviewLoading,
  autoScroll,
  onSelectedJobIdChange,
  onClose,
}: TaskmillPipelineDetailDrawerProps) {
  return (
    <Drawer.Backdrop
      isOpen={Boolean(pipeline)}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <Drawer.Content placement="right">
        <Drawer.Dialog className="flex h-dvh w-full flex-col sm:max-w-4xl">
          <Drawer.CloseTrigger />
          <Drawer.Header className="shrink-0 pr-12">
            {pipeline
              ? (
                  <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-start">
                    <div className="min-w-0">
                      <div className="mb-2 flex min-w-0 items-center gap-2">
                        <StatusChip task={{ ...pipeline.root, status: pipeline.status, percent: pipeline.percent }} />
                        <Drawer.Heading className="min-w-0 text-base">
                          <span className="block truncate" title={pipelineTitle(pipeline)}>
                            {pipelineTitle(pipeline)}
                          </span>
                        </Drawer.Heading>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        <span className="font-mono tabular-nums">
                          Pipeline #
                          {pipeline.root.taskId}
                        </span>
                        <TaskMetaItem icon="lucide:workflow">
                          {pipeline.jobs.length}
                          {' '}
                          jobs
                        </TaskMetaItem>
                        <TaskDurationMeta task={pipeline.root} />
                        <TaskMetaItem icon="lucide:clock">
                          {formatTaskmillTime(pipeline.latestAt)}
                        </TaskMetaItem>
                      </div>
                    </div>
                    <TaskProgressBar className="lg:pt-1" percent={pipeline.percent} />
                  </div>
                )
              : (
                  <Drawer.Heading className="text-base">Pipeline</Drawer.Heading>
                )}
          </Drawer.Header>
          <Drawer.Body className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
            {pipeline && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface-secondary">
                <PipelineDetailStepper
                  jobs={stages}
                  selectedJobId={selectedJobId}
                  onSelect={onSelectedJobIdChange}
                />
                {selectedJob && (
                  <div className="mx-3 mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface px-3 py-2 text-xs text-muted">
                    <StatusChip task={selectedJob} />
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{stageName(selectedJob)}</span>
                    <span className="font-mono tabular-nums">
                      #
                      {selectedJob.taskId}
                    </span>
                    <TaskDurationMeta task={selectedJob} />
                    <TaskProgressBar className="min-w-40 flex-1" percent={selectedJob.percent} />
                  </div>
                )}
                <Tabs className="flex min-h-0 flex-1 flex-col px-3 pb-3" variant="secondary">
                  <Tabs.ListContainer className="shrink-0">
                    <Tabs.List aria-label="任务详情视图" className="w-fit">
                      <Tabs.Tab id="log">
                        日志
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab id="subtitle" isDisabled={!selectedJobSupportsSubtitlePreview}>
                        字幕
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                  <Tabs.Panel className="min-h-0 flex-1 overflow-hidden pt-2" id="log">
                    <JobLogView job={selectedJob} autoScroll={autoScroll} />
                  </Tabs.Panel>
                  <Tabs.Panel className="min-h-0 flex-1 overflow-hidden pt-2" id="subtitle">
                    <SubtitlePreviewView
                      autoScroll={autoScroll}
                      loading={subtitlePreviewLoading}
                      preview={subtitlePreview}
                    />
                  </Tabs.Panel>
                </Tabs>
              </div>
            )}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}
