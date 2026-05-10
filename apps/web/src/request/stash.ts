import type { ProTableProps } from '@ant-design/pro-components'
import type { SortOrder } from 'antd/es/table/interface'
import type { FetchStashScenesParams, StashFilter, StashFindScenesQueryData, StashGraphqlEnvelope, StashSceneRow } from '@/types'
import { post } from './utils'

/** 转发 GraphQL body 到 Stash（服务端注入 ApiKey） */
export function fetchStashGraphql<T>(body: Record<string, unknown>) {
  return post<StashGraphqlEnvelope<T>, Record<string, unknown>>('/stash/graphql', body)
}

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

export const fetchStashScenes: ProTableProps<StashSceneRow, FetchStashScenesParams>['request'] = async (params, sort) => {
  /** findScenes 查询文档，由前端拼接完整 GraphQL body */
  const FIND_SCENES_QUERY = `
    query MyQuery($filter: FindFilterType) {
        findScenes(filter: $filter) {
            count
            scenes {
                id
                title
                date
                files {
                    path
                    basename
                }
                paths {
                    screenshot
                    preview
                    stream
                    webp
                    vtt
                    sprite
                    funscript
                    interactive_heatmap
                    caption
                }
            }
        }
    }`

  const listFilter: StashFilter = {
    page: params.current ?? 1,
    per_page: params.pageSize ?? 20,
    q: params.q,
    ...toStashSortOrder(sort),
  }

  const body = {
    query: FIND_SCENES_QUERY.trim(),
    variables: { filter: listFilter },
  }

  const res = await fetchStashGraphql<StashFindScenesQueryData>(body)

  if (res.errors?.length) {
    throw new Error(res.errors.map(e => e.message).join('; '))
  }

  const payload = res.data?.findScenes

  return {
    data: payload?.scenes ?? [],
    success: true,
    total: payload?.count ?? 0,
  }
}
