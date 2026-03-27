# Chat API

A modern chat API built with Bun, Hono, and OpenAI integration. This API provides streaming chat functionality with GPT-4o and includes comprehensive preview deployment capabilities for testing pull requests.

## Features

- 🤖 **OpenAI Integration**: Powered by GPT-4o for intelligent chat responses
- ⚡ **Fast Runtime**: Built with Bun for optimal performance
- 🔄 **Streaming Responses**: Real-time chat with streaming text generation
- 📚 **OpenAPI Documentation**: Auto-generated API documentation
- 🐳 **Docker Support**: Containerized for easy deployment
- 🚀 **Preview Deployments**: Automatic preview environments for pull requests
- 🔧 **Modern Tooling**: TypeScript, Biome for linting/formatting, Zod for validation

## Technology Stack

- **Runtime**: Bun
- **Framework**: Hono
- **AI**: OpenAI GPT-4o via Vercel AI SDK
- **Language**: TypeScript
- **Validation**: Zod
- **Documentation**: Scalar API Reference
- **Linting/Formatting**: Biome
- **Containerization**: Docker
- **Deployment**: AWS (ECR, EC2, nginx)

## Prerequisites

- [Bun](https://bun.sh) (latest version)
- OpenAI API key
- Docker (for containerization)

## Installation

1. **Clone the repository**:
   ```sh
   git clone <repository-url>
   cd chat-api
   ```

2. **Install dependencies**:
   ```sh
   bun install
   ```

3. **Set up environment variables**:
   ```sh
   # Create .env file and add your OpenAI API key
   echo "OPENAI_API_KEY=your_openai_api_key_here" > .env
   ```

## Development

### Running the development server

```sh
bun run dev
```

The API will be available at `http://localhost:3000`

### Available Scripts

- `bun run dev` - Start development server with hot reload
- `bun run format` - Format code with Biome
- `bun run lint` - Lint and fix code with Biome

## API Endpoints

### Chat Completion

**POST** `/api/v1/chat`

Stream chat completions using OpenAI GPT-4o.

**Request Body**:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ]
}
```

**Response**: Streaming text response

## Project Structure

```
src/
├── features/
│   └── chat/
│       ├── chat.constants.ts    # Chat-related constants
│       ├── chat.controller.ts   # OpenAI integration logic
│       ├── chat.route.ts        # Chat API routes
│       └── chat.route.test.ts   # Route tests
├── routes/
│   ├── v1.ts                   # API v1 routes
│   └── routes.ts               # Route definitions
└── index.ts                    # Application entry point
```

## Docker

### Building the image

```sh
docker build -t chat-api .
```

### Running with Docker

```sh
docker run -p 3000:3000 -e OPENAI_API_KEY=your_key chat-api
```

### Using Docker Compose

```sh
docker-compose up
```

## Preview Deployments

This project includes an automated preview deployment system that creates isolated environments for each pull request. When you create a PR, a preview environment will be automatically deployed and accessible at:

`https://chat-api-pr-{PR_NUMBER}.preview.mymemo.ai`

For more details, see [PREVIEW_DEPLOYMENT.md](PREVIEW_DEPLOYMENT.md).

## API Documentation

When running the development server, interactive API documentation is available at:
- Swagger UI: `http://localhost:3000/docs`

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for chat functionality | Yes |
| `E2B_API_KEY` | API key for the sandbox prototype script | Yes (for prototype) |
| `E2B_TEMPLATE` | E2B sandbox template for the prototype script | Yes (for prototype) |
| `PORT` | Server port (default: 3000) | No |
| `PROTECTED_API_PREFIX` | Path prefix used when forwarding chat entities (e.g. `/beta-api` or `/api`) | No |
| `PROTECTED_API_ORIGIN` | Origin (protocol + host[:port]) for the protected service (default: `http://127.0.0.1`) | No |

## Sandbox Prototype

The Phase 1 spike is exposed as a script:

```sh
bun run prototype:sandbox ./sandbox-prototype-input.json
```

It requires `E2B_API_KEY` and `E2B_TEMPLATE`.

The input file accepts:

```json
{
  "userId": "prototype-user",
  "query": "How does the auth flow work?",
  "exactQuery": "\"signed challenge\"",
  "conceptualQuery": "how users authenticate",
  "documents": [
    {
      "summaryId": "42",
      "type": 7,
      "title": "Auth Spec",
      "sourceKind": "markdown",
      "content": "# Auth flow\nUsers authenticate with a signed challenge."
    }
  ]
}
```

The script prints JSON including `answerText`, `citationsParseable`, timing metrics, exact/conceptual query results, and raw observations from the sandbox runner.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run linting and formatting (`bun run lint && bun run format`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

[Add your license information here]

## Support

For questions or support, please [open an issue](https://github.com/your-username/chat-api/issues).
