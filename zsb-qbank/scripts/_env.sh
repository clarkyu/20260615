# 运维脚本共用的 .env 加载:**`.env` 只提供默认值,调用方显式传进来的环境变量优先。**
#
# 原本三个脚本各写一行 `[ -f .env ] && set -a && . ./.env && set +a` 一把梭,
# 于是 `.env` 会**盖掉调用方传的值**。后果不是理论上的:
#
#   · `BACKUP_DIR=/tmp/x ./scripts/backup.sh` —— dump 仍落进 .env 里的 ./backups
#   · `KEEP_DAYS=30 ./scripts/backup.sh`      —— 仍按 .env 里的天数清理
#   · `DATABASE_URL=... ./scripts/verify-restore.sh` —— 仍演练 .env 那个库
#   · `verify-restore.sh` 内部就是靠 `BACKUP_DIR="$WORK/backups" ./scripts/backup.sh`
#     把备份引到临时目录的 —— 被盖掉之后它在临时目录里找不到 dump,整条恢复演练
#     以一句 `ls: cannot access ...` 失败。
#
# 最后这条最要命:**CI 里没有 .env,所以一直全绿;而 RUNBOOK 让 clark 在生产机上
# 定期跑这条演练,那里必然有 .env** —— 唯一能证明「备份真能救命」的程序,恰恰只在
# 真要用它的那台机器上是坏的(2026-09-17 实测,D82)。
#
# 用法:脚本 `cd` 到项目根之后 `. ./scripts/_env.sh`。
# 新增可被调用方覆盖的旋钮时,在下面的名单里加一行。

_ZSB_ENV_KNOBS="DATABASE_URL BACKUP_DIR KEEP_DAYS"

# 先记下调用方已经设过的值
for _k in $_ZSB_ENV_KNOBS; do
  eval "_zsb_caller_$_k=\"\${$_k-}\""
done

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# 再把调用方的值盖回来:它们优先
for _k in $_ZSB_ENV_KNOBS; do
  eval "_zsb_v=\"\${_zsb_caller_$_k}\""
  if [ -n "$_zsb_v" ]; then
    eval "$_k=\"\$_zsb_v\""
    export "$_k"
  fi
  unset "_zsb_caller_$_k"
done
unset _k _zsb_v
