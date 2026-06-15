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
  deleteStudent,
  resetStudentPassword,
} from '@/actions/students'
import { useT } from '@/components/i18n-provider'
import { FormMessage } from '@/components/form-message'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Student {
  id: number
  studentNo: string
  name: string
  major: string
}
interface Cls {
  id: number
  name: string
  major: string
  department: string
  grade: string
}

type Action = (fd: FormData) => Promise<{ error?: string; success?: boolean }>
const SELECT = 'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm'

export function ClassManager({
  cls,
  students,
  allClasses,
}: {
  cls: Cls
  students: Student[]
  allClasses: { id: number; name: string }[]
}) {
  const t = useT()
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
          <CardTitle>{t('cls.manage')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={classAction} className="space-y-3">
            <input type="hidden" name="classId" value={cls.id} />
            <div className="space-y-1.5">
              <Label htmlFor="cn">{t('cls.className')}</Label>
              <Input id="cn" name="name" required defaultValue={cls.name} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="grd">{t('cls.grade')}</Label>
                <Input id="grd" name="grade" defaultValue={cls.grade} placeholder="2025" inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maj">{t('cls.major')}</Label>
                <Input id="maj" name="major" defaultValue={cls.major} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dep">{t('cls.dept')}</Label>
                <Input id="dep" name="department" defaultValue={cls.department} />
              </div>
            </div>
            {classState?.error ? <FormMessage>{classState.error}</FormMessage> : null}
            {classState?.success ? <FormMessage tone="success">{t('done')}</FormMessage> : null}
            <Button type="submit" disabled={classPending}>{t('cls.save')}</Button>
          </form>
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
                    allClasses={allClasses}
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
                      <div className="text-xs text-muted-foreground">{s.studentNo}{s.major ? ` · ${s.major}` : ''}</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditId(s.id)}>{t('cls.edit')}</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending && busyId === s.id}
                        onClick={() => {
                          if (!confirm(t('cls.resetPwConfirm'))) return
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
                        onClick={() => {
                          if (!confirm(t('cls.delConfirm'))) return
                          const fd = new FormData()
                          fd.set('studentId', String(s.id))
                          run(deleteStudent, fd, s.id)
                        }}
                      >
                        {t('cls.del')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

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
            <div className="space-y-1.5">
              <Label htmlFor="asmaj">{t('cls.major')}</Label>
              <Input id="asmaj" name="major" defaultValue={cls.major} />
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

      <Card className="border-destructive/40">
        <CardContent className="p-4">
          <form action={deleteClass} onSubmit={(e) => { if (!confirm(t('cls.deleteClassConfirm'))) e.preventDefault() }}>
            <input type="hidden" name="classId" value={cls.id} />
            <Button type="submit" variant="destructive" className="w-full">{t('cls.deleteClass')}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function StudentEdit({
  s,
  allClasses,
  currentClassId,
  disabled,
  t,
  onCancel,
  onSave,
}: {
  s: Student
  allClasses: { id: number; name: string }[]
  currentClassId: number
  disabled: boolean
  t: (k: string) => string
  onCancel: () => void
  onSave: (fd: FormData) => void
}) {
  const [name, setName] = useState(s.name)
  const [no, setNo] = useState(s.studentNo)
  const [major, setMajor] = useState(s.major)
  const [classId, setClassId] = useState(currentClassId)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input value={no} onChange={(e) => setNo(e.target.value)} placeholder={t('cls.studentNo')} className="h-10" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('cls.name')} className="h-10" />
      </div>
      <Input value={major} onChange={(e) => setMajor(e.target.value)} placeholder={t('cls.major')} className="h-10" />
      <select value={classId} onChange={(e) => setClassId(Number(e.target.value))} className={SELECT}>
        {allClasses.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
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
            fd.set('major', major)
            fd.set('classId', String(classId))
            onSave(fd)
          }}
        >
          {t('cls.save')}
        </Button>
      </div>
    </div>
  )
}
