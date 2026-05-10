import type { FetchStashScenesParams, StashSceneRow } from '@/types/stash-graphql'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'
import { fetchStashScenes } from '@/request'

export const Route = createFileRoute('/stash-scenes')({
  component: PageComponent,
})

function PageComponent() {
  return (
    <PageContainer pageHeaderRender={() => null}>
      <ProTable<StashSceneRow, FetchStashScenesParams>
        request={fetchStashScenes}
        search={
          {
            filterType: 'light',
          }
        }
        columns={[
          {
            title: '搜索',
            key: 'q',
            hideInTable: true,
          },
          {
            title: '文件名',
            key: 'basename',
            ellipsis: true,
            search: false,
            render: (_: unknown, r: StashSceneRow) =>
              r.files?.length ? r.files.map(f => f.basename).join(`\n`) : '—',
          },
          { title: '标题', dataIndex: 'title', search: false },
          {
            title: '操作',
            valueType: 'option',
            render: () => [
              <a key="edit">
                查询字幕
              </a>,
            ],
          },
        ]}
      />
    </PageContainer>
  )
}
