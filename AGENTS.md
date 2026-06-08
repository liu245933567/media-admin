# AGENTS

## 主规范

- 注意逻辑复用性，尽量做好封装

## 前端规范

- 前端项目中，文件使用中横线格式命名
- 写组件时，尽量基于 `@heroui/react` 和 `@heroui-pro/react` 的组件开发
- 前端组件相关 skill `heroui-pro-design-taste`、`heroui-react-pro`、`heroui-react`
- 前端组件相关 mcp ``hero-pro`、`hero-react`
- 写组件时，尽量与项目中其他相似逻辑组件撰写的风格相同
- 对接 rust 服务 api 时，相关的类型从 rust 导出生成
- 需要写样式的时候，尽量用 tailwindcss 写
- 写样式的时候，注意应用主题的兼容
- 不要去手动修改 `src/api/generated.schemas.ts` 和 `src/api/generated.ts` 文件的内容，只能通过脚本生成
- 遇到 lint 错误的时候，先尝试使用 lint 指令修复，修完完还不好再手动改

## 后端规范

- 在声明类型时，避免以 `Model` `Entity` `Column` 结尾（历史上海外 ORM 常用后缀）；数据库行结构优先用语义化名称或与表对应的业务名
- 在声明结构体和方法时，写一下注释
