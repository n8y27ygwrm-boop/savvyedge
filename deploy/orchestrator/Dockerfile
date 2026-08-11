FROM mcr.microsoft.com/playwright:v1.61.1-noble

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

COPY --chown=pwuser:pwuser package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --chown=pwuser:pwuser packages ./packages

RUN pnpm install --frozen-lockfile --filter @savvyedge/api...

ENV NODE_ENV=production

USER pwuser
WORKDIR /app/packages/api

STOPSIGNAL SIGTERM
CMD ["node", "--import", "tsx", "scripts/run-orchestrator.ts"]
