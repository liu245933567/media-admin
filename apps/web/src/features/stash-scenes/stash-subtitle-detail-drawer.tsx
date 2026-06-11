import type { StashSceneCaption, StashSceneRow } from '@/api'
import { Alert, Drawer, ScrollShadow, Spinner, Tabs } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { readTextFs } from '@/api'
import { deserializeSubtitleText } from '@/utils/subtitle'

interface StashSubtitleDetailDrawerProps {
  row?: StashSceneRow
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function StashSubtitleDetailDrawer({
  row,
  open,
  onOpenChange,
}: StashSubtitleDetailDrawerProps) {
  const captions = useMemo(() => row?.captions ?? [], [row?.captions])
  const captionOptions = useMemo(() => {
    const keyCounts = new Map<string, number>()

    return captions.map((caption, index) => {
      const baseKey = caption.local_path?.trim()
        || caption.path?.trim()
        || `${caption.language_code?.trim() || 'unknown'}-${caption.caption_type?.trim() || 'caption'}`
      const count = keyCounts.get(baseKey) ?? 0
      keyCounts.set(baseKey, count + 1)

      return {
        caption,
        index,
        key: count ? `${baseKey}-${count + 1}` : baseKey,
        label: formatCaptionLabel(caption, index),
        localPath: caption.local_path?.trim() || undefined,
        stashPath: caption.path?.trim() || undefined,
      }
    })
  }, [captions])
  const [selectedCaptionKey, setSelectedCaptionKey] = useState<string>()
  const effectiveSelectedCaptionKey = captionOptions.some(option => option.key === selectedCaptionKey)
    ? selectedCaptionKey
    : captionOptions[0]?.key
  const selectedOption = captionOptions.find(option => option.key === effectiveSelectedCaptionKey)
  const selectedPath = selectedOption?.localPath
  const selectedDisplayPath = selectedOption?.localPath ?? selectedOption?.stashPath
  const title = row?.title?.trim() || row?.files?.[0]?.basename || row?.id || '字幕详情'

  const readSubtitleQuery = useQuery({
    queryKey: ['stash-subtitle-content', selectedPath],
    queryFn: async () => {
      if (!selectedPath)
        return []
      const res = await readTextFs({ path: selectedPath })
      return deserializeSubtitleText(res.content)
    },
    enabled: open && Boolean(selectedPath),
  })

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen)
      setSelectedCaptionKey(undefined)
  }

  return (
    <Drawer.Backdrop
      isOpen={open}
      onOpenChange={handleOpenChange}
    >
      <Drawer.Content placement="right" className="inset-y-0 right-0 left-auto w-[min(720px,calc(100vw-2rem))] sm:max-w-180">
        <Drawer.Dialog className="ml-auto flex h-dvh w-full flex-col">
          <Drawer.CloseTrigger />
          <Drawer.Header className="shrink-0 border-b border-separator pr-12">
            <Drawer.Heading className="truncate text-base" title={title}>
              字幕详情
            </Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body className="min-h-0 flex-1 overflow-hidden p-0">
            {captionOptions.length
              ? (
                  <Tabs
                    className="flex h-full min-h-0 flex-col"
                    selectedKey={effectiveSelectedCaptionKey}
                    onSelectionChange={key => setSelectedCaptionKey(String(key))}
                  >
                    <div className="shrink-0 border-b border-separator px-3 py-1.5">
                      <div className="overflow-x-auto">
                        <Tabs.ListContainer>
                          <Tabs.List
                            aria-label="字幕列表"
                            className="w-max *:h-6 *:w-fit *:px-2 *:text-xs *:font-normal"
                          >
                            {captionOptions.map(option => (
                              <Tabs.Tab
                                key={option.key}
                                id={option.key}
                                className={option.localPath ? undefined : 'text-muted'}
                              >
                                {option.index > 0 ? <Tabs.Separator /> : null}
                                {option.label}
                                <Tabs.Indicator />
                              </Tabs.Tab>
                            ))}
                          </Tabs.List>
                        </Tabs.ListContainer>
                      </div>
                      <div
                        className="mt-1 truncate font-mono text-[11px] text-muted"
                        title={selectedDisplayPath}
                      >
                        {selectedDisplayPath ?? '未映射字幕路径'}
                      </div>
                    </div>
                    {captionOptions.map(option => (
                      <Tabs.Panel
                        key={option.key}
                        id={option.key}
                        className="min-h-0 flex-1 overflow-hidden"
                      >
                        {selectedOption?.key === option.key
                          ? (
                              <ScrollShadow className="h-full px-3 py-2" hideScrollBar>
                                <StashSubtitleContent
                                  isPending={readSubtitleQuery.isFetching}
                                  error={readSubtitleQuery.error}
                                  items={readSubtitleQuery.data}
                                  selectedPath={selectedPath}
                                />
                              </ScrollShadow>
                            )
                          : null}
                      </Tabs.Panel>
                    ))}
                  </Tabs>
                )
              : <div className="px-3 py-4 text-sm text-muted">暂无字幕</div>}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}

function StashSubtitleContent({
  isPending,
  error,
  items,
  selectedPath,
}: {
  isPending: boolean
  error: Error | null
  items?: ReturnType<typeof deserializeSubtitleText>
  selectedPath?: string
}) {
  if (!selectedPath) {
    return (
      <div className="py-8 text-center text-sm text-muted">
        选择已映射字幕查看内容
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted">
        <Spinner size="sm" />
        加载中
      </div>
    )
  }

  if (error) {
    return (
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>读取字幕失败</Alert.Title>
          <Alert.Description>{error.message}</Alert.Description>
        </Alert.Content>
      </Alert>
    )
  }

  if (!items?.length) {
    return <div className="py-8 text-center text-sm text-muted">暂无内容</div>
  }

  return (
    <div className="flex flex-col text-xs">
      {items.map(item => (
        <div key={`${item.startTime}-${item.endTime}`} className="grid grid-cols-[12.5rem_minmax(0,1fr)] gap-2 rounded px-1.5 py-1 hover:bg-surface-secondary max-sm:grid-cols-1 max-sm:gap-0.5">
          <div className="whitespace-nowrap font-mono text-[10px] leading-5 tabular-nums text-muted">
            {item.startTime}
            <span className="mx-1">~</span>
            {item.endTime}
          </div>
          <div className="min-w-0 whitespace-pre-wrap leading-5">
            {item.text}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatCaptionLabel(caption: StashSceneCaption, index: number): string {
  const lang = caption.language_code?.trim() || `字幕 ${index + 1}`
  const type = caption.caption_type?.trim()
  return type ? `${lang}.${type}` : lang
}
