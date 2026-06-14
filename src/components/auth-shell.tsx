import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Centered card wrapper shared by all of the auth screens.
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
        {footer ? <div className="px-6 pb-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </Card>
    </div>
  )
}
