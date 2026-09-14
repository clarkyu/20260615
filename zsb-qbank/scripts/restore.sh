#!/usr/bin/env bash
# 从备份恢复(SPEC §10 M7 验收:备份脚本可恢复到空库)。
# 用法:
#   scripts/restore.sh backups/zsb-20260914-031000.dump                      # 恢复到 DATABASE_URL
#   scripts/restore.sh backups/zsb-...dump postgres://zsb@127.0.0.1:5432/zsb_restore_test
# 目标库必须已存在(createdb zsb_restore_test);脚本不会自动删库。
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

DUMP="${1:?用法: scripts/restore.sh <备份文件> [目标库连接串]}"
TARGET="${2:-${DATABASE_URL:?DATABASE_URL 未设置}}"
[ -f "$DUMP" ] || { echo "找不到备份文件:$DUMP" >&2; exit 1; }

echo "[restore] 从 $DUMP 恢复到 ${TARGET%%\?*}"
# --clean --if-exists:目标库已有同名对象时先删;空库也能直接恢复
pg_restore --dbname="$TARGET" --clean --if-exists --no-owner --no-privileges --exit-on-error "$DUMP"

echo "[restore] 完成。核对行数:"
psql --dbname="$TARGET" -At -c "select 'papers=' || count(*) from papers" \
  -c "select 'items=' || count(*) from items" \
  -c "select 'attempts=' || count(*) from attempts" \
  -c "select 'responses=' || count(*) from responses"
