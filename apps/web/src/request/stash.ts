import type { ProTableProps } from '@ant-design/pro-components'
import type { SortOrder } from 'antd/es/table/interface'
import type { PageResult, StashFilter, StashSceneListReq, StashSceneRow } from '@/types'
import { post } from './utils'

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

export interface FetchStashScenesParams {
  q?: string
}

export const fetchStashScenes: ProTableProps<StashSceneRow, FetchStashScenesParams>['request'] = async (params, sort) => {
  const res = await post<PageResult<StashSceneRow>, StashSceneListReq>('/stash/scenes/list', {
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
