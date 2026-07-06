'use client'

import { Trash2 } from 'lucide-react'
import { useT } from '@/components/i18n-provider'
import { useConfirm, confirmSubmit } from '@/components/ui/confirm'
import { SubmitButton } from '@/components/submit-button'
import { deleteDepartment, deleteMajor } from '@/actions/students'

export interface DeptItem { id: number; name: string; majors: number; teachers: number }
export interface MajorItem { id: number; name: string; department: string | null; classes: number }

// 院系/专业管理（管理员）。院系/专业目前只由名单导入自动创建，这里让管理员清理导入错/已空的。
// 只对「空的」（院系无专业无教师、专业无班级）开放删除——因为子表外键是 SET NULL，删非空的会
// 悄悄把在用班级/教师的院系专业标签抹掉。非空的只显示占用计数，不给删。
export function StructureManager({ departments, majors }: { departments: DeptItem[]; majors: MajorItem[] }) {
  const t = useT()
  const confirm = useConfirm()

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t('stu.departments')}（{departments.length}）</h3>
        {departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('stu.noDepartments')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {departments.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate">{d.name}</span>
                {d.majors + d.teachers > 0 ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{t('stu.deptInUse', { majors: d.majors, teachers: d.teachers })}</span>
                ) : (
                  <form action={deleteDepartment} onSubmit={confirmSubmit(confirm, { body: t('stu.deleteDeptConfirm', { name: d.name }), danger: true })}>
                    <input type="hidden" name="id" value={d.id} />
                    <SubmitButton variant="ghost" className="h-8 w-8 p-0 text-destructive" aria-label={t('stu.deleteDept')}><Trash2 className="h-4 w-4" /></SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t('stu.majors')}（{majors.length}）</h3>
        {majors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('stu.noMajors')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {majors.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate">{m.name}{m.department ? <span className="text-muted-foreground"> · {m.department}</span> : null}</span>
                {m.classes > 0 ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{t('stu.majorInUse', { classes: m.classes })}</span>
                ) : (
                  <form action={deleteMajor} onSubmit={confirmSubmit(confirm, { body: t('stu.deleteMajorConfirm', { name: m.name }), danger: true })}>
                    <input type="hidden" name="id" value={m.id} />
                    <SubmitButton variant="ghost" className="h-8 w-8 p-0 text-destructive" aria-label={t('stu.deleteMajor')}><Trash2 className="h-4 w-4" /></SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
