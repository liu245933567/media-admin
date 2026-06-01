import type { TaskmillExecLogEntry } from '@/api'
import { Label, Switch } from '@heroui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTaskmillTime } from '@/lib/taskmill-time'

interface TaskEventHeaderLike {
  task_id?: number
  label?: string
  task_type?: string
}

function readEventHeader(event: Record<string, unknown>): TaskEventHeaderLike | undefined {
  const data = event.data
  if (!data || typeof data !== 'object') {
    return undefined
  }
  const d = data as Record<string, unknown>
  if ('header' in d && d.header && typeof d.header === 'object') {
    return d.header as TaskEventHeaderLike
  }
  if ('task_id' in d) {
    return d as TaskEventHeaderLike
  }
  return undefined
}

/** 将 taskmill `SchedulerEvent` JSON 压缩为一行可读摘要 */
export function formatTaskmillExecLogSummary(event: Record<string, unknown>): string {
  const typeStr = typeof event.type === 'string' ? event.type : '?'
  const h = readEventHeader(event)
  const who = h
    ? `[#${h.task_id ?? '?'} ${(h.label || h.task_type || '').trim()}] `
    : ''

  switch (typeStr) {
    case 'Progress': {
      const data = event.data as Record<string, unknown> | undefined
      const pct = typeof data?.percent === 'number'
        ? `${Math.round(data.percent * 1000) / 10}%`
        : ''
      const msg = typeof data?.message === 'string' ? data.message : ''
      return `${who}${pct} ${msg}`.trim()
    }
    case 'Dispatched':
      return `${who}已派发`.trim()
    case 'Completed':
      return `${who}已完成`.trim()
    case 'Failed': {
      const data = event.data as Record<string, unknown> | undefined
      const err = typeof data?.error === 'string' ? data.error : ''
      const retry = data?.will_retry === true ? '（将重试）' : ''
      return `${who}失败${retry}: ${err}`.trim()
    }
    case 'Preempted':
      return `${who}被抢占`.trim()
    case 'Cancelled':
      return `${who}已取消`.trim()
    case 'DeadLettered': {
      const data = event.data as Record<string, unknown> | undefined
      const err = typeof data?.error === 'string' ? data.error : ''
      return `${who}死信: ${err}`.trim()
    }
    case 'Superseded': {
      const data = event.data as Record<string, unknown> | undefined
      const nid = data?.new_task_id
      return `${who}被取代 → 新任务 #${nid ?? '?'}`.trim()
    }
    case 'BatchSubmitted': {
      const data = event.data as Record<string, unknown> | undefined
      const c = data?.count
      return `批量提交: ${String(c ?? '?')} 条`.trim()
    }
    case 'Paused':
      return '调度器：全局暂停'
    case 'Resumed':
      return '调度器：恢复运行'
    default:
      return typeStr
  }
}

export interface TaskmillExecLogPanelProps {
  items: TaskmillExecLogEntry[] | undefined
  loading?: boolean
}

export function TaskmillExecLogPanel({
  items,
  loading,
}: TaskmillExecLogPanelProps) {
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => items ?? [], [items])

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) {
      return
    }
    const el = scrollRef.current
    el.scrollTop = el.scrollHeight
  }, [lines, autoScroll])

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Switch isSelected={autoScroll} onChange={setAutoScroll}>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label className="text-sm">自动滚底</Label>
          </Switch.Content>
        </Switch>
        <p className="m-0 text-xs text-muted">
          数据来自调度器事件流（含 executor 上报的进度文案）；服务端最多保留约 400 条。卡片右上角可开关自动轮询。
        </p>
      </div>
      <div
        ref={scrollRef}
        className="max-h-80 overflow-auto rounded-lg border border-border bg-surface-secondary px-3 py-2 font-mono text-xs leading-relaxed"
      >
        {loading && lines.length === 0
          ? <span className="text-muted">加载中...</span>
          : lines.length === 0
            ? <span className="text-muted">暂无事件；提交任务后将出现派发与进度日志。</span>
            : lines.map((row, i) => {
                const ts = formatTaskmillTime(row.received_at)
                const summary = formatTaskmillExecLogSummary(row.event)
                return (
                  <div key={`${row.received_at}-${i}`} className="whitespace-pre-wrap break-all border-b border-border py-1 last:border-b-0">
                    <span className="select-none text-muted">
                      {ts}
                    </span>
                    {' '}
                    <span>{summary}</span>
                  </div>
                )
              })}
      </div>
    </div>
  )
}
