import type { ActionType, ProColumns } from '@ant-design/pro-components'
import type { MediaSubtitleRow, MediaVideoRow } from '@/types'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Button, List, Popover, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { useMemo, useRef, useState } from 'react'
import { SubtitleDetailModal } from '@/components/subtitle-detail'
import {
  fetchMediaFiles,
  fetchMediaRoots,
  mediaRootsQueryKey,
} from '@/request'
import { formatBytes } from '@/utils'

export const Route = createFileRoute('/media-library')({
  component: PageComponent,
})

function PageComponent() {
  const filesActionRef = useRef<ActionType>(null)
  const [fileKeyword, setFileKeyword] = useState('')

  const rootsQuery = useQuery({
    queryKey: mediaRootsQueryKey,
    queryFn: fetchMediaRoots,
  })

  const rootOptions = useMemo(() => {
    return (rootsQuery.data ?? []).map(root => ({
      label: root.name,
      value: Number(root.id),
    }))
  }, [rootsQuery.data])

  const fileColumns = useMemo<ProColumns<MediaVideoRow>[]>(() => [
    {
      title: '文件名',
      dataIndex: 'file_name',
      ellipsis: true,
      copyable: true,
    },
    {
      title: '资源路径',
      dataIndex: 'root_id',
      width: 180,
      valueType: 'select',
      fieldProps: {
        options: rootOptions,
        showSearch: true,
        optionFilterProp: 'label',
      },
      render: (_, row) => {
        const root = (rootsQuery.data ?? []).find(item => Number(item.id) === Number(row.root_id))
        return root?.name ?? row.root_id
      },
    },
    {
      title: '字幕数量',
      dataIndex: 'subtitle_count',
      width: 110,
      search: false,
      render: (_, row) => (
        <SubtitleCountPopover
          videoName={row.file_name}
          subtitles={row.subtitles ?? []}
          onChanged={() => filesActionRef.current?.reload()}
        />
      ),
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      width: 120,
      search: false,
      render: (_, row) => formatBytes(Number(row.file_size)),
    },
    {
      title: '修改时间',
      dataIndex: 'modified_at',
      width: 180,
      search: false,
      render: (_, row) => dayjs(row.modified_at).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '完整路径',
      dataIndex: 'file_path',
      ellipsis: true,
      copyable: true,
      search: false,
    },
  ], [rootOptions, rootsQuery.data])

  return (
    <PageContainer title={false}>
      <Space direction="vertical" size={16} className="w-full">
        <ProTable<MediaVideoRow>
          rowKey="id"
          actionRef={filesActionRef}
          columns={fileColumns}
          request={async (params) => {
            const res = await fetchMediaFiles({
              root_id: params.root_id ? Number(params.root_id) : undefined,
              q: fileKeyword,
              current: params.current,
              page_size: params.pageSize,
            })
            return {
              data: res.data,
              total: Number(res.total),
              success: true,
            }
          }}
          search={{ labelWidth: 88 }}
          options={{ density: false, setting: false }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          toolbar={{
            search: {
              placeholder: '搜索文件名或路径',
              onSearch: (value) => {
                setFileKeyword(value.trim())
                filesActionRef.current?.reload()
              },
            },
          }}
        />
      </Space>
    </PageContainer>
  )
}

function SubtitleCountPopover({
  videoName,
  subtitles,
  onChanged,
}: {
  videoName: string
  subtitles: MediaSubtitleRow[]
  onChanged: () => void
}) {
  if (!subtitles.length) {
    return <Tag>0</Tag>
  }

  const content = (
    <List
      size="small"
      dataSource={subtitles}
      className="min-w-64 max-w-[28rem]"
      renderItem={subtitle => (
        <List.Item
          actions={[
            <SubtitleDetailModal
              key="detail"
              subtitlePath={subtitle.file_path}
              onDeleted={onChanged}
              trigger={({ setOpen }) => (
                <Button
                  type="link"
                  size="small"
                  className="m-0! p-0!"
                  onClick={() => setOpen(true)}
                >
                  详情
                </Button>
              )}
            />,
          ]}
        >
          <Typography.Text ellipsis={{ tooltip: subtitle.file_name }}>
            {subtitleDisplayName(videoName, subtitle.file_name)}
          </Typography.Text>
        </List.Item>
      )}
    />
  )

  return (
    <Popover content={content} trigger="hover">
      <Tag color="blue" className="cursor-pointer">
        {subtitles.length}
      </Tag>
    </Popover>
  )
}

function subtitleDisplayName(videoName: string, subtitleName: string): string {
  const videoStem = trimExtension(videoName)
  const subtitleStem = trimExtension(subtitleName)
  const subtitleExt = subtitleName.slice(subtitleStem.length)
  if (subtitleStem === videoStem) {
    return subtitleExt || subtitleName
  }
  const prefix = `${videoStem}.`
  if (subtitleStem.startsWith(prefix)) {
    return `${subtitleStem.slice(prefix.length)}${subtitleExt}`
  }
  return subtitleName
}

function trimExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.')
  return idx > 0 ? fileName.slice(0, idx) : fileName
}
