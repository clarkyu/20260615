import type { Role } from '@prisma/client'
import { getT } from '@/lib/i18n-server'
import { setActivePanel } from '@/actions/panel'
import { cn } from '@/lib/utils'

// Segmented control to switch the active role-panel (e.g. a school admin viewing the
//「校管（全校）」panel vs. the「教师（我的授课）」panel). Only rendered when the user
// has more than one panel available.
export async function PanelSwitcher({ panels, active }: { panels: Role[]; active: Role }) {
  const { t } = await getT()
  return (
    <div className="flex gap-1 rounded-lg bg-secondary p-1">
      {panels.map((r) => (
        <form key={r} action={setActivePanel} className="flex-1">
          <input type="hidden" name="role" value={r} />
          <button
            type="submit"
            aria-current={r === active ? 'true' : undefined}
            className={cn(
              'tap w-full rounded-xl px-2 py-2 text-xs font-semibold transition-colors',
              r === active ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('panel.' + r)}
          </button>
        </form>
      ))}
    </div>
  )
}
