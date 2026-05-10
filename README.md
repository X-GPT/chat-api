# MyMemo Monorepo

This repository contains multiple projects for the MyMemo ecosystem.

## Projects

### 🔷 chat-api (TypeScript)

Chat API service built with TypeScript/Bun.

**Location:** `apps/chat-api/`

**Setup:**
```bash
cd apps/chat-api
bun install
bun run dev
```

See [apps/chat-api/README.md](./apps/chat-api/README.md) for detailed documentation.

## Repository Structure

```
.
├── apps/               # Deployable applications
│   └── chat-api/       # TypeScript chat API service
│       ├── src/
│       ├── package.json
│       └── ...
├── packages/           # Shared libraries
├── compose.yaml        # Local Docker Compose file
└── README.md           # This file
```

## Development

Each project can be developed independently. Navigate to the respective project directory and follow its setup instructions.

## Local Docker

`compose.yaml` builds and runs chat-api locally:

```sh
docker-compose up
```

