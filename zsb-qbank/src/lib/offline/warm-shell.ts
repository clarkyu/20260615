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
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return
  if (!navigator.onLine) return
  // 只预热当前这一页;失败就算了,这只是个锦上添花的优化。
  void fetch(window.location.pathname, { credentials: 'same-origin' }).catch(() => {})
}
