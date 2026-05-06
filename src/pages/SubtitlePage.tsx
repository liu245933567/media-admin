import { ProCard } from '@ant-design/pro-components'
import { useMutation, useQuery } from '@tanstack/react-query'
import { App, Button, Input, Progress, Space, Table, Tag, Typography, theme } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createLocalSubtitleJob,
  downloadSubtitle,
  getLocalSubtitleJob,
  listLocalSubtitleJobs,
  searchSubtitles,
  type SubtitleItem,
} from '../api'

function phaseLabel(phase: string): string {
  const m: Record<string, string> = {
    ensure_model: '检查模型',
    download_model: '下载模型',
    extract_audio: '抽取音频',
    transcribe: '语音转写',
    translate: '翻译',
    write_file: '写入文件',
    pending: '排队',
    error: '错误',
  }
  return m[phase] ?? phase
}

export function SubtitlePage() {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const [videoPath, setVideoPath] = useState('Y:/porn/A Husband Shares his Wife with a BULL - Pornhub.com.mp4')
  const [rows, setRows] = useState<SubtitleItem[]>([])
  const [cid, setCid] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trackedLocalJobId, setTrackedLocalJobId] = useState<string | null>(null)
  /** 用户点「隐藏进度面板」后为 true，避免仍从 running 列表自动跟第一条 */
  const [autoPickBlocked, setAutoPickBlocked] = useState(false)
  const toastedSuccessJobId = useRef<string | null>(null)

  const search = useMutation({
    mutationFn: () => searchSubtitles(videoPath.trim()),
    onSuccess: (data) => {
      setRows(data.items)
      setCid(data.cid)
      setSelectedId(null)
      message.success(`找到 ${data.items.length} 条字幕`)
    },
    onError: (err: Error) => {
      message.error(err.message)
    },
  })

  const { data: runningJobs } = useQuery({
    queryKey: ['localSubtitleJobs', 'running'],
    queryFn: () => listLocalSubtitleJobs({ status: 'running', limit: 10 }),
  })

  const displayLocalJobId = useMemo(
    () =>
      trackedLocalJobId ??
      (autoPickBlocked ? null : (runningJobs?.[0]?.id ?? null)),
    [trackedLocalJobId, autoPickBlocked, runningJobs],
  )

  const { data: localJob } = useQuery({
    queryKey: ['localSubtitleJob', displayLocalJobId],
    queryFn: () => getLocalSubtitleJob(displayLocalJobId!),
    enabled: !!displayLocalJobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status
      if (s !== 'running') return false
      return q.state.data?.phase === 'transcribe' ? 600 : 1500
    },
  })

  const localGenerate = useMutation({
    mutationFn: () => createLocalSubtitleJob(videoPath.trim()),
    onSuccess: (data) => {
      setAutoPickBlocked(false)
      setTrackedLocalJobId(data.job_id)
      message.success(data.reused ? '已有进行中的任务，继续显示进度' : '已开始本地生成字幕')
    },
    onError: (err: Error) => {
      message.error(err.message)
    },
  })

  useEffect(() => {
    if (
      localJob?.status === 'succeeded' &&
      localJob.id &&
      toastedSuccessJobId.current !== localJob.id
    ) {
      toastedSuccessJobId.current = localJob.id
      message.success(`本地字幕已完成：${localJob.subtitle_path ?? ''}`)
    }
  }, [localJob?.status, localJob?.id, localJob?.subtitle_path, message])

  const download = useMutation({
    mutationFn: () => {
      if (!selectedId) {
        return Promise.reject(new Error('请先选择一条字幕'))
      }
      return downloadSubtitle(videoPath.trim(), selectedId)
    },
    onSuccess: (data) => {
      message.success(`已保存：${data.subtitle_path}`)
    },
    onError: (err: Error) => {
      message.error(err.message)
    },
  })

  const columns: ColumnsType<SubtitleItem> = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        ellipsis: true,
      },
      {
        title: '语言',
        dataIndex: 'langs',
        width: 140,
      },
      {
        title: '格式',
        dataIndex: 'ext',
        width: 80,
      },
      {
        title: '匹配',
        dataIndex: 'is_hash_match',
        width: 100,
        render: (v: boolean) =>
          v ? <Tag color="success">CID 一致</Tag> : <Tag>—</Tag>,
      },
    ],
    [],
  )

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: token.paddingLG,
      }}
    >
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        字幕下载
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        请输入后端所在机器可访问的<strong>视频绝对路径</strong>（例如{' '}
        <code>D:\Movies\sample.mkv</code>），查询迅雷字幕后选择与视频同目录保存。
      </Typography.Paragraph>

      <ProCard bordered style={{ marginBottom: token.marginLG }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="视频绝对路径"
              value={videoPath}
              onChange={(e) => setVideoPath(e.target.value)}
              onPressEnter={() => search.mutate()}
            />
            <Button
              type="primary"
              loading={search.isPending}
              onClick={() => search.mutate()}
            >
              查询字幕
            </Button>
          </Space.Compact>
          {cid ? (
            <Typography.Text type="secondary">
              视频 CID（采样 SHA1）：{cid}
            </Typography.Text>
          ) : null}
        </Space>
      </ProCard>

      <ProCard
        title="本地生成字幕（Whisper large-v3 + DeepSeek 翻译）"
        bordered
        style={{ marginBottom: token.marginLG }}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          使用与上方相同的<strong>视频绝对路径</strong>；若未配置本地模型将自动从网络下载。关闭页面后重新打开仍会显示进行中的任务进度。
        </Typography.Paragraph>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap>
            <Button
              type="primary"
              loading={localGenerate.isPending}
              disabled={!videoPath.trim()}
              onClick={() => localGenerate.mutate()}
            >
              开始本地生成
            </Button>
            {displayLocalJobId ? (
              <Button
                onClick={() => {
                  setAutoPickBlocked(true)
                  setTrackedLocalJobId(null)
                }}
              >
                隐藏进度面板
              </Button>
            ) : null}
          </Space>
          {displayLocalJobId && localJob ? (
            <div>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Typography.Text>
                  任务 <Typography.Text code>{localJob.id}</Typography.Text>
                  {localJob.status === 'running' ? (
                    <Tag color="processing" style={{ marginLeft: 8 }}>
                      进行中
                    </Tag>
                  ) : localJob.status === 'succeeded' ? (
                    <Tag color="success" style={{ marginLeft: 8 }}>
                      已完成
                    </Tag>
                  ) : localJob.status === 'failed' ? (
                    <Tag color="error" style={{ marginLeft: 8 }}>
                      失败
                    </Tag>
                  ) : null}
                </Typography.Text>
                <Typography.Text type="secondary">
                  阶段：{phaseLabel(localJob.phase)} · {localJob.message}
                </Typography.Text>
                <Progress
                  percent={Math.round(Math.min(100, Math.max(0, localJob.progress)))}
                  status={
                    localJob.status === 'failed'
                      ? 'exception'
                      : localJob.status === 'succeeded'
                        ? 'success'
                        : 'active'
                  }
                />
                {localJob.phase === 'download_model' &&
                localJob.detail?.bytes_downloaded != null ? (
                  <Typography.Text type="secondary">
                    已下载{' '}
                    {(localJob.detail.bytes_downloaded / 1048576).toFixed(1)} MB
                    {localJob.detail.total_bytes != null
                      ? ` / ${(localJob.detail.total_bytes / 1048576).toFixed(1)} MB`
                      : ''}
                  </Typography.Text>
                ) : null}
                {localJob.detail?.whisper_logs &&
                localJob.detail.whisper_logs.length > 0 ? (
                  <div style={{ width: '100%' }}>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                      Whisper 实时日志
                    </Typography.Text>
                    <Input.TextArea
                      readOnly
                      value={localJob.detail.whisper_logs.join('\n')}
                      autoSize={{ minRows: 4, maxRows: 16 }}
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                        fontSize: 12,
                      }}
                    />
                  </div>
                ) : null}
                {localJob.status === 'failed' && localJob.error ? (
                  <Typography.Text type="danger">{localJob.error}</Typography.Text>
                ) : null}
                {localJob.status === 'succeeded' && localJob.subtitle_path ? (
                  <Typography.Text>
                    输出文件：{localJob.subtitle_path}
                  </Typography.Text>
                ) : null}
              </Space>
            </div>
          ) : displayLocalJobId ? (
            <Typography.Text type="secondary">加载任务状态…</Typography.Text>
          ) : null}
        </Space>
      </ProCard>

      <ProCard title="字幕列表" bordered>
        <Table<SubtitleItem>
          rowKey="id"
          loading={search.isPending}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 8 }}
          rowSelection={{
            type: 'radio',
            selectedRowKeys: selectedId ? [selectedId] : [],
            onChange: (keys) => {
              const id = keys[0]
              setSelectedId(
                id === undefined || id === null ? null : String(id),
              )
            },
          }}
          locale={{ emptyText: search.isPending ? '加载中…' : '暂无数据，请先查询' }}
        />
        <div style={{ marginTop: token.marginMD }}>
          <Button
            type="primary"
            loading={download.isPending}
            disabled={!selectedId || !videoPath.trim()}
            onClick={() => download.mutate()}
          >
            下载到视频同目录
          </Button>
        </div>
      </ProCard>
    </div>
  )
}
