import { Card } from '@heroui/react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: PageComponent,
})

function PageComponent() {
  return (
    <Card>
      <Card.Header>
        <Card.Title>Media Admin</Card.Title>
        <Card.Description>选择左侧导航进入媒体库、任务管理或设置。</Card.Description>
      </Card.Header>
    </Card>
  )
}
