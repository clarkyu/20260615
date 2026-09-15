import Link from 'next/link'

// 断网兜底页(Service Worker 的 fallback)。必须是纯静态:它会被预缓存,
// 不能读会话、不能查库,否则断网时根本渲染不出来,也会把个人信息带进缓存。
export const dynamic = 'force-static'

export const metadata = { title: '现在连不上网' }

export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col justify-center gap-4 px-6 py-10">
      <h1 className="text-xl font-bold">现在连不上网</h1>
      <p className="text-neutral-600 dark:text-neutral-300">
        你已经做过的题都存在这台手机上了，不会丢。等有网了自动补传，不用重做。
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-neutral-500">
        <li>正在考试的话，可以直接回作答页接着做。</li>
        <li>换个地方或连上 Wi-Fi 再试一次。</li>
      </ul>
      <div className="mt-2 flex flex-col gap-2">
        <Link href="/" className="min-h-11 inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 font-medium text-white">
          重新试一次
        </Link>
      </div>
    </main>
  )
}
