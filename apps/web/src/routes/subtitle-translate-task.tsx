import type { ActionType } from '@ant-design/pro-components'
import type { TagProps } from 'antd'
import type { SubtitleTranslateTaskRow } from '@/types/api'
import {
  PageContainer,
  ProTable,
} from '@ant-design/pro-components'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Tag } from 'antd'
import dayjs from 'dayjs'
import { useRef, useState } from 'react'
import { QueueControls } from '@/components/queue-controls'
import { SubtitleTranslateTaskCreateDrawerForm } from '@/components/subtitle-translate-task-create-drawer-form'
import {
  deleteSubtitleTranslateTask,
  fetchSubtitleTranslateTaskList,
  fetchSubtitleTranslateTaskQueueStatus,
  pauseSubtitleTranslateTaskQueue,
  resumeSubtitleTranslateTaskQueue,
  retrySubtitleTranslateTask,
  subtitleTranslateTaskQueueStatusQueryKey,
} from '@/request'

export const Route = createFileRoute('/subtitle-translate-task')({
  component: PageComponent,
})

const TASK_STATUS_META: Record<
  string,
  { label: string, color: TagProps['color'] }
> = {
  PENDING: { label: '待处理', color: 'default' },
  RUNNING: { label: '处理中', color: 'processing' },
  COMPLETED: { label: '已完成', color: 'success' },
  FAILED: { label: '失败', color: 'error' },
}

const TASK_STATUS_VALUE_ENUM = Object.fromEntries(
  Object.entries(TASK_STATUS_META).map(([key, { label }]) => [
    key,
    { text: label },
  ]),
)

function PageComponent() {
  const { message, modal } = App.useApp()
  const tableActionRef = useRef<ActionType>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const retryMutation = useMutation({
    mutationFn: retrySubtitleTranslateTask,
    onSuccess: () => {
      message.success('已重新开始')
      tableActionRef.current?.reload()
    },
    onError: (e) => {
      message.error((e as Error).message || '重试失败')
    },
  })

  function confirmDelete(record: SubtitleTranslateTaskRow) {
    modal.confirm({
      title: '删除任务',
      content: (
        <div className="text-neutral-700">
          <p>
            确定删除任务
            {' '}
            <strong>
              #
              {record.task_id}
            </strong>
            ？删除后不可恢复。
          </p>
        </div>
      ),
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteSubtitleTranslateTask({ task_id: record.task_id })
          message.success('已删除')
          tableActionRef.current?.reload()
        }
        catch (e) {
          message.error((e as Error).message || '删除失败')
          throw e
        }
      },
    })
  }

  return (
    <PageContainer title="字幕翻译任务">
      <SubtitleTranslateTaskCreateDrawerForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => tableActionRef.current?.reload()}
      />
      <ProTable<SubtitleTranslateTaskRow>
        rowKey="task_id"
        actionRef={tableActionRef}
        search={{
          labelWidth: 'auto',
          defaultCollapsed: false,
        }}
        toolBarRender={() => [
          <Button key="add" type="primary" onClick={() => setCreateOpen(true)}>
            新增任务
          </Button>,
          <QueueControls
            key="queue-controls"
            statusQueryKey={subtitleTranslateTaskQueueStatusQueryKey}
            fetchQueueStatus={fetchSubtitleTranslateTaskQueueStatus}
            pauseQueue={pauseSubtitleTranslateTaskQueue}
            resumeQueue={resumeSubtitleTranslateTaskQueue}
            onChanged={() => tableActionRef.current?.reload()}
          />,
        ]}
        options={{ reload: true }}
        columns={[
          {
            title: '路径包含',
            dataIndex: 'path_contains',
            hideInTable: true,
            fieldProps: { placeholder: '模糊匹配源 SRT 路径' },
          },
          {
            title: '任务 ID',
            dataIndex: 'task_id',
            width: 90,
            search: false,
            sorter: false,
          },
          {
            title: '状态',
            dataIndex: 'task_status',
            width: 110,
            valueType: 'select',
            fieldProps: { allowClear: true, placeholder: '全部' },
            valueEnum: TASK_STATUS_VALUE_ENUM,
            render: (_, row) => {
              const meta = TASK_STATUS_META[row.task_status]
              if (meta) {
                return (
                  <Tag color={meta.color}>
                    {meta.label}
                  </Tag>
                )
              }
              return (
                <Tag>
                  {row.task_status}
                </Tag>
              )
            },
          },
          {
            title: '源 SRT 路径',
            dataIndex: 'source_srt_path',
            search: false,
            ellipsis: true,
          },
          {
            title: '创建时间',
            dataIndex: 'created_at',
            width: 200,
            search: false,
            render: (_, record) => <span>{dayjs(record.created_at).format('YYYY-MM-DD HH:mm:ss')}</span>,
          },
          {
            title: '更新时间',
            dataIndex: 'updated_at',
            width: 200,
            search: false,
            render: (_, record) => <span>{dayjs(record.updated_at).format('YYYY-MM-DD HH:mm:ss')}</span>,
          },
          {
            title: '操作',
            dataIndex: 'action',
            width: 220,
            search: false,
            render: (_, record) => (
              <div className="flex flex-wrap items-center gap-2">
                {record.task_status === 'FAILED' && (
                  <Button
                    type="link"
                    className="m-0! p-0!"
                    loading={
                      retryMutation.isPending
                      && retryMutation.variables?.task_id === record.task_id
                    }
                    onClick={() => retryMutation.mutate({ task_id: record.task_id })}
                  >
                    重新开始
                  </Button>
                )}
                <Button
                  type="link"
                  danger
                  className="m-0! p-0!"
                  onClick={() => confirmDelete(record)}
                  disabled={record.task_status === 'RUNNING'}
                >
                  删除
                </Button>
              </div>
            ),
          },
        ]}
        request={async (params) => {
          const res = await fetchSubtitleTranslateTaskList({
            current: params.current ?? 1,
            page_size: params.pageSize ?? 20,
            task_status: params.task_status,
            path_contains: params.path_contains,
          })
          return {
            data: res.items,
            success: true,
            total: res.total,
          }
        }}
      />
    </PageContainer>
  )
}
