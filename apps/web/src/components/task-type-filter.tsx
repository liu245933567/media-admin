import { Button } from '@heroui/react'
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
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-sm text-neutral-500">任务类型</span>
      <Button
        size="sm"
        variant={value === undefined ? 'primary' : 'tertiary'}
        onPress={() => onChange(undefined)}
      >
        全部
      </Button>
      {options.map(t => (
        <Button
          key={t}
          size="sm"
          variant={value === t ? 'primary' : 'tertiary'}
          onPress={() => onChange(t)}
        >
          {taskTypeLabel(t)}
        </Button>
      ))}
    </div>
  )
}
