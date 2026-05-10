/**
 * Stash GraphQL：请求 variables / 响应数据均为前端维护，
 * 与后端仅为 JSON 转发，typeshare 生成的 api.ts 中不包含此类声明。
 */

/** 对应 `FindFilterType` 中用于列表排序分页的常见字段 */
export type StashFindScenesFilterDirection = 'ASC' | 'DESC'

export interface StashFilter {
  page: number
  per_page: number
  sort?: string
  direction?: StashFindScenesFilterDirection
  q?: string
}

/** GraphQL `variables`（例如 findScenes 的 `$filter`） */
export interface StashFindScenesReq {
  filter: StashFilter
}

/** findScenes 查询响应字段 */
export interface StashSceneFile {
  path: string
  basename: string
}

export interface StashScenePaths {
  screenshot: string
  preview: string
  stream: string
  webp: string
  vtt: string
  sprite: string
  funscript: string
  interactive_heatmap: string
  caption: string
}

export interface StashSceneRow {
  id: string
  title: string
  date?: string
  files: StashSceneFile[]
  paths: StashScenePaths
}

export interface StashFindScenesQueryData {
  findScenes: {
    count: number
    scenes: StashSceneRow[]
  }
}

export interface StashGraphqlEnvelope<T> {
  data?: T
  errors?: Array<{ message: string }>
}

export interface FetchStashScenesParams {
  q: string
}
