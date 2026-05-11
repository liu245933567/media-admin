import type { ActionType } from '@ant-design/pro-components'
import type { TagProps } from 'antd'
import type { SubtitleTaskRow } from '@/types/api'
import {
  PageContainer,
  ProTable,
} from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Tag } from 'antd'
import dayjs from 'dayjs'
import { useRef, useState } from 'react'
import { QueueControls } from '@/components/queue-controls'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import {
  deleteSubtitleTask,
  fetchSubtitleTaskList,
} from '@/request'

export const Route = createFileRoute('/subtitle-task')({
  component: PageComponent,
})

/** 与后端 task_status 字符串一致 */
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

  function confirmDelete(record: SubtitleTaskRow) {
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
          <p className="mt-2 text-sm text-neutral-500">
            将一并移除该任务的执行记录与生成字幕关联数据。
          </p>
        </div>
      ),
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteSubtitleTask({ task_id: record.task_id })
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
    <PageContainer title="字幕任务入库">
      <SubtitleTaskCreateDrawerForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => tableActionRef.current?.reload()}
      />
      <ProTable<SubtitleTaskRow>
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
            onChanged={() => tableActionRef.current?.reload()}
          />,
        ]}
        options={{ reload: true }}
        columns={[
          {
            title: '路径包含',
            dataIndex: 'video_path_contains',
            hideInTable: true,
            fieldProps: { placeholder: '模糊匹配 video_path' },
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
            title: '视频路径',
            dataIndex: 'video_path',
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
            width: 170,
            search: false,
            render: (_, record) => (
              <div className="flex items-center gap-2">
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
          const page = Number(params.current ?? 1)
          const pageSize = Number(params.pageSize ?? 20)
          const res = await fetchSubtitleTaskList({
            page,
            page_size: pageSize,
            task_status: params.task_status,
            video_path_contains: params.video_path_contains,
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
