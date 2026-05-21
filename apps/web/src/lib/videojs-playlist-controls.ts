import type Component from 'video.js/dist/types/component'
import type Player from 'video.js/dist/types/player'
import videojs from 'video.js'

/** 播放列表切换：由 LocalVideoPlayer 写入 player.options_.playlistNav */
export interface VideoJsPlaylistNavOptions {
  onPrev?: () => void
  onNext?: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
}

function getPlaylistNav(player: Player): VideoJsPlaylistNavOptions | undefined {
  return (player.options_ as { playlistNav?: VideoJsPlaylistNavOptions }).playlistNav
}

/** video.js Button 实例方法（官方 Component 类型未暴露） */
interface VjsButtonInstance {
  controlText: (text: string) => void
  addClass: (className: string) => void
  el: () => Element
  player: () => Player
  buildCSSClass: () => string
  handleClick: () => void
}

function applyPlaylistButtonIcon(btn: VjsButtonInstance, iconClass: string) {
  btn.el().querySelector('.vjs-icon-placeholder')?.classList.add(iconClass)
}

const VjsButton = videojs.getComponent('Button') as typeof Component

class PlaylistPrevButton extends VjsButton {
  constructor(player: Player, options?: object) {
    super(player, options)
    const btn = this as unknown as VjsButtonInstance
    btn.controlText('上一个')
    btn.addClass('vjs-playlist-prev-button')
    applyPlaylistButtonIcon(btn, 'vjs-icon-previous-item')
  }

  buildCSSClass(this: VjsButtonInstance) {
    return 'vjs-playlist-prev-button vjs-control vjs-button'
  }

  handleClick(this: VjsButtonInstance) {
    getPlaylistNav(this.player())?.onPrev?.()
  }
}

class PlaylistNextButton extends VjsButton {
  constructor(player: Player, options?: object) {
    super(player, options)
    const btn = this as unknown as VjsButtonInstance
    btn.controlText('下一个')
    btn.addClass('vjs-playlist-next-button')
    applyPlaylistButtonIcon(btn, 'vjs-icon-next-item')
  }

  buildCSSClass(this: VjsButtonInstance) {
    return 'vjs-playlist-next-button vjs-control vjs-button'
  }

  handleClick(this: VjsButtonInstance) {
    getPlaylistNav(this.player())?.onNext?.()
  }
}

let registered = false

/** 注册上一集 / 下一集按钮（模块内只执行一次） */
export function registerVideoJsPlaylistControls() {
  if (registered)
    return
  registered = true
  videojs.registerComponent('PlaylistPrevButton', PlaylistPrevButton)
  videojs.registerComponent('PlaylistNextButton', PlaylistNextButton)
}

interface VjsControlButton { disable: () => void, enable: () => void }

interface VjsControlBar {
  getChild: (name: string) => unknown
  children: () => unknown[]
  addChild: (name: string, options?: object, index?: number) => void
}

function findControlBarChildIndex(controlBar: VjsControlBar, childName: string): number {
  const key = childName.toLowerCase()
  const kids = controlBar.children() as Array<{ name?: () => string }>
  return kids.findIndex(c => c.name?.().toLowerCase() === key)
}

/** 在默认 controlBar 上插入上一集/下一集，避免覆盖 children 导致字幕按钮被提前 hide */
export function installVideoJsPlaylistButtons(
  player: Player,
  nav: VideoJsPlaylistNavOptions,
) {
  const controlBar = player.getChild('controlBar') as VjsControlBar | undefined
  if (!controlBar?.getChild('playToggle'))
    return

  let playIndex = findControlBarChildIndex(controlBar, 'playToggle')
  if (playIndex < 0)
    return

  if (!controlBar.getChild('playlistPrevButton')) {
    controlBar.addChild('playlistPrevButton', {}, playIndex)
    playIndex = findControlBarChildIndex(controlBar, 'playToggle')
  }

  if (!controlBar.getChild('playlistNextButton') && playIndex >= 0) {
    controlBar.addChild('playlistNextButton', {}, playIndex + 1)
  }

  ;(player.options_ as { playlistNav?: VideoJsPlaylistNavOptions }).playlistNav = nav
  syncVideoJsPlaylistButtons(player, nav)
}

/** player 就绪后安装；可重复调用（已安装则跳过） */
export function ensureVideoJsPlaylistButtons(
  player: Player,
  nav: VideoJsPlaylistNavOptions | undefined,
) {
  if (!nav)
    return
  const run = () => installVideoJsPlaylistButtons(player, nav)
  if (player.readyState() >= 1)
    run()
  else
    player.ready(run)
}

/** 字幕轨异步挂载后刷新 CC 按钮（否则 TrackButton 在仅「关闭」时会 hide 且不再显示） */
export function refreshSubsCapsButton(player: Player) {
  const controlBar = player.getChild('controlBar') as VjsControlBar | undefined
  const subs = controlBar?.getChild('subsCapsButton') as { update?: () => void } | undefined
  subs?.update?.()
}

/** 同步播放列表按钮的禁用状态 */
export function syncVideoJsPlaylistButtons(
  player: Player,
  nav: VideoJsPlaylistNavOptions | undefined,
) {
  if (!nav)
    return
  const controlBar = player.getChild('controlBar') as { getChild: (name: string) => VjsControlButton | undefined } | undefined
  const prev = controlBar?.getChild('playlistPrevButton')
  const next = controlBar?.getChild('playlistNextButton')
  if (nav.prevDisabled)
    prev?.disable()
  else
    prev?.enable()
  if (nav.nextDisabled)
    next?.disable()
  else
    next?.enable()
}

registerVideoJsPlaylistControls()
