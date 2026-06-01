import type { ProTableProps } from '@ant-design/pro-components'
import type { SortOrder } from 'antd/es/table/interface'
import type { StashFilter, StashSceneRow } from '@/api'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'
import { Switch } from 'antd'
import { useState } from 'react'
import { listScenesStash } from '@/api'
import { StashSceneCover } from '@/components/stash-scene-cover'

interface FetchStashScenesParams {
  q?: string
}

export const Route = createFileRoute('/stash-scenes')({
  component: PageComponent,
})

function toStashSortOrder(sort: Record<string, SortOrder>): Pick<StashFilter, 'sort' | 'direction'> {
  const firstKey = Object.keys(sort)[0]
  if (!firstKey) {
    return {}
  }
  return {
    sort: firstKey,
    direction: sort[firstKey] === 'ascend' ? 'ASC' : 'DESC',
  }
}

const requestStashScenes: ProTableProps<StashSceneRow, FetchStashScenesParams>['request'] = async (params, sort) => {
  const res = await listScenesStash({
    filter: {
      page: params.current ?? 1,
      page_size: params.pageSize ?? 20,
      q: params.q,
      sort: 'updated_at',
      direction: 'DESC',
      ...toStashSortOrder(sort),
    },
  })

  return {
    data: res.data,
    success: true,
    total: res.total,
  }
}

function PageComponent() {
  const [screenshotShow, setScreenshotShow] = useState(false)

  return (
    <PageContainer pageHeaderRender={() => null}>
      <ProTable<StashSceneRow, FetchStashScenesParams>
        request={requestStashScenes}
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
