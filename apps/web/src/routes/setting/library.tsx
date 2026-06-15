import { createFileRoute } from '@tanstack/react-router'
import { MediaRootListCard } from '@/features/settings/media-root-list-card'

export const Route = createFileRoute('/setting/library')({
  component: LibrarySettingPage,
})

function LibrarySettingPage() {
  return <MediaRootListCard />
}
