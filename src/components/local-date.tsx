'use client'

// Renders a UTC instant as a YYYY-MM-DD date in the BROWSER's local timezone, so a
// due date reads as the teacher/student's own calendar day (not the server's UTC day).
// suppressHydrationWarning: the server (UTC) and client (local) can differ by a day.
export function LocalDate({ iso }: { iso: string }) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return <span suppressHydrationWarning>{`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`}</span>
}
