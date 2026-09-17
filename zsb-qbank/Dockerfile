# zsb-qbank 生产镜像(SPEC §9.6):多阶段构建 → Next.js standalone 产物,非 root 运行。
# 构建:docker build -t zsb-qbank .
# 运行:见 docker-compose.yml(app 只监听 127.0.0.1:3000,TLS 由现有反向代理终止)。

# 基础镜像**钉到具体的 Alpine**,不是浮动的 `node:22-alpine`。
# 2026-09-17 第一次真构建这个镜像时就是栽在这上面:`node:22-alpine` 那时已经滚到 Alpine 3.24,
# 而 `postgresql16-client` 在 3.24 里已经没有了(只剩 17 / 18)—— `apk add` 直接失败,
# 镜像**根本构建不出来**,而 CI 从来没构建过它,所以谁也不知道(D67)。
# 钉住还顺带把 pg_dump 的大版本和 `postgres:16` 服务端对齐,备份/恢复不用担心跨版本。
# 要升 Alpine 就改这一行,CI 每次都会真构建一遍,升坏了当场红。
ARG NODE_IMAGE=node:22-alpine3.22

# ---- 依赖层:只装依赖,利用 lockfile 缓存 ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- 构建层 ----
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期不连数据库:next build 只做编译与预渲染(所有数据页都是 force-dynamic)。
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- 运行层 ----
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# 运维脚本(backup / restore / verify-restore)是 bash + pg 工具写的,两样都要装:
# alpine 默认**没有 bash**,少了它这些脚本在容器里一跑就是 `env: can't execute 'bash'`。
# 备份跑在容器里而不是宿主机上,是因为 RUNBOOK 只要求宿主机有 Docker —— 宿主机不一定有
# pg_dump,有也不保证 ≥ 16;容器里这份恰好就是 16,和 postgres:16 服务端对齐(D69)。
# wget 供 HEALTHCHECK 用(alpine 自带 busybox wget)。
RUN apk add --no-cache postgresql16-client bash tini \
  && addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# standalone 产物 + 静态资源 + public;prompts 由 next.config 的 outputFileTracingIncludes 带入
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# 只带**纯 bash + pg 工具**就能跑的运维脚本(backup / restore / verify-restore):
# 这几个在运行镜像里直接可用(上面装了 postgresql16-client)。
# 迁移与种子(scripts/*.ts)**不在这儿跑** —— 它们要 tsx,而运行镜像的 node_modules 是
# standalone 的精简子集(只有 next / pg / react / typescript),没有 tsx 也没有 pnpm。
# 那两件事跑在 docker-compose.yml 的 tools 服务里(target: builder,带完整 devDependencies)。
# 所以 drizzle/ seed/ src/lib/** tsconfig.json 都不必进运行镜像(D68)。
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
