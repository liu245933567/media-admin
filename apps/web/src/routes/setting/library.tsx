import { createFileRoute } from '@tanstack/react-router'
import { MediaRootListCard } from '@/components/media-root-list-card'

export const Route = createFileRoute('/setting/library')({
  component: LibrarySettingPage,
})

function LibrarySettingPage() {
  return <MediaRootListCard />
}
