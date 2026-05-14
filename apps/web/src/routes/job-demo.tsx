import {
  PageContainer,
  ProForm,
  ProFormText,
} from '@ant-design/pro-components'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Card, Space, Switch, Typography } from 'antd'
import { useState } from 'react'
import { TaskmillDemoExecLogPanel } from '@/components/taskmill-demo-exec-log-panel'
import { TaskmillDemoHistoryPanel } from '@/components/taskmill-demo-history-panel'
import { TaskmillDemoSnapshotPanel } from '@/components/taskmill-demo-snapshot-panel'
import {
  enqueueTaskmillPipeline,
  enqueueTaskmillTranslate,
  fetchTaskmillJobDemoExecLog,
  fetchTaskmillJobDemoHistory,
  fetchTaskmillJobDemoSnapshot,
  taskmillJobDemoExecLogQueryKey,
  taskmillJobDemoHistoryQueryKey,
  taskmillJobDemoSnapshotQueryKey,
} from '@/request'

const jobDemoHistoryQueryParams = { limit: 100, offset: 0 } as const
const jobDemoExecLogQueryParams = { limit: 250 } as const

interface PipelineFormValues {
  video_path: string
}

interface TranslateFormValues {
  subtitle_path: string
  target_lang: string
}

export const Route = createFileRoute('/job-demo')({
  component: JobDemoPage,
})

function JobDemoPage() {
  const { message } = App.useApp()
  const [execLogAutoRefresh, setExecLogAutoRefresh] = useState(true)
  const snapshotQuery = useQuery({
    queryKey: taskmillJobDemoSnapshotQueryKey,
    queryFn: fetchTaskmillJobDemoSnapshot,
  })

  const historyQuery = useQuery({
    queryKey: taskmillJobDemoHistoryQueryKey(jobDemoHistoryQueryParams),
    queryFn: () => fetchTaskmillJobDemoHistory(jobDemoHistoryQueryParams),
  })

  const execLogQuery = useQuery({
    queryKey: taskmillJobDemoExecLogQueryKey(jobDemoExecLogQueryParams),
    queryFn: () => fetchTaskmillJobDemoExecLog(jobDemoExecLogQueryParams),
    refetchInterval: execLogAutoRefresh ? 1200 : false,
  })

  const pipelineMutation = useMutation({
    mutationFn: enqueueTaskmillPipeline,
    onSuccess: () => {
      message.success('已提交视频流水线任务（Taskmill 演示）')
      void snapshotQuery.refetch()
      void historyQuery.refetch()
      void execLogQuery.refetch()
    },
    onError: (e: Error) => {
      message.error(e.message || '提交失败')
    },
  })

  const translateMutation = useMutation({
    mutationFn: enqueueTaskmillTranslate,
    onSuccess: () => {
      message.success('已提交仅翻译字幕任务（Taskmill 演示）')
      void snapshotQuery.refetch()
      void historyQuery.refetch()
      void execLogQuery.refetch()
    },
    onError: (e: Error) => {
      message.error(e.message || '提交失败')
    },
  })

  const execLogContent = execLogQuery.isError
    ? (
        <Typography.Text type="danger">
          {(execLogQuery.error as Error).message || '读取执行日志失败'}
        </Typography.Text>
      )
    : (
        <TaskmillDemoExecLogPanel
          items={execLogQuery.data}
          loading={execLogQuery.isLoading || execLogQuery.isFetching}
        />
      )

  const historyContent = historyQuery.isError
    ? (
        <Typography.Text type="danger">
          {(historyQuery.error as Error).message || '读取任务历史失败'}
        </Typography.Text>
      )
    : (
        <TaskmillDemoHistoryPanel
          items={historyQuery.data}
          loading={historyQuery.isLoading || historyQuery.isFetching}
        />
      )

  const snapshotContent = snapshotQuery.isError
    ? (
        <Typography.Text type="danger">
          {(snapshotQuery.error as Error).message || '读取快照失败'}
        </Typography.Text>
      )
    : (
        <TaskmillDemoSnapshotPanel
          data={snapshotQuery.data}
          loading={snapshotQuery.isLoading || snapshotQuery.isFetching}
        />
      )

  return (
    <PageContainer
      header={{
        title: 'Taskmill 任务演示',
        subTitle: '调用后端 /api/job-demo 入队；可查看执行事件流、任务历史与调度器快照。',
      }}
    >
      <div className="flex flex-col gap-4">
        <Typography.Paragraph type="secondary" className="mb-0">
          以下为占位接口，不执行真实转码/翻译；用于验证 SQLite 持久化队列、Scheduler 和 Executor 是否收到任务。
        </Typography.Paragraph>

        <Card title="视频流水线（提取 WAV → Whisper+VAD → 翻译字幕）" variant="borderless" className="shadow-sm">
          <ProForm<PipelineFormValues>
            layout="vertical"
            submitter={{
              searchConfig: { submitText: '提交流水线任务' },
              render: (_, dom) => <Space>{dom}</Space>,
            }}
            onFinish={async (values) => {
              await pipelineMutation.mutateAsync({
                video_path: values.video_path.trim(),
              })
            }}
            loading={pipelineMutation.isPending}
          >
            <ProFormText
              name="video_path"
              label="视频路径"
              placeholder="/path/to/video.mp4"
              rules={[{ required: true, message: '请输入视频路径' }]}
            />
          </ProForm>
        </Card>

        <Card title="仅翻译字幕" variant="borderless" className="shadow-sm">
          <ProForm<TranslateFormValues>
            layout="vertical"
            submitter={{
              searchConfig: { submitText: '提交翻译任务' },
              render: (_, dom) => <Space>{dom}</Space>,
            }}
            onFinish={async (values) => {
              await translateMutation.mutateAsync({
                subtitle_path: values.subtitle_path.trim(),
                target_lang: values.target_lang.trim(),
              })
            }}
            loading={translateMutation.isPending}
          >
            <ProFormText
              name="subtitle_path"
              label="字幕文件路径"
              placeholder="/path/to/sub.srt"
              rules={[{ required: true, message: '请输入字幕路径' }]}
            />
            <ProFormText
              name="target_lang"
              label="目标语言"
              placeholder="zh"
              initialValue="zh"
              rules={[{ required: true, message: '请输入目标语言' }]}
            />
          </ProForm>
        </Card>

        <Card
          title="执行日志"
          variant="borderless"
          className="shadow-sm"
          extra={(
            <Space size="small" align="center">
              <Switch
                size="small"
                checked={execLogAutoRefresh}
                onChange={setExecLogAutoRefresh}
                checkedChildren="自动刷新"
                unCheckedChildren="手动"
              />
              <Button
                size="small"
                loading={execLogQuery.isFetching}
                onClick={() => execLogQuery.refetch()}
              >
                刷新
              </Button>
            </Space>
          )}
        >
          {execLogContent}
        </Card>

        <Card
          title="任务历史"
          variant="borderless"
          className="shadow-sm"
          extra={(
            <Button
              size="small"
              loading={historyQuery.isFetching}
              onClick={() => historyQuery.refetch()}
            >
              刷新
            </Button>
          )}
        >
          {historyContent}
        </Card>

        <Card
          title="Taskmill 快照"
          variant="borderless"
          className="shadow-sm"
          extra={(
            <Button
              size="small"
              loading={snapshotQuery.isFetching}
              onClick={() => {
                void snapshotQuery.refetch()
                void historyQuery.refetch()
                void execLogQuery.refetch()
              }}
            >
              刷新
            </Button>
          )}
        >
          {snapshotContent}
        </Card>
      </div>
    </PageContainer>
  )
}
