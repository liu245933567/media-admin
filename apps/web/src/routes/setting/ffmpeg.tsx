import { createFileRoute } from '@tanstack/react-router'
import { FfmpegSetupCard } from '@/features/settings/ffmpeg-setup-card'

export const Route = createFileRoute('/setting/ffmpeg')({
  component: FfmpegSettingPage,
})

function FfmpegSettingPage() {
  return <FfmpegSetupCard />
}
