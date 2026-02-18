# Contributing

Thank you for your interest in contributing to the VGE LiteLLM Connector.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/vge-litellm-connector.git
   cd vge-litellm-connector
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Copy the example environment file:
   ```bash
   cp .env.example .env
   # Edit .env with your Vigil Guard API key
   ```

## Development

```bash
pnpm dev              # Start with hot reload
pnpm test             # Run unit + integration tests
pnpm test:coverage    # Run tests with coverage
pnpm typecheck        # TypeScript type checking
pnpm test:e2e         # Run E2E tests (requires Docker)
```

## Pull Requests

- Create a feature branch from `main`
- Follow existing code style and conventions
- Add tests for new functionality
- Ensure all tests pass before submitting
- Use clear, descriptive commit messages

## Code Style

- TypeScript strict mode
- No runtime dependencies beyond Fastify
- Keep functions small and focused
- Handle errors explicitly

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
