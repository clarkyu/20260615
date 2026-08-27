'use client'

// 判分反馈卡(SPEC §7.5):对错、得分、参考答案(多答案全列)、解析。
export function FeedbackCard({
  verdict,
  score,
  fullScore,
  accepted,
  explanation,
}: {
  verdict: string
  score: number
  fullScore: number
  accepted: string[]
  explanation: string | null
}) {
  const ok = verdict === 'correct'
  const label = ok ? '答对了' : verdict === 'too_many_words' ? '超出词数' : verdict === 'empty' ? '未作答' : verdict === 'pending' ? 'AI 评分中' : '再想想'
  return (
    <div
      className={`mt-2 rounded-xl border p-3 text-sm ${
        ok
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950'
          : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950'
      }`}
    >
      <p className="font-semibold">
        {label} <span className="font-normal text-neutral-500">{score} / {fullScore} 分</span>
      </p>
      {accepted.length > 0 ? (
        <p className="mt-1">
          参考答案:<span className="font-medium">{accepted.join(' / ')}</span>
        </p>
      ) : null}
      {explanation ? <p className="mt-1 text-neutral-600 dark:text-neutral-300">解析:{explanation}</p> : null}
    </div>
  )
}
