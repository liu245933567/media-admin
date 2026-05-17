import type { FetchStashScenesParams, StashSceneRow } from '@/types/stash-graphql'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'
import { StashSceneCover } from '@/components/stash-scene-cover'
import { fetchStashScenes, getStashMediaUrl } from '@/request'

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
            title: '封面',
            key: 'screenshot',
            width: 180,
            search: false,
            render: (_: unknown, r: StashSceneRow) => (
              <StashSceneCover
                screenshot={r.paths?.screenshot ? getStashMediaUrl(r.paths.screenshot) : undefined}
                preview={r.paths?.preview ? getStashMediaUrl(r.paths.preview) : undefined}
              />
            ),
          },
          {
            title: '文件名',
            key: 'basename',
            ellipsis: true,
            search: false,
            width: 200,
            render: (_: unknown, r: StashSceneRow) => {
              if (!r.files?.length)
                return '—'
              return r.files.map(f => f.basename).join(`\n`)
            },
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
