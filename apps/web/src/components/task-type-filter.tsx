import { Button, Space } from 'antd'
import { useMemo } from 'react'
import { collectTaskTypes, taskTypeLabel } from '@/lib/task-type-labels'

export interface TaskTypeFilterProps {
  /** 历史与快照中出现的 task_type */
  taskTypes: Iterable<string>
  value: string | undefined
  onChange: (taskType: string | undefined) => void
}

export function TaskTypeFilter({ taskTypes, value, onChange }: TaskTypeFilterProps) {
  const options = useMemo(() => collectTaskTypes(taskTypes), [taskTypes])

  return (
    <Space wrap className="mb-3">
      <span className="text-sm text-neutral-500">任务类型</span>
      <Button
        size="small"
        type={value === undefined ? 'primary' : 'default'}
        onClick={() => onChange(undefined)}
      >
        全部
      </Button>
      {options.map(t => (
        <Button
          key={t}
          size="small"
          type={value === t ? 'primary' : 'default'}
          onClick={() => onChange(t)}
        >
          {taskTypeLabel(t)}
        </Button>
      ))}
    </Space>
  )
}
