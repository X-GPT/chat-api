FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install dependencies — need all referenced workspace package.json files for
# lockfile resolution.
FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
COPY apps/llm-gateway/package.json /temp/prod/apps/llm-gateway/
COPY packages/llm-token/package.json /temp/prod/packages/llm-token/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Final release image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY apps/llm-gateway/src apps/llm-gateway/src
COPY apps/llm-gateway/package.json apps/llm-gateway/tsconfig.json apps/llm-gateway/
COPY packages/llm-token packages/llm-token
COPY package.json .

WORKDIR /usr/src/app/apps/llm-gateway
USER bun
EXPOSE 8081/tcp
ENTRYPOINT [ "bun", "run", "src/index.ts" ]
