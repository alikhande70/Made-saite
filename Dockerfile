# syntax=docker/dockerfile:1.7

###############################################################################
# Made-saite production image.
#
# Multi-stage so the runtime carries the compiled server and nothing else: no
# compiler, no dev dependencies, no test suite, no source. Smaller is the lesser
# benefit; the real one is that there is less in the image to audit or exploit.
#
# The image is stateless. Configuration and secrets arrive as environment
# variables at run time, and PostgreSQL lives outside — see
# docker-compose.production.yml and docs/OPERATIONS.md.
###############################################################################

ARG NODE_VERSION=22.22.2

# ── deps ─────────────────────────────────────────────────────────────────────
# Separated so a dependency install is cached across source-only changes.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` installs exactly the lockfile — a deploy must never resolve a
# different tree than the one CI tested.
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Baked into the build for traceability: a running container can name the exact
# commit it was built from. Passed by scripts/deploy.sh.
ARG GIT_SHA=unknown
ENV NEXT_PUBLIC_BUILD_SHA=${GIT_SHA}

RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `tini` reaps zombies and forwards signals, so SIGTERM reaches Node and the
# container shuts down gracefully instead of being killed after the timeout.
RUN apk add --no-cache tini

# Run as an unprivileged user. The image ships nothing the app should be able to
# modify, so the filesystem can also be mounted read-only at run time.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

# `standalone` already contains the pruned node_modules the server needs.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migrations are applied by a separate one-shot container before the app starts,
# never by the app itself — see docs/OPERATIONS.md for why.
COPY --from=build --chown=nextjs:nodejs /app/src/infrastructure/db/migrations ./migrations
COPY --from=build --chown=nextjs:nodejs /app/scripts/migrations-runner.cjs ./migrations-runner.cjs

USER nextjs
EXPOSE 3000

# Readiness, not liveness: the orchestrator should only route traffic here once
# the database is genuinely reachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
