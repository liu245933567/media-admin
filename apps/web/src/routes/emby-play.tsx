import { Button } from '@heroui/react'
import { Icon } from '@iconify/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { EmbyVideoPlayerModal } from '@/features/emby/emby-video-player-modal'

export const Route = createFileRoute('/emby-play')({
  validateSearch: (search: Record<string, unknown>) => ({
    itemId: typeof search.itemId === 'string' ? search.itemId : '',
  }),
  component: EmbyPlayPage,
})

function EmbyPlayPage() {
  const { itemId } = Route.useSearch()
  const navigate = useNavigate()
  const [open, setOpen] = useState(Boolean(itemId))

  if (!itemId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <Icon className="size-10 text-warning" icon="lucide:triangle-alert" />
          <div>
            <h1 className="m-0 text-xl font-semibold">缺少 Emby 资源 ID</h1>
            <p className="mt-2 text-sm text-muted">请从 Emby 资源列表点击播放进入</p>
          </div>
          <Link to="/emby">
            <Button>返回 Emby</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <Button
        onPress={() => setOpen(true)}
      >
        <Icon className="ml-0.5 size-5" icon="lucide:play" />
        打开播放器
      </Button>
      <EmbyVideoPlayerModal
        itemId={itemId}
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen)
            void navigate({ to: '/emby' })
        }}
      />
    </div>
  )
}
