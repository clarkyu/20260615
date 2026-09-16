'use client'

// 预热应用壳:让作答页 / 成绩页在「断网后刷新」时还能打开。
//
// 学生是从首页点进作答页的 —— 那是客户端路由跳转,浏览器从没为 /play/<id> 发过
// 一次文档请求,Service Worker 自然也没东西可缓存。等他在信号不好的教室里刷新一下,
// 页面就没了(作答还在 IndexedDB,但人会以为丢了)。
// 所以进页面后主动拉一次自己的 HTML,让 SW 按策略('shell')存下来。响应里没有
// 任何个人信息(这两张页面都是客户端组件,数据另走接口),存下来是安全的。

export function warmShell(): void {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker

  let done = false
  // 只预热当前这一页;失败就算了,这只是个锦上添花的优化。
  // 没被 SW 接管的时候发这一发是白发的(请求根本不经过 SW,存不下来),所以要等接管。
  const warm = () => {
    if (done || !navigator.onLine || !sw.controller) return
    done = true
    sw.removeEventListener('controllerchange', warm)
    void fetch(window.location.pathname, { credentials: 'same-origin' }).catch(() => {})
  }

  warm()
  if (done) return
  // SW 刚装上、还没接管这个页面 —— 学生**第一次**打开作答页就是这种情况(实测 mount 时
  // controller 还是 null,几秒后才接管)。早先这里直接 return 就不管了,于是第一次开卷的壳
  // 永远存不下来,断网一刷新只能弹到 /offline 页;而第一次用恰恰最容易乱点乱刷新。
  sw.addEventListener('controllerchange', warm)
  void sw.ready.then(warm).catch(() => {})
}
