FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install dependencies — need all referenced workspace package.json files for
# lockfile resolution.
FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
# The root lockfile describes every workspace member, so --frozen-lockfile needs
# each member's package.json present (only package.json — no source).
COPY apps/document-gateway/package.json /temp/prod/apps/document-gateway/
COPY apps/llm-gateway/package.json /temp/prod/apps/llm-gateway/
COPY apps/chat-api/package.json /temp/prod/apps/chat-api/
COPY apps/sandbox-daemon/package.json /temp/prod/apps/sandbox-daemon/
COPY packages/llm-token/package.json /temp/prod/packages/llm-token/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Final release image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY apps/document-gateway/src apps/document-gateway/src
COPY apps/document-gateway/package.json apps/document-gateway/tsconfig.json apps/document-gateway/
COPY packages/llm-token packages/llm-token
COPY package.json .

WORKDIR /usr/src/app/apps/document-gateway
USER bun
EXPOSE 8082/tcp
ENTRYPOINT [ "bun", "run", "src/index.ts" ]
