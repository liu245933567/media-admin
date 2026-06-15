import { createFileRoute } from '@tanstack/react-router'
import { WhisperModelsSetupCard } from '@/features/settings/whisper-models-setup-card'

export const Route = createFileRoute('/setting/models')({
  component: ModelsSettingPage,
})

function ModelsSettingPage() {
  return <WhisperModelsSetupCard />
}
