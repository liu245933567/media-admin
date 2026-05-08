import type { DataNode } from 'antd/es/tree'
import type { DownloadBody, SubtitleWebRow, SubtitleWebSearchRes } from '@/types/api'
import { ProCard, ProTable } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Flex, Form, Input, Space, Tree, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { downloadSubtitleBytes, fetchFsList, searchSubtitles } from '@/request'

export const Route = createFileRoute('/subtitle-web')({
  component: PageComponent,
})

type FsNode = DataNode & {
  key: string
  isLeaf?: boolean
  children?: FsNode[]
}

function PageComponent() {
  const { message } = App.useApp()

  const [form] = Form.useForm<{ root: string }>()
  const [treeData, setTreeData] = useState<FsNode[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [checkedKeys, setCheckedKeys] = useState<string[]>([])

  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SubtitleWebSearchRes[]>([])

  const videoExts = useMemo(() => {
    return ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'ts', 'webm']
  }, [])

  const selectedVideoPaths = useMemo(() => {
    const set = new Set(checkedKeys)
    // 只保留看起来像文件的 key（后端树 key 就是 path；目录也会被选中，这里先用后缀过滤一层）
    return [...set].filter((p) => {
      const idx = p.lastIndexOf('.')
      if (idx < 0)
        return false
      const ext = p.slice(idx + 1).toLowerCase()
      return videoExts.includes(ext)
    })
  }, [checkedKeys, videoExts])

  function pickBestSubtitle(items: SubtitleWebRow[]): SubtitleWebRow | undefined {
    if (!items.length)
      return undefined
    const byHash = items.find(i => i.is_hash_match)
    return byHash ?? items[0]
  }

  async function onLoadTree() {
    const root = (form.getFieldValue('root') ?? '').trim()
    setTreeLoading(true)
    try {
      const items = await fetchFsList(root ? { parent_path: root } : {})
      const children: FsNode[] = items.map(i => ({
        title: i.name,
        key: i.full_path,
        isLeaf: !i.is_dir,
      }))

      // root 为空：Windows 下返回盘符列表；有值：返回该目录下的 children
      setTreeData(
        root
          ? [{
              title: root,
              key: root,
              isLeaf: false,
              children,
            }]
          : children,
      )
      setCheckedKeys([])
      setSearchResults([])
    }
    catch (e) {
      message.error((e as Error).message || '加载文件树失败')
    }
    finally {
      setTreeLoading(false)
    }
  }

  async function onBatchSearch() {
    if (!selectedVideoPaths.length) {
      message.warning('请先在左侧文件树勾选视频文件')
      return
    }
    setSearchLoading(true)
    setSearchResults([])
    try {
      const out: SubtitleWebSearchRes[] = []
      for (const p of selectedVideoPaths) {
        const r = await searchSubtitles({ video_path: p })
        out.push(r)
      }
      setSearchResults(out)
      message.success(`已查询 ${out.length} 个文件的网络字幕`)
    }
    catch (e) {
      message.error((e as Error).message || '查询字幕失败')
    }
    finally {
      setSearchLoading(false)
    }
  }

  async function saveArrayBufferAsFile(buf: ArrayBuffer, filename: string) {
    const blob = new Blob([buf], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function filenameFromContentDisposition(v?: string) {
    if (!v)
      return undefined
    const m = /filename="([^"]+)"/i.exec(v)
    return m?.[1]
  }

  async function onDownloadOne(video_path: string, subtitle: SubtitleWebRow) {
    const body: DownloadBody = { video_path, subtitle_id: subtitle.id }
    const res = await downloadSubtitleBytes(body)
    const filename = filenameFromContentDisposition(res.headers?.['content-disposition']) ?? `${subtitle.name}.${subtitle.ext}`
    await saveArrayBufferAsFile(res.data, filename)
  }

  async function onBatchDownloadBest() {
    if (!searchResults.length) {
      message.warning('请先批量查询字幕')
      return
    }
    const pairs = searchResults
      .map(r => ({ video_path: r.video_path, best: pickBestSubtitle(r.items) }))
      .filter((x): x is { video_path: string, best: SubtitleWebRow } => Boolean(x.best))

    if (!pairs.length) {
      message.warning('没有可下载的字幕')
      return
    }

    for (const { video_path, best } of pairs) {
      try {
        await onDownloadOne(video_path, best)
      }
      catch (e) {
        message.error(`${video_path} 下载失败：${(e as Error).message || '未知错误'}`)
      }
    }
  }

  return (
    <ProCard direction="column" gutter={12} style={{ padding: 12 }}>
      <ProCard>
        <Form
          form={form}
          layout="inline"
          initialValues={{ root: '' }}
          style={{ width: '100%' }}
        >
          <Form.Item
            name="root"
            label="Root"
            style={{ flex: 1, minWidth: 320 }}
          >
            <Input placeholder="可选：例如 D:\\video 或 /mnt/video；留空则列出盘符/根目录" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" loading={treeLoading} onClick={onLoadTree}>
                加载文件树
              </Button>
              <Button disabled={!treeData.length} loading={searchLoading} onClick={onBatchSearch}>
                批量查询 web 字幕
              </Button>
              <Button disabled={!searchResults.length} onClick={onBatchDownloadBest}>
                批量下载（默认匹配）
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </ProCard>

      <ProCard split="vertical" gutter={12}>
        <ProCard title="文件树（多选）" colSpan="40%">
          {treeData.length
            ? (
                <>
                  <Typography.Paragraph style={{ marginBottom: 8 }}>
                    已选视频：
                    {selectedVideoPaths.length}
                    个
                  </Typography.Paragraph>
                  <div className="page-panel">
                    <Tree
                      checkable
                      selectable={false}
                      treeData={treeData}
                      checkedKeys={checkedKeys}
                      loadData={async (node) => {
                        const key = node.key as string
                        if (!key || node.isLeaf || (node.children && node.children.length))
                          return

                        const items = await fetchFsList({ parent_path: key })
                        const children: FsNode[] = items.map(i => ({
                          title: i.name,
                          key: i.full_path,
                          isLeaf: !i.is_dir,
                        }))

                        const update = (list: FsNode[]): FsNode[] => {
                          return list.map((n) => {
                            if (n.key === key)
                              return { ...n, children }
                            if (n.children)
                              return { ...n, children: update(n.children) }
                            return n
                          })
                        }
                        setTreeData(prev => update(prev))
                      }}
                      onCheck={(keys) => {
                        const next = Array.isArray(keys) ? keys : keys.checked
                        setCheckedKeys(next as string[])
                      }}
                    />
                  </div>
                </>
              )
            : (
                <Typography.Text type="secondary">
                  先填写 root 并点击“加载文件树”。
                </Typography.Text>
              )}
        </ProCard>

        <ProCard title="查询结果">
          <div className="page-panel">
            <Flex vertical gap={8}>
              <Typography.Text type="secondary">
                默认下载规则：优先选择 `is_hash_match=true`，否则取第一条。
              </Typography.Text>

              <ProTable<{
                key: string
                video_path: string
                cid: string
                subtitle?: SubtitleWebRow
                count: number
              }>
                rowKey="key"
                search={false}
                options={false}
                pagination={false}
                dataSource={searchResults.map((r) => {
                  const best = pickBestSubtitle(r.items)
                  return {
                    key: r.video_path,
                    video_path: r.video_path,
                    cid: r.cid,
                    subtitle: best,
                    count: r.items.length,
                  }
                })}
                columns={[
                  { title: '视频路径', dataIndex: 'video_path', ellipsis: true },
                  { title: '候选数', dataIndex: 'count', width: 90 },
                  {
                    title: '默认字幕',
                    render: (_, row) =>
                      row.subtitle
                        ? `${row.subtitle.name} (${row.subtitle.langs}) .${row.subtitle.ext}${row.subtitle.is_hash_match ? ' [hash]' : ''}`
                        : <Typography.Text type="secondary">无</Typography.Text>,
                  },
                  {
                    title: '操作',
                    width: 120,
                    render: (_, row) =>
                      row.subtitle
                        ? (
                            <Button
                              size="small"
                              onClick={async () => {
                                try {
                                  await onDownloadOne(row.video_path, row.subtitle!)
                                }
                                catch (e) {
                                  message.error((e as Error).message || '下载失败')
                                }
                              }}
                            >
                              下载
                            </Button>
                          )
                        : null,
                  },
                ]}
              />
            </Flex>
          </div>
        </ProCard>
      </ProCard>
    </ProCard>
  )
}
