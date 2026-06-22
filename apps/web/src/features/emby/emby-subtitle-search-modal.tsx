import type { EmbyRemoteSubtitle } from '@/api'
import { Alert, Button, Modal, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  downloadSubtitleEmby,
  searchSubtitlesEmby,
} from '@/api'
import { useAppToast } from '@/components/app-toast'

interface EmbySubtitleSearchModalProps {
  itemId: string
  mediaSourceId?: string | null
  open: boolean
  onDownloaded?: () => void
  onOpenChange: (open: boolean) => void
}

const LANGUAGE_OPTIONS = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: '英文' },
  { key: 'ja', label: '日文' },
  { key: 'ko', label: '韩文' },
]

export function EmbySubtitleSearchModal({
  itemId,
  mediaSourceId,
  open,
  onDownloaded,
  onOpenChange,
}: EmbySubtitleSearchModalProps) {
  const message = useAppToast()
  const [language, setLanguage] = useState('zh')

  const subtitlesQuery = useQuery({
    queryKey: ['emby-subtitles-search', itemId, mediaSourceId, language],
    queryFn: () => searchSubtitlesEmby({
      item_id: itemId,
      language,
      media_source_id: mediaSourceId || undefined,
    }),
    enabled: Boolean(open && itemId),
    staleTime: 60 * 1000,
  })

  const downloadMutation = useMutation({
    mutationFn: (subtitle: EmbyRemoteSubtitle) => downloadSubtitleEmby({
      item_id: itemId,
      subtitle_id: subtitle.id,
    }),
    onSuccess: () => {
      message.success('字幕已下载')
      onDownloaded?.()
    },
    onError: error => message.error(error.message || '字幕下载失败'),
  })

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange} variant="blur">
      <Modal.Container size="lg" scroll="inside" className="max-w-[880px]">
        <Modal.Dialog className="bg-background text-foreground">
          <Modal.Header className="flex-row items-center gap-3 border-b border-border">
            <Modal.Heading className="min-w-0 flex-1">
              <span className="block text-base font-semibold">查询 Emby 字幕</span>
              <span className="block text-xs font-normal text-muted">下载后会刷新播放器字幕菜单</span>
            </Modal.Heading>
            <Button
              isIconOnly
              aria-label="关闭字幕查询"
              className="text-muted hover:bg-surface-secondary hover:text-foreground"
              variant="ghost"
              onPress={() => onOpenChange(false)}
            >
              <Icon className="size-5" icon="lucide:x" />
            </Button>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {LANGUAGE_OPTIONS.map(option => (
                <Button
                  key={option.key}
                  size="sm"
                  variant={language === option.key ? 'secondary' : 'ghost'}
                  onPress={() => setLanguage(option.key)}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            {subtitlesQuery.isError && (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>字幕查询失败</Alert.Title>
                  <Alert.Description>{subtitlesQuery.error.message}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            {subtitlesQuery.isFetching
              ? (
                  <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted">
                    <Spinner color="current" size="sm" />
                    正在查询字幕...
                  </div>
                )
              : subtitlesQuery.data?.items.length
                ? (
                    <div className="max-h-[min(62vh,32rem)] overflow-y-auto rounded-md border border-border">
                      <div className="divide-y divide-border">
                        {subtitlesQuery.data.items.map(subtitle => (
                          <SubtitleRow
                            key={subtitle.id}
                            subtitle={subtitle}
                            downloading={downloadMutation.isPending}
                            onDownload={() => downloadMutation.mutate(subtitle)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                : (
                    <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-md border border-border text-center text-muted">
                      <Icon className="size-8" icon="lucide:captions-off" />
                      <span className="text-sm">没有找到字幕</span>
                    </div>
                  )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function SubtitleRow({
  subtitle,
  downloading,
  onDownload,
}: {
  subtitle: EmbyRemoteSubtitle
  downloading: boolean
  onDownload: () => void
}) {
  const meta = [
    subtitle.provider_name,
    subtitle.language,
    subtitle.format,
    subtitle.is_hash_match ? 'Hash 匹配' : undefined,
    subtitle.download_count != null ? `${subtitle.download_count} 次下载` : undefined,
    subtitle.community_rating != null ? `评分 ${subtitle.community_rating.toFixed(1)}` : undefined,
  ].filter(Boolean).join(' · ')

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground" title={subtitle.name}>
          {subtitle.name}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted" title={meta}>
          {meta || '字幕'}
        </div>
        {subtitle.comment && (
          <div className="mt-1 line-clamp-2 text-xs text-muted">
            {subtitle.comment}
          </div>
        )}
      </div>
      <Button
        isIconOnly
        aria-label={`下载字幕 ${subtitle.name}`}
        isPending={downloading}
        className="self-center text-muted hover:bg-surface-secondary hover:text-foreground"
        variant="ghost"
        onPress={onDownload}
      >
        <Icon className="size-4" icon="lucide:download" />
      </Button>
    </div>
  )
}
