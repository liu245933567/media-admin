import { Card } from '@heroui/react'
import { createFileRoute } from '@tanstack/react-router'
import { AppPage } from '@/components/app-page'

export const Route = createFileRoute('/')({
  component: PageComponent,
})

function PageComponent() {
  return (
    <AppPage title="首页" description="媒体、字幕与任务队列控制台">
      <Card>
        <Card.Header>
          <Card.Title>Media Admin</Card.Title>
          <Card.Description>选择顶部导航进入媒体库、任务管理或设置。</Card.Description>
        </Card.Header>
      </Card>
    </AppPage>
  )
}
