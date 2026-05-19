import { PageContainer } from '@ant-design/pro-components'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button, Result } from 'antd'
import { useMemo } from 'react'
import { LocalVideoPlayer } from '@/components/local-video-player'
import {
  getFileName,
  getParentPath,
  isPlayableSubtitleFile,
  joinVideoDir,
} from '@/utils/video-path'

export interface VideoPlaySearch {
  videoPath: string
  subtitles?: string
  subtitle?: string
}

export const Route = createFileRoute('/video-play')({
  validateSearch: (search: Record<string, unknown>): VideoPlaySearch => ({
    videoPath: typeof search.videoPath === 'string' ? search.videoPath : '',
    subtitles: typeof search.subtitles === 'string' ? search.subtitles : undefined,
    subtitle: typeof search.subtitle === 'string' ? search.subtitle : undefined,
  }),
  component: PageComponent,
})

function PageComponent() {
  const { videoPath, subtitles, subtitle } = Route.useSearch()

  const videoName = useMemo(() => getFileName(videoPath), [videoPath])
  const parentDir = useMemo(() => getParentPath(videoPath), [videoPath])

  const subtitleTracks = useMemo(() => {
    if (!videoPath || !subtitles)
      return []
    return subtitles
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(isPlayableSubtitleFile)
      .map(name => ({
        label: name,
        path: joinVideoDir(videoPath, name),
      }))
  }, [videoPath, subtitles])

  if (!videoPath) {
    return (
      <PageContainer title="视频播放">
        <Result
          status="warning"
          title="缺少视频路径"
          subTitle="请从「本地视频」列表点击播放进入"
          extra={(
            <Link to="/video-folder-scan">
              <Button type="primary">返回本地视频</Button>
            </Link>
          )}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title={videoName}
      subTitle={parentDir}
      onBack={() => window.history.back()}
      extra={(
        <Link to="/video-folder-scan">
          <Button>本地视频列表</Button>
        </Link>
      )}
    >
      <LocalVideoPlayer
        videoPath={videoPath}
        subtitleTracks={subtitleTracks}
        defaultSubtitleLabel={subtitle}
      />
    </PageContainer>
  )
}
