FROM mcr.microsoft.com/playwright:v1.61.1-noble

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

COPY --chown=pwuser:pwuser package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --chown=pwuser:pwuser packages ./packages

RUN pnpm install --frozen-lockfile --filter @savvyedge/api...

# @savvyedge/types is the only workspace dependency in @savvyedge/api's
# runtime graph whose package.json "main" points at compiled output
# (./dist/index.js) rather than TypeScript source. Every other workspace
# dependency (@savvyedge/ai-agents, @savvyedge/database) resolves to source
# and is transpiled on the fly by tsx at runtime, so only this one package
# needs an explicit build step here.
RUN pnpm --filter @savvyedge/types run build

ENV NODE_ENV=production

USER pwuser
WORKDIR /app/packages/api

STOPSIGNAL SIGTERM
CMD ["node", "--import", "tsx", "scripts/run-orchestrator.ts"]
