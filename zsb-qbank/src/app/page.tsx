// 学生端首页壳(M0):单列、可点击元素 ≥44px。任务列表在 M2 接入。
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-bold">专升本英语题库</h1>
      <p className="text-neutral-500">从微信群链接进来就能做题:作答、训练、模考。</p>
      <div className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="font-medium">还没有任务</p>
        <p className="mt-1 text-sm text-neutral-500">等老师发布任务后,这里会出现你的作答入口。</p>
      </div>
    </main>
  )
}
