// 后台工作线程(SPEC §9.1 单进程轮询;§9.5 逾期清扫;§5.3 AI 评分队列)。
// Next.js instrumentation:服务启动后
//   · 每 2 秒消费 ai_jobs(评分 / 解析):每轮领取 ≤ AI_BATCH 条、以 AI_CONCURRENCY 并发执行,
//     同一进程不重入;AI 未配置也照常跑——把任务分流为「待老师评」,学生端不会无限等待
//   · 每 60 秒把逾期未交的考试自动交卷(不重入;GET attempt / result 的惰性交卷是兜底)
// 仅在 Node 运行时注册,构建期与测试不启动。日志只记条数与 token 数,不记学生信息。
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (!process.env.DATABASE_URL) return
  const { getDb } = await import('@/lib/db/client')
  const { sweepOverdueExams } = await import('@/lib/db/submit')
  const { processAiJobs } = await import('@/lib/db/ai-jobs')
  const { getAiConfig, getDefaultAiCaller } = await import('@/lib/ai/client')

  const cfg = getAiConfig()
  if (!cfg) console.warn('[ai] 未配置 AI_BASE_URL / AI_API_KEY / AI_MODEL_GRADING:主观题将分流为待老师评')
  const models = { gradingModel: cfg?.gradingModel ?? '', authoringModel: cfg?.authoringModel ?? '' }
  const batch = Number(process.env.AI_BATCH ?? '') || 8
  const concurrency = Number(process.env.AI_CONCURRENCY ?? '') || 4

  let jobsBusy = false
  const jobTimer = setInterval(() => {
    if (jobsBusy) return
    jobsBusy = true
    void (async () => {
      try {
        const stat = await processAiJobs(getDb(), getDefaultAiCaller(), models, { max: batch, concurrency })
        if (stat.done + stat.failed + stat.retry > 0) console.log(`[ai] 队列一轮:done=${stat.done} failed=${stat.failed} retry=${stat.retry}`)
      } catch (e) {
        console.error('[ai] 队列处理失败(下轮重试):', e instanceof Error ? e.message : e)
      } finally {
        jobsBusy = false
      }
    })()
  }, 2_000)
  jobTimer.unref?.()

  let sweepBusy = false
  const sweepTimer = setInterval(() => {
    if (sweepBusy) return
    sweepBusy = true
    void (async () => {
      try {
        const n = await sweepOverdueExams(getDb())
        if (n > 0) console.log(`[sweep] 自动交卷 ${n} 份逾期考试`)
      } catch (e) {
        console.error('[sweep] 清扫失败(下轮重试):', e instanceof Error ? e.message : e)
      } finally {
        sweepBusy = false
      }
    })()
  }, 60_000)
  sweepTimer.unref?.()
}
