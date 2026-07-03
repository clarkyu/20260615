import * as React from 'react'

import { cn } from '@/lib/utils'

// 原生 <select> 的统一封装：与 Input 一致的边框/圆角/焦点环（此前各处复制了同一串
// className，现归一到这里）。默认 h-11 w-full；需要别的高度/宽度用 className 覆盖
// （cn = tailwind-merge，后者覆盖前者）。
const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Select.displayName = 'Select'

export { Select }
