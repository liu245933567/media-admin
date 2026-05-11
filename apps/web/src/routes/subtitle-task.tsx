import type { ActionType } from '@ant-design/pro-components'
import type { TagProps } from 'antd'
import type { SubtitleGenerateConfig, SubtitleTaskRow, SubtitleTranslateConfig } from '@/types/api'
import {
  ModalForm,
  PageContainer,
  ProFormDependency,
  ProFormDigit,
  ProFormGroup,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Divider, Tag } from 'antd'
import dayjs from 'dayjs'
import { useRef, useState } from 'react'
import { QueueControls } from '@/components/queue-controls'
import {
  createSubtitleTask,
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
      <ModalForm<{
        config: {
          video_path: string
          vad_config_json?: string
          whisper_engine_cfg_json?: string
          whisper_transcribe_options_json?: string
          enable_translate?: boolean
          translate_cfg?: SubtitleTranslateConfig
        }
      }>
        title="新增字幕任务"
        open={createOpen}
        onOpenChange={setCreateOpen}
        modalProps={{ destroyOnClose: true }}
        initialValues={{
          config: {
            enable_translate: false,
            translate_cfg: {
              model: 'tencent/Hunyuan-MT-7B',
              target_language: 'Chinese',
              concurrency: 4,
              batch_size: 8,
              remove_source_srt: false,
            },
          },
        }}
        submitter={{ searchConfig: { submitText: '提交' } }}
        onFinish={async (values) => {
          try {
            const vadConfigText = values.config.vad_config_json?.trim()
            const whisperEngineCfgText = values.config.whisper_engine_cfg_json?.trim()
            const whisperTranscribeOptionsText = values.config.whisper_transcribe_options_json?.trim()

            const vad_config = vadConfigText ? JSON.parse(vadConfigText) : undefined
            const whisper_engine_cfg = whisperEngineCfgText ? JSON.parse(whisperEngineCfgText) : undefined
            const whisper_transcribe_options = whisperTranscribeOptionsText ? JSON.parse(whisperTranscribeOptionsText) : undefined

            const config: SubtitleGenerateConfig = {
              video_path: values.config.video_path.trim(),
              vad_config,
              whisper_engine_cfg,
              whisper_transcribe_options,
              translate_cfg: values.config.enable_translate ? values.config.translate_cfg : undefined,
            }

            await createSubtitleTask({ config })
            message.success('任务已添加')
            tableActionRef.current?.reload()
            return true
          }
          catch (e) {
            message.error((e as Error).message || '创建失败')
            return false
          }
        }}
      >
        <ProFormText
          name={['config', 'video_path']}
          label="视频路径"
          placeholder="请输入视频路径"
          rules={[{ required: true, message: '请输入视频路径' }]}
        />

        <Divider className="my-3" />

        <ProFormGroup title="字幕生成配置" />

        <ProFormTextArea
          name={['config', 'vad_config_json']}
          label="VAD 配置(JSON)"
          placeholder="可选：ma_whisper::types::VadConfig 的 JSON"
          fieldProps={{ autoSize: { minRows: 2, maxRows: 8 } }}
        />
        <ProFormTextArea
          name={['config', 'whisper_engine_cfg_json']}
          label="Whisper 引擎配置(JSON)"
          placeholder="可选：ma_whisper::types::WhisperEngineConfig 的 JSON"
          fieldProps={{ autoSize: { minRows: 2, maxRows: 8 } }}
        />
        <ProFormTextArea
          name={['config', 'whisper_transcribe_options_json']}
          label="Whisper 识别参数(JSON)"
          placeholder="可选：ma_whisper::types::WhisperTranscribeOptions 的 JSON"
          fieldProps={{ autoSize: { minRows: 2, maxRows: 8 } }}
        />

        <Divider className="my-3" />

        <ProFormSwitch
          name={['config', 'enable_translate']}
          label="启用翻译"
        />

        <ProFormDependency name={[['config', 'enable_translate']]}>
          {({ config }) => {
            if (!config?.enable_translate)
              return null

            return (
              <>
                <ProFormText
                  name={['config', 'translate_cfg', 'target_language']}
                  label="目标语言"
                  placeholder="例如：Chinese / English / Japanese"
                  rules={[{ required: true, message: '请输入目标语言' }]}
                />
                <ProFormText
                  name={['config', 'translate_cfg', 'model']}
                  label="翻译模型"
                  placeholder="例如：tencent/Hunyuan-MT-7B"
                />
                <ProFormGroup>
                  <ProFormDigit
                    name={['config', 'translate_cfg', 'concurrency']}
                    label="并发数"
                    min={1}
                    fieldProps={{ precision: 0 }}
                  />
                  <ProFormDigit
                    name={['config', 'translate_cfg', 'batch_size']}
                    label="批大小"
                    min={1}
                    fieldProps={{ precision: 0 }}
                  />
                </ProFormGroup>
                <ProFormSwitch
                  name={['config', 'translate_cfg', 'remove_source_srt']}
                  label="翻译完成后删除原文 SRT"
                />
              </>
            )
          }}
        </ProFormDependency>
      </ModalForm>
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
