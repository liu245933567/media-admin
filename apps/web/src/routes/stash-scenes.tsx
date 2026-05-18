import type { FetchStashScenesParams } from '@/request/stash'
import type { StashSceneRow } from '@/types'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'
import { Switch } from 'antd'
import { useState } from 'react'
import { StashSceneCover } from '@/components/stash-scene-cover'
import { fetchStashScenes } from '@/request'

export const Route = createFileRoute('/stash-scenes')({
  component: PageComponent,
})

function PageComponent() {
  const [screenshotShow, setScreenshotShow] = useState(false)

  return (
    <PageContainer pageHeaderRender={() => null}>
      <ProTable<StashSceneRow, FetchStashScenesParams>
        request={fetchStashScenes}
        search={
          {
            filterType: 'light',
          }
        }
        toolBarRender={() => [
          <Switch
            key="screenshot"
            checked={screenshotShow}
            checkedChildren="显示封面"
            unCheckedChildren="隐藏封面"
            onChange={checked => setScreenshotShow(checked)}
          />,
        ]}
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
            hidden: !screenshotShow,
            search: false,
            render: (_: unknown, r: StashSceneRow) => (
              <StashSceneCover
                screenshot={r.paths?.screenshot}
                preview={r.paths?.preview}
              />
            ),
          },
          {
            title: '文件名',
            key: 'basename',
            ellipsis: true,
            search: false,
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
            width: 100,
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
