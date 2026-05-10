import { PageContainer } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: PageComponent,
})

function PageComponent() {
  return (
    <PageContainer>
      首页
    </PageContainer>
  )
}
