'use client'

import { useActionState, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, UserPlus } from 'lucide-react'
import {
  updateClass,
  deleteClass,
  addStudent,
  updateStudent,
  removeStudentFromClass,
  resetStudentPassword,
} from '@/actions/students'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useConfirm, confirmSubmit } from '@/components/ui/confirm'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Student {
  id: number
  studentNo: string
  name: string
  phone: string
  email: string
}
interface Cls {
  id: number
  name: string
  majorId: number | null
  major: string
  department: string
  grade: string
}
interface MajorOpt {
  id: number
  name: string
  department: string
}

type Action = (fd: FormData) => Promise<{ error?: string; success?: boolean }>

export function ClassManager({
  cls,
  students,
  majors,
  isAdmin,
  deleteImpact,
}: {
  cls: Cls
  students: Student[]
  majors: MajorOpt[]
  isAdmin: boolean
  // What deleting this class would cascade-destroy (null for non-admins).
  deleteImpact: { offerings: number; assignments: number; submissions: number } | null
}) {
  const t = useT()
  const confirm = useConfirm()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editId, setEditId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [classState, classAction, classPending] = useActionState(updateClass, null)
  const [addState, addAction, addPending] = useActionState(addStudent, null)

  function run(fn: Action, fd: FormData, id: number) {
    setError(null)
    setBusyId(id)
    start(async () => {
      const res = await fn(fd)
      setBusyId(null)
      if (res?.error) setError(res.error)
      else {
        setEditId(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      <Link href="/dashboard/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />
        {t('nav.students')}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>{isAdmin ? t('cls.manage') : cls.name}</CardTitle>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <form action={classAction} className="space-y-3">
              <input type="hidden" name="classId" value={cls.id} />
              <div className="space-y-1.5">
                <Label htmlFor="cn">{t('cls.className')}</Label>
                <Input id="cn" name="name" required defaultValue={cls.name} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="grd">{t('cls.grade')}</Label>
                  <Input id="grd" name="grade" defaultValue={cls.grade} placeholder="2025" inputMode="numeric" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="maj">{t('cls.major')}</Label>
                  <Select id="maj" name="majorId" defaultValue={cls.majorId ?? ''} className="h-10">
                    <option value="">{t('cls.noMajor')}</option>
                    {majors.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}（{m.department}）</option>
                    ))}
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('cls.majorHint')}</p>
              {classState?.error ? <FormMessage>{classState.error}</FormMessage> : null}
              {classState?.success ? <FormMessage tone="success">{t('done')}</FormMessage> : null}
              <Button type="submit" disabled={classPending}>{t('cls.save')}</Button>
            </form>
          ) : (
            <div className="space-y-1 text-sm text-muted-foreground">
              {cls.grade ? <div>{t('cls.grade')}：{cls.grade}</div> : null}
              {cls.major ? <div>{t('cls.major')}：{cls.major}（{cls.department}）</div> : null}
            </div>
          )}
        </CardContent>
      </Card>

      {error ? <FormMessage>{error}</FormMessage> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('cls.students')}（{students.length}）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('cls.empty')}</p>
          ) : (
            students.map((s) => (
              <div key={s.id} className="rounded-xl border border-border/70 p-3 text-sm">
                {editId === s.id ? (
                  <StudentEdit
                    s={s}
                    currentClassId={cls.id}
                    disabled={pending}
                    t={t}
                    onCancel={() => setEditId(null)}
                    onSave={(fd) => run(updateStudent, fd, s.id)}
                  />
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.studentNo}{s.phone ? ` · ${s.phone}` : ''}</div>
                    </div>
                    {isAdmin ? (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setEditId(s.id)}>{t('cls.edit')}</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending && busyId === s.id}
                          onClick={async () => {
                            if (!(await confirm({ body: t('cls.resetPwConfirm') }))) return
                            const fd = new FormData()
                            fd.set('studentId', String(s.id))
                            run(resetStudentPassword, fd, s.id)
                          }}
                        >
                          {t('cls.resetPw')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={pending && busyId === s.id}
                          onClick={async () => {
                            if (!(await confirm({ body: t('cls.removeConfirm'), danger: true }))) return
                            const fd = new FormData()
                            fd.set('studentId', String(s.id))
                            fd.set('classId', String(cls.id))
                            run(removeStudentFromClass, fd, s.id)
                          }}
                        >
                          {t('cls.removeFromClass')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('cls.addStudent')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addAction} className="space-y-3">
            <input type="hidden" name="classId" value={cls.id} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="asno">{t('cls.studentNo')}</Label>
                <Input id="asno" name="studentNo" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asnm">{t('cls.name')}</Label>
                <Input id="asnm" name="name" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="asphone">{t('cls.phone')}</Label>
                <Input id="asphone" name="phone" inputMode="tel" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asemail">{t('email')}</Label>
                <Input id="asemail" name="email" type="email" />
              </div>
            </div>
            {addState?.error ? <FormMessage>{addState.error}</FormMessage> : null}
            {addState?.success ? <FormMessage tone="success">{t('done')}</FormMessage> : null}
            <Button type="submit" disabled={addPending} className="w-full">
              <UserPlus className="h-4 w-4" />
              {t('cls.addStudent')}
            </Button>
          </form>
        </CardContent>
      </Card>
      ) : null}

      {isAdmin ? (
      <Card className="border-destructive/40">
        <CardContent className="p-4">
          <form action={deleteClass} onSubmit={confirmSubmit(confirm, {
            // Surface the true cascade (授课/作业/已提交) so an admin can't accidentally wipe
            // a semester of graded work; fall back to the simple confirm for an empty class.
            body: deleteImpact && (deleteImpact.offerings > 0 || deleteImpact.assignments > 0 || deleteImpact.submissions > 0)
              ? t('cls.deleteClassImpact', { offerings: deleteImpact.offerings, assignments: deleteImpact.assignments, submissions: deleteImpact.submissions })
              : t('cls.deleteClassConfirm'),
            danger: true,
          })}>
            <input type="hidden" name="classId" value={cls.id} />
            <SubmitButton variant="destructive" className="w-full">{t('cls.deleteClass')}</SubmitButton>
          </form>
        </CardContent>
      </Card>
      ) : null}
    </div>
  )
}

function StudentEdit({
  s,
  currentClassId,
  disabled,
  t,
  onCancel,
  onSave,
}: {
  s: Student
  currentClassId: number
  disabled: boolean
  t: (k: string) => string
  onCancel: () => void
  onSave: (fd: FormData) => void
}) {
  const [name, setName] = useState(s.name)
  const [no, setNo] = useState(s.studentNo)
  const [phone, setPhone] = useState(s.phone)
  const [email, setEmail] = useState(s.email)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input value={no} onChange={(e) => setNo(e.target.value)} placeholder={t('cls.studentNo')} aria-label={t('cls.studentNo')} className="h-10" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('cls.name')} aria-label={t('cls.name')} className="h-10" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('cls.phone')} aria-label={t('cls.phone')} inputMode="tel" className="h-10" />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email')} aria-label={t('email')} type="email" className="h-10" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={onCancel}>{t('back')}</Button>
        <Button
          size="sm"
          className="flex-1"
          disabled={disabled}
          onClick={() => {
            const fd = new FormData()
            fd.set('studentId', String(s.id))
            fd.set('name', name)
            fd.set('studentNo', no)
            fd.set('phone', phone)
            fd.set('email', email)
            fd.set('classId', String(currentClassId))
            onSave(fd)
          }}
        >
          {t('cls.save')}
        </Button>
      </div>
    </div>
  )
}
