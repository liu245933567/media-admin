import {
  PageContainer,
  ProForm,
  ProFormText,
} from '@ant-design/pro-components'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Card, Space, Typography } from 'antd'
import {
  enqueueTaskmillPipeline,
  enqueueTaskmillTranslate,
  fetchTaskmillJobDemoSnapshot,
  taskmillJobDemoSnapshotQueryKey,
} from '@/request'

export const Route = createFileRoute('/job-demo')({
  component: JobDemoPage,
})

function JobDemoPage() {
  const { message } = App.useApp()
  const snapshotQuery = useQuery({
    queryKey: taskmillJobDemoSnapshotQueryKey,
    queryFn: fetchTaskmillJobDemoSnapshot,
  })

  const pipelineMutation = useMutation({
    mutationFn: enqueueTaskmillPipeline,
    onSuccess: () => {
      message.success('已提交视频流水线任务（Taskmill 演示）')
      snapshotQuery.refetch()
    },
    onError: (e: Error) => {
      message.error(e.message || '提交失败')
    },
  })

  const translateMutation = useMutation({
    mutationFn: enqueueTaskmillTranslate,
    onSuccess: () => {
      message.success('已提交仅翻译字幕任务（Taskmill 演示）')
      snapshotQuery.refetch()
    },
    onError: (e: Error) => {
      message.error(e.message || '提交失败')
    },
  })

  let snapshotContent = (
    <pre className="max-h-96 overflow-auto rounded bg-gray-50 p-3 text-xs">
      {JSON.stringify(snapshotQuery.data ?? {}, null, 2)}
    </pre>
  )
  if (snapshotQuery.isError) {
    snapshotContent = (
      <Typography.Text type="danger">
        {(snapshotQuery.error as Error).message || '读取快照失败'}
      </Typography.Text>
    )
  }

  return (
    <PageContainer
      header={{
        title: 'Taskmill 任务演示',
        subTitle: '调用后端 /api/job-demo 入队；下方快照展示 Taskmill 调度器与队列状态。',
      }}
    >
      <div className="mx-auto max-w-2xl space-y-6">
        <Typography.Paragraph type="secondary" className="mb-0">
          以下为占位接口，不执行真实转码/翻译；用于验证 SQLite 持久化队列、Scheduler 和 Executor 是否收到任务。
        </Typography.Paragraph>

        <Card title="视频流水线（提取 WAV → Whisper+VAD → 翻译字幕）" variant="borderless" className="shadow-sm">
          <ProForm
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
          <ProForm
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
          title="Taskmill 快照"
          variant="borderless"
          className="shadow-sm"
          extra={(
            <Button
              size="small"
              loading={snapshotQuery.isFetching}
              onClick={() => snapshotQuery.refetch()}
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
