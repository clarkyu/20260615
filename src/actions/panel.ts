'use server'

import { redirect } from 'next/navigation'
import { getCurrentUser, availablePanels } from '@/lib/auth'
import { getSession } from '@/lib/session'

// Switch which role-panel the staff member is viewing. A focus preference only —
// validated against the panels their actual role permits, never an escalation.
export async function setActivePanel(formData: FormData): Promise<void> {
  const user = await getCurrentUser()
  if (!user) return
  const wanted = String(formData.get('role'))
  const target = availablePanels(user.role, user.schoolId).find((r) => r === wanted)
  if (!target) return
  const session = await getSession()
  session.activeRole = target
  await session.save()
  redirect('/dashboard')
}
