import type { SubtitleWebRow, SubtitleWebSearchRes } from '@/types/api'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'
import { App, Button } from 'antd'
import { useState } from 'react'
import { downloadSubtitleToDiskApi, searchSubtitlesApi } from '@/request'

export const Route = createFileRoute('/subtitle-web')({
  component: PageComponent,
})

function PageComponent() {
  const { message } = App.useApp()
  const [searchResult, setSearchResult] = useState<SubtitleWebSearchRes | null>(null)

  function pickBestSubtitle(items: SubtitleWebRow[]): SubtitleWebRow | undefined {
    if (!items.length)
      return undefined
    const byHash = items.find(i => i.is_hash_match)
    return byHash ?? items[0]
  }

  async function onDownloadToDisk(subtitle: SubtitleWebRow) {
    const video_path = searchResult?.video_path
    if (!video_path) {
      message.warning('请先查询字幕')
      return
    }
    const res = await downloadSubtitleToDiskApi({ video_path, subtitle_id: subtitle.id })
    message.success(`已写入磁盘：${res.subtitle_path}`)
  }

  async function onDownloadBest() {
    const items = searchResult?.items ?? []
    const best = pickBestSubtitle(items)
    if (!best) {
      message.warning('没有可下载的字幕，请先查询')
      return
    }
    try {
      await onDownloadToDisk(best)
    }
    catch (e) {
      message.error((e as Error).message || '下载失败')
    }
  }

  const emptyText
    = searchResult && searchResult.items.length === 0
      ? '无候选字幕'
      : '请先输入路径并查询'

  return (
    <PageContainer>
      <ProTable<SubtitleWebRow>
        search={{
          labelWidth: 'auto',
          defaultCollapsed: false,
        }}
        options={false}
        pagination={false}
        locale={{ emptyText }}
        onRequestError={(error) => {
          message.error(error.message ?? '查询字幕失败')
        }}
        request={async (params) => {
          const video_path = String(params.video_path ?? '').trim()
          if (!video_path) {
            return { data: [], success: true }
          }
          const r = await searchSubtitlesApi({ video_path })
          setSearchResult(r)
          return {
            data: r.items,
            success: true,
          }
        }}
        toolBarRender={() => [
          <Button
            key="default"
            disabled={!searchResult?.items.length}
            onClick={onDownloadBest}
          >
            下载默认字幕（hash 优先）
          </Button>,
        ]}
        columns={[
          {
            title: '视频路径',
            dataIndex: 'video_path',
            hideInTable: true,
            fieldProps: {
              placeholder: '例如 D:\\video\\movie.mkv 或 /mnt/video/movie.mkv',
            },
            formItemProps: {
              rules: [{ required: true, message: '请输入视频文件的绝对路径' }],
            },
          },
          {
            title: '名称',
            dataIndex: 'name',
            search: false,
            ellipsis: true,
          },
          { title: '语言', dataIndex: 'langs', search: false, width: 120 },
          { title: '扩展名', dataIndex: 'ext', search: false, width: 90 },
          {
            title: 'Hash 匹配',
            dataIndex: 'is_hash_match',
            search: false,
            width: 100,
            render: (_, row) => (row.is_hash_match ? '是' : '否'),
          },
          {
            title: '操作',
            search: false,
            width: 120,
            render: (_, row) => (
              <Button
                size="small"
                type="primary"
                onClick={async () => {
                  try {
                    await onDownloadToDisk(row)
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
    </PageContainer>
  )
}
