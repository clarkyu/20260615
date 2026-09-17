#!/usr/bin/env bash
# 恢复演练(SPEC §10 M7 验收:「备份脚本可恢复到空库」)。
#
# 为什么要有这个脚本:backup.sh 与 restore.sh 从 M7 写出来到 2026-09-17 为止,**一次都没被跑过** ——
# 没有测试、CI 不碰、历次预演也没走。一个存着全班成绩的系统,备份恢复不了是最坏的那种静默失败:
# 定时任务每天照常产出 .dump,谁也不知道它到底能不能用,直到真出事那天。
#
# 这个脚本跑的是**真正的那两个脚本**(不是等效命令):
#   backup.sh → 建一个临时空库 → restore.sh → **逐表比对行数** → 删掉临时库。
# 任何一张表对不上就非零退出。
#
# 用法:
#   scripts/verify-restore.sh                 # 读 .env 的 DATABASE_URL
#   DATABASE_URL=postgres://... scripts/verify-restore.sh
#
# 需要目标库所在实例上有 CREATEDB 权限(脚本自己建、自己删临时库,绝不碰源库)。
set -euo pipefail

cd "$(dirname "$0")/.."
# 与 backup.sh 同样的口径读 .env,免得演练用的连接串和它实际 dump 的库不是同一个。
[ -f .env ] && set -a && . ./.env && set +a

SRC_URL="${DATABASE_URL:?DATABASE_URL 未设置(.env 或环境变量)}"

# 拆连接串:…/<库名>[?参数]
base="${SRC_URL%%\?*}"
query=""
[ "$base" != "$SRC_URL" ] && query="?${SRC_URL#*\?}"
SRC_DB="${base##*/}"
PREFIX="${base%/*}"
TARGET_DB="${SRC_DB}_restore_check"
TARGET_URL="${PREFIX}/${TARGET_DB}${query}"
ADMIN_URL="${PREFIX}/postgres${query}"

# 绝不把恢复灌回源库。
[ "$TARGET_DB" != "$SRC_DB" ] || { echo "拒绝:临时库名与源库同名($SRC_DB)" >&2; exit 1; }

WORK="$(mktemp -d)"
cleanup() {
  psql --dbname="$ADMIN_URL" -q -c "drop database if exists \"$TARGET_DB\"" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# 一条 SQL 数完所有表(新加的表自动纳入演练,不用回来改这个脚本)。
counts() {
  psql --dbname="$1" -At -F'|' -v ON_ERROR_STOP=1 -c "
    select table_schema || '.' || table_name,
           (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
    from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
    order by 1"
}

echo "[演练] 源库 ${SRC_DB};临时库 ${TARGET_DB}"

counts "$SRC_URL" > "$WORK/before.txt"
TABLES="$(wc -l < "$WORK/before.txt" | tr -d ' ')"
ROWS="$(awk -F'|' '{s+=$2} END {print s+0}' "$WORK/before.txt")"

# 空库比空库永远相等 —— 那样的「通过」什么也没证明。先要求源库里确实有东西。
[ "$TABLES" -ge 5 ] || { echo "拒绝:源库只有 $TABLES 张表,先跑 pnpm db:migrate" >&2; exit 1; }
[ "$ROWS" -gt 0 ] || { echo "拒绝:源库一行数据都没有,先跑 pnpm seed(空库比空库证明不了什么)" >&2; exit 1; }
echo "[演练] 源库 $TABLES 张表、共 $ROWS 行"

BACKUP_DIR="$WORK/backups" ./scripts/backup.sh
DUMP="$(ls -1 "$WORK"/backups/zsb-*.dump | tail -1)"

psql --dbname="$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists \"$TARGET_DB\"" \
  -c "create database \"$TARGET_DB\""

./scripts/restore.sh "$DUMP" "$TARGET_URL"

counts "$TARGET_URL" > "$WORK/after.txt"
if ! diff -u "$WORK/before.txt" "$WORK/after.txt" > "$WORK/diff.txt"; then
  echo "[演练] ✗ 恢复出来的库和源库对不上(左 源库 / 右 恢复库):" >&2
  cat "$WORK/diff.txt" >&2
  exit 1
fi

echo "[演练] ✓ $TABLES 张表、$ROWS 行逐表一致 —— 这份备份能救回来。"
