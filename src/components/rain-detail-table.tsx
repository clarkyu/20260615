import { getT } from '@/lib/i18n-server'
import type { RainSession, RainStudentDetail } from '@/lib/rain-classroom'

// 单个学生的逐节原始信号表(服务端组件,老师端明细/学生端「我的课堂记录」共用)。
// 口径提示:重开课不计次(整行淡显);答题列只在该节有题时显示 √/×,无题为「—」。
export async function RainDetailTable({ sessions, detail }: { sessions: RainSession[]; detail: RainStudentDetail[] }) {
  const { t } = await getT()
  const ZERO: RainStudentDetail = { attended: false, danmaku: 0, posts: 0, answered: false }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="max-h-80 overflow-auto text-sm">
        <table className="w-full">
          <thead className="sticky top-0 bg-secondary text-left text-xs">
            <tr>
              <th className="px-3 py-2">{t('rainview.colSession')}</th>
              <th className="px-3 py-2">{t('rainview.colAttend')}</th>
              <th className="px-3 py-2">{t('rainview.colDanmaku')}</th>
              <th className="px-3 py-2">{t('rainview.colPosts')}</th>
              <th className="px-3 py-2">{t('rainview.colAnswer')}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, i) => {
              const d = detail[i] ?? ZERO
              return (
                <tr key={i} className={`border-t border-border/50 ${s.counted ? '' : 'opacity-50'}`}>
                  <td className="max-w-52 truncate px-3 py-1.5" title={s.label}>
                    {s.date ?? s.label}
                    {!s.counted && <span className="ml-1 text-xs text-muted-foreground">({t('rainview.notCounted')})</span>}
                  </td>
                  <td className="px-3 py-1.5">{d.attended ? '✓' : <span className="text-destructive">✗</span>}</td>
                  <td className="px-3 py-1.5 tabular-nums">{s.danmakuOpen ? d.danmaku : '—'}</td>
                  <td className="px-3 py-1.5 tabular-nums">{s.postOpen ? d.posts : '—'}</td>
                  <td className="px-3 py-1.5">{s.questions > 0 ? (d.answered ? '✓' : <span className="text-destructive">✗</span>) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
