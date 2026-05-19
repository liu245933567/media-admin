import { ProFormGroup, ProFormText } from '@ant-design/pro-components'

export interface StashConfigFormGroupProps {
  variant?: 'setting' | 'task'
}

export function StashConfigFormGroup({ variant = 'setting' }: StashConfigFormGroupProps) {
  const apiKeyPlaceholder
    = variant === 'setting' ? '留空则保存时不覆盖已存 ApiKey' : undefined
  const apiKeyExtra
    = variant === 'setting'
      ? '设置页保存时若留空，将保留已保存的 Stash ApiKey。'
      : undefined

  return (
    <ProFormGroup title="Stash 连接">
      <ProFormText
        name={['stash_config', 'base_url']}
        label="Base URL"
        placeholder="http://127.0.0.1:9999"
        rules={[{ required: true, message: '请输入 Stash 服务地址' }]}
        extra="Stash 实例根地址，无需带 /graphql 后缀。"
        colProps={{ span: 12 }}
      />
      <ProFormText
        name={['stash_config', 'api_key']}
        label="ApiKey"
        placeholder={apiKeyPlaceholder}
        fieldProps={{ type: 'password', autoComplete: 'new-password' }}
        extra={apiKeyExtra}
        colProps={{ span: 12 }}
      />
    </ProFormGroup>
  )
}
