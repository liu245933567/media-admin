export const menu = [
  {
    name: '首页',
    path: '/',
    icon: 'lucide:house',
  },
  // {
  //   name: '媒体库',
  //   path: '/media-library',
  //   icon: 'lucide:folder-open',
  // },
  {
    name: 'Stash 库',
    path: '/stash-scenes',
    icon: 'lucide:play-square',
  },
  {
    name: 'Emby',
    path: '/emby',
    icon: 'lucide:server',
  },
  {
    name: '任务管理',
    path: '/tasks',
    icon: 'lucide:list-checks',
  },
  {
    name: '设置',
    path: '/setting',
    icon: 'lucide:settings',
    children: [
      { name: '默认参数', path: '/setting/defaults', icon: 'lucide:sliders-horizontal' },
      { name: 'Whisper 模型', path: '/setting/models', icon: 'lucide:brain' },
      { name: 'FFmpeg', path: '/setting/ffmpeg', icon: 'lucide:file-cog' },
      // { name: '媒体库', path: '/setting/library', icon: 'lucide:folder-cog' },
      { name: 'Stash', path: '/setting/stash', icon: 'lucide:hard-drive' },
      { name: 'Emby', path: '/setting/emby', icon: 'lucide:server-cog' },
    ],
  },
]
