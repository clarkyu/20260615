'use client'

import { useActionState, useMemo, useState } from 'react'
import { GitMerge } from 'lucide-react'
import { mergeAssignmentBatches } from '@/actions/assignments'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

export interface MergeCandidate {
  key: string
  title: string
  courseId: number
  courseName: string
  classNames: string[]
  assignmentIds: number[]
}

// 预填统一标题:选中各卡标题的最长公共前缀,去掉结尾的分隔符/空白(「期末考核：一班」
// ×8 → 「期末考核」)。空前缀(标题完全不同)→ 不预填,老师自己起名。
function commonTitlePrefix(titles: string[]): string {
  if (titles.length === 0) return ''
  let p = titles[0]
  for (const t of titles.slice(1)) {
    let i = 0
    while (i < p.length && i < t.length && p[i] === t[i]) i++
    p = p.slice(0, i)
  }
  return p.replace(/[\s:：\-—–·、]+$/u, '').trim()
}

export function MergeForm({ groups }: { groups: MergeCandidate[] }) {
  const t = useT()
  const [state, action, pending] = useActionState(mergeAssignmentBatches, null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)

  const chosen = groups.filter((g) => selected.has(g.key))
  // 只能归并同一课程:一旦选了某课程的卡,其它课程的卡禁用。
  const lockedCourseId = chosen[0]?.courseId ?? null

  function toggle(g: MergeCandidate) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(g.key)) next.delete(g.key)
      else next.add(g.key)
      // 老师没手动改过标题时,跟着当前选择重算预填。
      if (!titleTouched) setTitle(commonTitlePrefix(groups.filter((x) => next.has(x.key)).map((x) => x.title)))
      return next
    })
  }

  // 按课程分节展示,禁用态一目了然。节的身份是 courseId——课程名可以重名
  // (两个「英语」),React key 不能用它(复查 R13)。
  const byCourse = useMemo(() => {
    const m = new Map<number, { courseId: number; courseName: string; items: MergeCandidate[] }>()
    for (const g of groups) {
      const e = m.get(g.courseId) ?? { courseId: g.courseId, courseName: g.courseName, items: [] }
      e.items.push(g)
      m.set(g.courseId, e)
    }
    return [...m.values()]
  }, [groups])

  const totalSelected = chosen.reduce((n, g) => n + g.assignmentIds.length, 0)

  return (
    <form action={action} className="space-y-4">
      <p className="px-1 text-xs text-muted-foreground">{t('merge.pickHint')}</p>

      {byCourse.map((course) => (
        <section key={course.courseId} className="space-y-2">
          {byCourse.length > 1 ? <h2 className="px-1 text-sm font-semibold text-muted-foreground">{course.courseName}</h2> : null}
          {course.items.map((g) => {
            const disabled = lockedCourseId != null && g.courseId !== lockedCourseId
            return (
              <label
                key={g.key}
                className={
                  'tap flex cursor-pointer items-center gap-3 rounded-2xl border border-input bg-card p-4 has-[:checked]:border-primary has-[:checked]:bg-accent' +
                  (disabled ? ' cursor-not-allowed opacity-40' : '')
                }
              >
                <input
                  type="checkbox"
                  checked={selected.has(g.key)}
                  disabled={disabled}
                  onChange={() => toggle(g)}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{g.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {g.courseName} · {g.classNames.length > 1 ? t('asgList.classesN', { n: g.classNames.length }) : g.classNames[0]}
                  </span>
                </span>
              </label>
            )
          })}
        </section>
      ))}

      {/* 每张选中的卡带上它的成员作业 id(逗号分隔),服务端展平。 */}
      {chosen.map((g) => (
        <input key={g.key} type="hidden" name="assignmentIds" value={g.assignmentIds.join(',')} />
      ))}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="merge-title">{t('merge.titleLabel')}</Label>
            <Input
              id="merge-title"
              name="title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }}
              placeholder={t('merge.titlePh')}
            />
          </div>
          {state?.error ? <FormMessage>{state.error}</FormMessage> : null}
          <Button type="submit" size="lg" className="w-full" disabled={pending || chosen.length < 2}>
            <GitMerge className="h-4 w-4" />
            {pending ? t('merge.merging') : t('merge.submit')}
            {totalSelected > 0 && !pending ? <span className="ml-1 text-xs font-normal opacity-80">（{t('merge.selectedN', { n: totalSelected })}）</span> : null}
          </Button>
        </CardContent>
      </Card>
    </form>
  )
}
