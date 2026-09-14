# zsb-qbank 生产镜像(SPEC §9.6):多阶段构建 → Next.js standalone 产物,非 root 运行。
# 构建:docker build -t zsb-qbank .
# 运行:见 docker-compose.yml(app 只监听 127.0.0.1:3000,TLS 由现有反向代理终止)。

# ---- 依赖层:只装依赖,利用 lockfile 缓存 ----
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- 构建层 ----
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期不连数据库:next build 只做编译与预渲染(所有数据页都是 force-dynamic)。
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- 运行层 ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# 备份脚本用 pg_dump;wget 供 HEALTHCHECK 用(alpine 自带 busybox wget)
RUN apk add --no-cache postgresql16-client tini \
  && addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# standalone 产物 + 静态资源 + public;prompts 由 next.config 的 outputFileTracingIncludes 带入
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# 迁移与种子在容器里跑(scripts/ 用 tsx,需要 drizzle 目录与源码里的 schema)
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/seed ./seed
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db ./src/lib/db
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/schema ./src/lib/schema
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
