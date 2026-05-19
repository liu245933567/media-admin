import type { SubtitleWebRow } from '@/types'
import { Button, Drawer, Table } from 'antd'
import { useState } from 'react'

interface XunleiSubtitleSearchDrawerProps {
  trigger: React.ReactNode
}

export function XunleiSubtitleSearchDrawer({ trigger }: XunleiSubtitleSearchDrawerProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="link" onClick={() => setOpen(true)}>{trigger}</Button>
      <Drawer open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Table<SubtitleWebRow>
          dataSource={[]}
          columns={[
            {
              title: 'ID',
              dataIndex: 'id',
            },
            {
              title: '名称',
              dataIndex: 'name',
            },
            {
              title: '语言',
              dataIndex: 'langs',
            },
            {
              title: '扩展名',
              dataIndex: 'ext',
            },
            {
              title: 'Hash 匹配',
              dataIndex: 'is_hash_match',
            },
            {
              title: '操作',
              render: _ => (
                <Button type="link" onClick={() => setOpen(true)}>下载</Button>
              ),
            },
          ]}
        />
      </Drawer>
    </>
  )
}
