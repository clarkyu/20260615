'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, GraduationCap, RefreshCw } from 'lucide-react'
import { getGradingProgress } from '@/actions/submissions'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import type { GradingStage } from '@/lib/domain/grading-progress'

// 评阅进度条(重构A):提交完成后,把队列状态翻译成学生能看懂的进度——
// 排队中 → AI 评阅中 → (出分自动刷新) / 本次由老师评阅。
//
// 在途阶段每 10 秒轮询一次(轻读:三个字段),评出分(done)就 router.refresh() 让
// 服务端重渲出分数面板;老师评(teacher)是学生侧终态,不轮询。轮询 5 分钟(30 次)
// 还没出分就停手,换成「稍后回来看 + 手动刷新」——省电省流量,也别让学生干等。
const POLL_MS = 10_000
const MAX_POLLS = 30

export function GradingProgress({ submissionId, initialStage }: { submissionId: number; initialStage: GradingStage }) {
  const t = useT()
  const router = useRouter()
  const [stage, setStage] = useState<GradingStage>(initialStage)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (stage !== 'queued' && stage !== 'running') return
    let active = true
    let polls = 0
    const id = setInterval(async () => {
      polls += 1
      if (polls > MAX_POLLS) {
        clearInterval(id)
        if (active) setExpired(true)
        return
      }
      try {
        const r = await getGradingProgress(submissionId)
        if (!active) return
        if (r.stage === 'done') {
          clearInterval(id)
          router.refresh() // 服务端重渲染:分数/逐句反馈整块出现
          return
        }
        if (r.stage === 'none') { clearInterval(id); setExpired(true); return }
        setStage(r.stage)
      } catch {
        // 网络抖动:这一轮作废,下一轮再试。
      }
    }, POLL_MS)
    return () => { active = false; clearInterval(id) }
  }, [stage, submissionId, router])

  if (stage === 'done' || stage === 'none') return null

  if (stage === 'teacher') {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-secondary p-3 text-sm">
        <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">{t('sub.gradeTeacher')}</p>
      </div>
    )
  }

  return (
    <div role="status" aria-live="polite" className="space-y-2 rounded-xl bg-secondary p-3 text-sm">
      <p className="flex items-center gap-2 text-muted-foreground">
        {expired ? null : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
        {expired ? t('sub.gradeCheckLater') : stage === 'queued' ? t('sub.gradeQueued') : t('sub.gradeRunning')}
      </p>
      {expired ? (
        <Button variant="outline" size="sm" className="w-full" onClick={() => router.refresh()}>
          <RefreshCw className="h-3.5 w-3.5" />{t('sub.gradeRefresh')}
        </Button>
      ) : null}
    </div>
  )
}
