## 前端规范

- 前端项目中，文件使用中横线格式命名
- 写组件时，尽量基于 antd 和 @ant-design/pro-components 的组件开发
- 对接 rust 服务 api 时，相关的类型从 rust 导出生成
- 需要写样式的时候，尽量用 tailwindcss 写
- 不要去手动修改 src/types/api.ts 文件的内容，只能通过 typeshare 生成
- 当组件中涉及到接口请求和数据展示，组件本身没有`request` `onFinish` 类似 props 时，优先使用 react-query 

## 后端规范

- 在声明类型时，避免以 `Model` `Entity` `Column` 结尾，这几个命名风格都属与sea_orm 相关的类型