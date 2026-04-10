FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install dependencies — need all workspace package.json files for lockfile resolution
FROM base AS install
RUN mkdir -p /temp/dev /temp/prod

COPY package.json bun.lock /temp/dev/
COPY apps/chat-api/package.json /temp/dev/apps/chat-api/
COPY apps/sandbox-daemon/package.json /temp/dev/apps/sandbox-daemon/
COPY packages/db/package.json /temp/dev/packages/db/
RUN cd /temp/dev && bun install --frozen-lockfile

COPY package.json bun.lock /temp/prod/
COPY apps/chat-api/package.json /temp/prod/apps/chat-api/
COPY apps/sandbox-daemon/package.json /temp/prod/apps/sandbox-daemon/
COPY packages/db/package.json /temp/prod/packages/db/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Copy source and run tests
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY apps/chat-api/ apps/chat-api/
COPY packages/db/ packages/db/
COPY package.json .

WORKDIR /usr/src/app/apps/chat-api
ENV NODE_ENV=production
RUN bun test

# Final release image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/apps/chat-api/src apps/chat-api/src
COPY --from=prerelease /usr/src/app/apps/chat-api/package.json apps/chat-api/
COPY --from=prerelease /usr/src/app/apps/chat-api/tsconfig.json apps/chat-api/
COPY --from=prerelease /usr/src/app/packages/db packages/db
COPY --from=prerelease /usr/src/app/package.json .

WORKDIR /usr/src/app/apps/chat-api
USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "src/index.ts" ]
