import type { FetchStashScenesParams, StashSceneRow } from '@/types/stash-graphql'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'
import { Image, Spin } from 'antd'
import { useRef, useState } from 'react'
import { fetchStashScenes, getStashMediaUrl } from '@/request'

interface PreviewVideoProps {
  src: string
  poster?: string
}

export const Route = createFileRoute('/stash-scenes')({
  component: PageComponent,
})

/** 视频组件：支持鼠标悬停播放，截图作为海报 */
function PreviewVideo({ src, poster }: PreviewVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [loading, setLoading] = useState(true)

  if (!src) {
    return <span className="text-gray-400 text-xs">无预览</span>
  }

  return (
    <div className="relative inline-block rounded overflow-hidden" style={{ width: 160, height: 90 }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10 rounded">
          <Spin size="small" />
        </div>
      )}
      <video
        ref={videoRef}
        src={src}
        controls
        preload="metadata"
        poster={poster}
        width={160}
        height={90}
        className="rounded object-cover"
        onMouseEnter={() => { videoRef.current?.play() }}
        onMouseLeave={() => {
          const el = videoRef.current
          if (el) {
            el.pause()
            el.currentTime = 0
          }
        }}
        onLoadedData={() => setLoading(false)}
        muted
        loop
      />
    </div>
  )
}

function PageComponent() {
  return (
    <PageContainer pageHeaderRender={() => null}>
      <ProTable<StashSceneRow, FetchStashScenesParams>
        request={fetchStashScenes}
        search={
          {
            filterType: 'light',
          }
        }
        columns={[
          {
            title: '搜索',
            key: 'q',
            hideInTable: true,
          },
          {
            title: '封面',
            key: 'screenshot',
            width: 180,
            search: false,
            render: (_: unknown, r: StashSceneRow) => {
              if (!r.paths?.screenshot) {
                return (
                  <div
                    className="flex items-center justify-center bg-gray-100 rounded text-gray-400 text-xs"
                    style={{ width: 160, height: 90 }}
                  >
                    无截图
                  </div>
                )
              }
              const placeholder = (
                <div
                  className="flex items-center justify-center bg-gray-100 rounded"
                  style={{ width: 160, height: 90 }}
                >
                  <Spin size="small" />
                </div>
              )
              return (
                <Image
                  src={getStashMediaUrl(r.paths.screenshot)}
                  width={160}
                  height={90}
                  className="rounded object-cover"
                  placeholder={placeholder}
                  fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYwIiBoZWlnaHQ9IjkwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiIGZpbGw9IiNmMGYwZjAiLz48dGV4dCB4PSI4MCIgeT0iNTAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEwIiBmaWxsPSIjOTk5Ij7mmoLnkIbkuI3og70oPC90ZXh0Pjwvc3ZnPg=="
                />
              )
            },
          },
          {
            title: '文件名',
            key: 'basename',
            ellipsis: true,
            search: false,
            width: 200,
            render: (_: unknown, r: StashSceneRow) => {
              if (!r.files?.length)
                return '—'
              return r.files.map(f => f.basename).join(`\n`)
            },
          },
          { title: '标题', dataIndex: 'title', search: false },
          {
            title: '预览视频',
            key: 'preview',
            width: 180,
            search: false,
            render: (_: unknown, r: StashSceneRow) => {
              const videoSrc = r.paths?.preview ? getStashMediaUrl(r.paths.preview) : ''
              const posterSrc = r.paths?.screenshot ? getStashMediaUrl(r.paths.screenshot) : undefined
              return <PreviewVideo src={videoSrc} poster={posterSrc} />
            },
          },
          {
            title: '操作',
            valueType: 'option',
            render: () => [
              <a key="edit">
                查询字幕
              </a>,
            ],
          },
        ]}
      />
    </PageContainer>
  )
}
