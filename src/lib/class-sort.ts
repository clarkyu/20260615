// 班级排序统一口径(clark 2026-07-12 定):凡一次列出多个班,一律按班级序号**升序**。
// numeric 比较让 "2531321" < "2531327" 按数值走,"9班" < "10班" 也正确;
// 非数字班名退化为中文本地化字典序。所有列班的界面共用这一个比较器,别各排各的。
export function compareClassName(a: string, b: string): number {
  return a.localeCompare(b, 'zh-CN', { numeric: true })
}

// 返回新数组(不改原引用),name 提取器把任意行形映射到班名。
export function sortByClassName<T>(rows: readonly T[], name: (row: T) => string): T[] {
  return [...rows].sort((x, y) => compareClassName(name(x), name(y)))
}
