'use client'

// 判分反馈卡(SPEC §7.5):对错、得分、参考答案(多答案全列)、解析、常见错答;AI 判的主观题另有中文评语。
// verdict 取值:correct / wrong / too_many_words / empty(客观题);graded(AI 已判);
// pending(AI 评分中)/ needs_review(待老师评)/ pending_timeout(轮询超时,稍后看成绩页)/ error。
export function FeedbackCard({
  verdict,
  score,
  fullScore,
  accepted,
  explanation,
  feedback,
  commonMistakes,
}: {
  verdict: string
  score: number
  fullScore: number
  accepted: string[]
  explanation: string | null
  feedback?: string | null
  commonMistakes?: string[]
}) {
  const aiGraded = verdict === 'graded'
  const ok = verdict === 'correct' || (aiGraded && fullScore > 0 && score >= fullScore)
  const waiting = verdict === 'pending' || verdict === 'needs_review' || verdict === 'pending_timeout'
  const label = ok
    ? '答对了'
    : verdict === 'too_many_words'
      ? '超出词数'
      : verdict === 'empty'
        ? '未作答'
        : verdict === 'pending'
          ? 'AI 评分中'
          : verdict === 'needs_review'
            ? '待老师评分'
            : verdict === 'pending_timeout'
              ? 'AI 还没评完，回头再点一次「对答案」看结果'
              : verdict === 'error'
                ? '题目数据异常'
                : aiGraded && score > 0
                  ? '部分得分'
                  : '再想想'
  return (
    <div
      className={`mt-2 rounded-xl border p-3 text-sm ${
        ok
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950'
          : waiting
            ? 'border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900'
            : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950'
      }`}
    >
      <p className="font-semibold">
        {label}
        {waiting || verdict === 'error' ? null : (
          <span className="font-normal text-neutral-500">
            {' '}
            {score} / {fullScore} 分
          </span>
        )}
      </p>
      {feedback ? <p className="mt-1">评语：{feedback}</p> : null}
      {accepted.length > 0 ? (
        <p className="mt-1">
          参考答案：<span className="font-medium">{accepted.join(' / ')}</span>
        </p>
      ) : null}
      {explanation ? <p className="mt-1 text-neutral-600 dark:text-neutral-300">解析：{explanation}</p> : null}
      {commonMistakes && commonMistakes.length > 0 ? (
        <p className="mt-1 text-neutral-500">常见错答：{commonMistakes.join(' / ')}</p>
      ) : null}
    </div>
  )
}
