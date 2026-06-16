'use client'

import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/button'

// A submit button that disables itself while its form's server action is pending,
// so a double-click / double-tap can't fire the (often destructive) action twice.
// Drop it in place of <Button type="submit"> inside a <form action={...}>.
export function SubmitButton({ disabled, ...props }: ButtonProps) {
  const { pending } = useFormStatus()
  return <Button {...props} type="submit" disabled={pending || disabled} />
}
