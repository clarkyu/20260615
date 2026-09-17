#!/usr/bin/env bash
# 从备份恢复(SPEC §10 M7 验收:备份脚本可恢复到空库)。
# 用法:
#   scripts/restore.sh <备份文件> <目标库连接串>          # 恢复到指定库(常用:临时验证库)
#   scripts/restore.sh <备份文件> "$DATABASE_URL" --force # 真·灾难恢复:覆盖生产库
# 目标库必须已存在(createdb zsb_restore_test);脚本不会自动建库、也不会自动删库。
#
# **目标库必须显式给出。** 这里原本默认回落到 DATABASE_URL —— 也就是生产库,
# 而 pg_restore 带的是 `--clean`:先把现有对象删光再灌旧数据。于是少打一个参数
# (`./scripts/restore.sh backups/xxx.dump`)就是拿旧备份覆盖生产,备份之后产生的
# 作答与成绩全部消失,没有任何确认。2026-09-17 实测:6 行作答 → 恢复后 3 行,
# 只剩备份里那批。RUNBOOK 里「务必是另一个库」当时只是一句注释,不是一道门。
#
# 恢复恰恰是救火时才跑的命令 —— 人最慌、最容易少打参数的时候。所以:
#   1. 不给目标库 → 拒绝;
#   2. 目标库名与 DATABASE_URL 的库名相同(即多半就是生产)→ 要 --force,
#      并先把「你即将毁掉的东西」按行数打出来。
# 一般化的教训见 docs/DECISIONS.md D79/D81:门要放在真正做那件事的地方。
set -euo pipefail

cd "$(dirname "$0")/.."
. ./scripts/_env.sh   # .env 只当默认值,调用方传的环境变量优先(D82)

FORCE=no
ARGS=()
for a in "$@"; do
  if [ "$a" = "--force" ]; then FORCE=yes; else ARGS+=("$a"); fi
done

DUMP="${ARGS[0]:-}"
TARGET="${ARGS[1]:-}"

usage() {
  cat >&2 <<'USAGE'
用法: scripts/restore.sh <备份文件> <目标库连接串> [--force]

目标库必须显式写出来,不会默认用 DATABASE_URL —— 恢复会先删光目标库的现有对象,
少打一个参数就是拿旧备份覆盖生产,备份之后的作答与成绩全没。

  # 恢复到临时库验证(推荐先这么做)
  createdb zsb_restore_test
  scripts/restore.sh backups/zsb-20260914-031000.dump postgres://zsb:<密码>@127.0.0.1:5432/zsb_restore_test

  # 真·灾难恢复:确实要用旧备份覆盖生产
  scripts/restore.sh backups/zsb-20260914-031000.dump "$DATABASE_URL" --force
USAGE
  exit 1
}

[ -n "$DUMP" ] || usage
[ -f "$DUMP" ] || { echo "找不到备份文件:$DUMP" >&2; exit 1; }
[ -n "$TARGET" ] || { echo "拒绝执行:没有给目标库。" >&2; usage; }

# 取连接串里的库名(去掉查询串后的最后一段)
dbname_of() { local u="${1%%\?*}"; echo "${u##*/}"; }
TARGET_DB="$(dbname_of "$TARGET")"
LIVE_DB="$(dbname_of "${DATABASE_URL:-}")"

if [ -n "$LIVE_DB" ] && [ "$TARGET_DB" = "$LIVE_DB" ] && [ "$FORCE" != "yes" ]; then
  echo "拒绝执行:目标库「$TARGET_DB」与 DATABASE_URL 指的是同一个库(多半就是生产)。" >&2
  echo "  · 想先验证备份能不能用:建个临时库恢复过去,或直接跑 scripts/verify-restore.sh" >&2
  echo "  · 确实要用这份备份覆盖它:加 --force(现有数据会被删除,不可撤销)" >&2
  exit 1
fi

if [ "$FORCE" = "yes" ] && [ "$TARGET_DB" = "$LIVE_DB" ]; then
  echo "[restore] --force:即将用备份覆盖「$TARGET_DB」。它现在装着:" >&2
  psql --dbname="$TARGET" -At \
    -c "select '  attempts=' || count(*) from attempts" \
    -c "select '  responses=' || count(*) from responses" >&2 || true
  echo "[restore] 这些将被备份里的内容取代。" >&2
fi

echo "[restore] 从 $DUMP 恢复到 ${TARGET%%\?*}"
# --clean --if-exists:目标库已有同名对象时先删;空库也能直接恢复
pg_restore --dbname="$TARGET" --clean --if-exists --no-owner --no-privileges --exit-on-error "$DUMP"

echo "[restore] 完成。核对行数:"
psql --dbname="$TARGET" -At -c "select 'papers=' || count(*) from papers" \
  -c "select 'items=' || count(*) from items" \
  -c "select 'attempts=' || count(*) from attempts" \
  -c "select 'responses=' || count(*) from responses"
