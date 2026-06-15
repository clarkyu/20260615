import { Card, CardContent } from '@/components/ui/card'

export function AuthShell({
  icon,
  title,
  description,
  children,
  footer,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="flex min-h-[76vh] flex-col items-center justify-center py-4">
      <Card className="w-full max-w-md overflow-hidden">
        <CardContent className="space-y-5 p-6 pt-7">
          <div className="space-y-2 text-center">
            {icon ? (
              <div className="mx-auto mb-1 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
                {icon}
              </div>
            ) : null}
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {children}
        </CardContent>
        {footer ? (
          <div className="border-t border-border/60 bg-secondary/40 px-6 py-4 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
