import { Button, Dropdown } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useState } from 'react'
import { SubtitleWebModal } from '@/components/subtitle-web-modal'

interface StashSceneActionsProps {
  localPath?: string
  videoPath?: string
  onPlay: (videoPath: string) => void
  onCreateSubtitle: (videoPath: string) => void
}

export function StashSceneActions({
  localPath,
  videoPath,
  onPlay,
  onCreateSubtitle,
}: StashSceneActionsProps) {
  const [subtitleWebOpen, setSubtitleWebOpen] = useState(false)
  const disabledActionKeys = [
    ...(!localPath ? ['play', 'create-subtitle'] : []),
    ...(!videoPath ? ['search-subtitle'] : []),
  ]

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger>
          <Button isIconOnly aria-label="场景操作" size="sm" variant="ghost">
            <Icon className="size-4" icon="lucide:ellipsis" />
          </Button>
        </Dropdown.Trigger>
        <Dropdown.Popover>
          <Dropdown.Menu
            disabledKeys={disabledActionKeys}
            onAction={(key) => {
              if (key === 'play' && localPath)
                onPlay(localPath)
              if (key === 'search-subtitle' && videoPath)
                setSubtitleWebOpen(true)
              if (key === 'create-subtitle' && localPath)
                onCreateSubtitle(localPath)
            }}
          >
            <Dropdown.Item id="play" textValue="播放">
              <Icon className="size-4 shrink-0 text-muted" icon="lucide:play" />
              播放
            </Dropdown.Item>
            <Dropdown.Item id="search-subtitle" textValue="查询字幕">
              <Icon className="size-4 shrink-0 text-muted" icon="lucide:search" />
              查询字幕
            </Dropdown.Item>
            <Dropdown.Item id="create-subtitle" textValue="生成字幕">
              <Icon className="size-4 shrink-0 text-muted" icon="lucide:captions" />
              生成字幕
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      {subtitleWebOpen && videoPath
        ? (
            <SubtitleWebModal
              open={subtitleWebOpen}
              videoPath={videoPath}
              onOpenChange={setSubtitleWebOpen}
            />
          )
        : null}
    </>
  )
}
