#!/usr/bin/env bash
# 每日备份(SPEC §9.6):pg_dump 自定义格式到本机目录,保留 14 天。
# 用法:
#   scripts/backup.sh                      # 读 .env 的 DATABASE_URL,存到 ./backups
#   BACKUP_DIR=/var/backups/zsb scripts/backup.sh
#   KEEP_DAYS=30 scripts/backup.sh
# cron(每天 03:10):
#   10 3 * * * cd /srv/zsb-qbank && ./scripts/backup.sh >> /var/log/zsb-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
. ./scripts/_env.sh   # .env 只当默认值,调用方传的环境变量优先(D82)

DB_URL="${DATABASE_URL:?DATABASE_URL 未设置(.env 或环境变量)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/zsb-$STAMP.dump"

mkdir -p "$BACKUP_DIR"
umask 077

# -Fc 自定义格式:可用 pg_restore 选择性恢复,比纯 SQL 小
pg_dump --dbname="$DB_URL" --format=custom --no-owner --no-privileges --file="$OUT.part"
mv "$OUT.part" "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[backup] $(date '+%F %T') 完成:$OUT($SIZE)"

# 保留最近 KEEP_DAYS 天
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'zsb-*.dump' -type f -mtime "+$KEEP_DAYS" -print -delete | wc -l | tr -d ' ')"
echo "[backup] 清理 $DELETED 个超过 $KEEP_DAYS 天的备份;当前保留 $(find "$BACKUP_DIR" -maxdepth 1 -name 'zsb-*.dump' -type f | wc -l | tr -d ' ') 份"
