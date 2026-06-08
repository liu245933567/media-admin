import type { PipelineView, TaskLogGroup } from '@/components/taskmill-exec-log-shared'
import { Stepper } from '@heroui-pro/react/stepper'
import { Drawer } from '@heroui/react'
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
  TaskProgressCircle,
  taskStatusColor,
} from '@/components/taskmill-exec-log-shared'

function activeStepIndex(jobs: TaskLogGroup[], selectedJob: TaskLogGroup | undefined): number {
  if (jobs.length === 0) {
    return 0
  }
  const selectedIndex = selectedJob ? jobs.findIndex(job => job.identityKey === selectedJob.identityKey) : -1
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
  selectedJobKey,
  onSelect,
}: {
  jobs: TaskLogGroup[]
  selectedJobKey: string | null
  onSelect: (key: string) => void
}) {
  if (jobs.length === 0) {
    return <span className="px-3 py-2 text-sm text-muted">暂无子任务</span>
  }

  const selectedJob = jobs.find(job => job.identityKey === selectedJobKey)
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
            onSelect(next.identityKey)
          }
        }}
      >
        {jobs.map(job => (
          <Stepper.Step key={job.identityKey}>
            <StepIndicator task={job} />
            <Stepper.Content>
              <PipelineStepTitle task={job} />
              {/* <Stepper.Description>
                <span className="font-mono tabular-nums">
                  #
                  {job.taskId}
                </span>
              </Stepper.Description> */}
            </Stepper.Content>
            <Stepper.Separator />
          </Stepper.Step>
        ))}
      </Stepper>
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-[#1f1f27]">
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
  selectedJobKey: string | null
  autoScroll: boolean
  onSelectedJobKeyChange: (key: string) => void
  onClose: () => void
}

export function TaskmillPipelineDetailDrawer({
  pipeline,
  stages,
  selectedJob,
  selectedJobKey,
  autoScroll,
  onSelectedJobKeyChange,
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
                    <TaskProgressCircle className="justify-self-start lg:justify-self-end lg:pt-1" percent={pipeline.percent} />
                  </div>
                )
              : (
                  <Drawer.Heading className="text-base">Pipeline</Drawer.Heading>
                )}
          </Drawer.Header>
          <Drawer.Body className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
            {pipeline && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface-secondary">
                <PipelineDetailStepper
                  jobs={stages}
                  selectedJobKey={selectedJobKey}
                  onSelect={onSelectedJobKeyChange}
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
                    <TaskProgressCircle className="ml-auto" percent={selectedJob.percent} />
                  </div>
                )}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
                  <JobLogView job={selectedJob} autoScroll={autoScroll} />
                </div>
              </div>
            )}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}
