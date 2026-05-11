import type { SubtitleWebRow, SubtitleWebSearchRes } from '@/types/api'
import { ProTable } from '@ant-design/pro-components'
import { App, Button, Modal } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { downloadSubtitleToDisk, searchSubtitles } from '@/request'

export interface SubtitleWebModalProps {
  open: boolean
  videoPath: string | null
  onClose: () => void
  onDownloaded?: () => Promise<void> | void
}

function pickBestSubtitle(items: SubtitleWebRow[]): SubtitleWebRow | undefined {
  if (!items.length)
    return undefined
  const byHash = items.find(i => i.is_hash_match)
  return byHash ?? items[0]
}

export function SubtitleWebModal({
  open,
  videoPath,
  onClose,
  onDownloaded,
}: SubtitleWebModalProps) {
  const { message } = App.useApp()

  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<SubtitleWebSearchRes | null>(null)

  const canQuery = Boolean(videoPath?.trim())

  const emptyText = useMemo(() => {
    if (!videoPath)
      return '未选择视频文件'
    if (searching)
      return '查询中...'
    if (searchResult)
      return searchResult.items.length ? '' : '无候选字幕'
    return '打开弹窗后自动查询'
  }, [searchResult, searching, videoPath])

  const runSearch = useCallback(async (p: string) => {
    setSearching(true)
    try {
      const res = await searchSubtitles({ video_path: p })
      setSearchResult(res)
    }
    catch (e) {
      message.error((e as Error).message || '查询网络字幕失败')
      setSearchResult(null)
    }
    finally {
      setSearching(false)
    }
  }, [message])

  useEffect(() => {
    if (!open)
      return
    if (!canQuery)
      return
    void runSearch(videoPath!.trim())
  }, [canQuery, open, runSearch, videoPath])

  async function downloadOne(subtitle: SubtitleWebRow) {
    const p = videoPath?.trim()
    if (!p) {
      message.warning('未选择视频文件')
      return
    }
    const res = await downloadSubtitleToDisk({ video_path: p, subtitle_id: subtitle.id })
    message.success(`已写入磁盘：${res.subtitle_path}`)
    await onDownloaded?.()
  }

  async function downloadBest() {
    const items = searchResult?.items ?? []
    const best = pickBestSubtitle(items)
    if (!best) {
      message.warning('没有可下载的字幕')
      return
    }
    try {
      await downloadOne(best)
    }
    catch (e) {
      message.error((e as Error).message || '下载失败')
    }
  }

  return (
    <Modal
      title="网络字幕搜索/下载"
      open={open}
      onCancel={() => {
        setSearchResult(null)
        onClose()
      }}
      footer={null}
      width={900}
      destroyOnClose
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-xs text-gray-500">
            当前视频
          </div>
          <div className="break-all font-mono text-xs">
            {videoPath ?? '-'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            loading={searching}
            onClick={async () => {
              const p = videoPath?.trim()
              if (!p) {
                message.warning('未选择视频文件')
                return
              }
              await runSearch(p)
            }}
          >
            重新查询
          </Button>

          <Button
            type="primary"
            disabled={!searchResult?.items?.length || searching}
            onClick={downloadBest}
          >
            下载默认字幕（hash 优先）
          </Button>
        </div>

        <ProTable<SubtitleWebRow>
          rowKey="id"
          search={false}
          options={false}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          loading={searching}
          dataSource={searchResult?.items ?? []}
          locale={{ emptyText }}
          columns={[
            { title: '名称', dataIndex: 'name', ellipsis: true },
            { title: '语言', dataIndex: 'langs', width: 120 },
            { title: '扩展名', dataIndex: 'ext', width: 90 },
            {
              title: 'Hash 匹配',
              dataIndex: 'is_hash_match',
              width: 100,
              render: (_, row) => (row.is_hash_match ? '是' : '否'),
            },
            {
              title: '操作',
              width: 140,
              render: (_, row) => (
                <Button
                  size="small"
                  type="primary"
                  disabled={!canQuery}
                  onClick={async () => {
                    try {
                      await downloadOne(row)
                    }
                    catch (e) {
                      message.error((e as Error).message || '下载失败')
                    }
                  }}
                >
                  下载到磁盘
                </Button>
              ),
            },
          ]}
        />
      </div>
    </Modal>
  )
}
