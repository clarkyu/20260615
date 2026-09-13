// 逾期考试清扫线程(SPEC §9.5:逾期未交由工作线程自动提交)。
// Next.js instrumentation:服务启动后每 60 秒扫一遍逾期未交的考试并自动交卷;
// GET attempt / result 的惰性交卷是兜底,双保险。仅在 Node 运行时注册,
// 构建期与测试不启动。日志只记条数,不记学生信息。
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (!process.env.DATABASE_URL) return
  const { getDb } = await import('@/lib/db/client')
  const { sweepOverdueExams } = await import('@/lib/db/submit')
  const timer = setInterval(() => {
    void (async () => {
      try {
        const n = await sweepOverdueExams(getDb())
        if (n > 0) console.log(`[sweep] 自动交卷 ${n} 份逾期考试`)
      } catch (e) {
        console.error('[sweep] 清扫失败(下轮重试):', e instanceof Error ? e.message : e)
      }
    })()
  }, 60_000)
  timer.unref?.()
}
