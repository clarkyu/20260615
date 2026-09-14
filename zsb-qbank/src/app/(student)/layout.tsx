// 学生端全局骨架:单列、100dvh、无横向滚动(SPEC §7.1;硬约束 5)。首页 / 作答页 / 成绩页共用。
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">{children}</div>
}
