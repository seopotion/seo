# Design

Planning and design documents for the project. These describe what we intend to build; the code does not exist yet.

- [architecture.md](architecture.md) — target stack (TypeScript monorepo, Hono/Lambda backend, Next.js frontend, AWS CDK) and key design constraints.
- [monorepo-and-api-client.md](monorepo-and-api-client.md) — monorepo layout, shared packages, and the typed Hono OpenAPI client shared with the frontend (patterns learned from the dkn-harbor repo).
- [data-layer.md](data-layer.md) — MongoDB data layer using Zod + the official `mongodb` driver (no Mongoose): connection reuse on Lambda, repository pattern, index management.
- [product-flow.md](product-flow.md) — end-to-end product flow: auth, setup/onboarding, dashboard, subscription model, and endpoints. UI mockups are described inline as text/diagrams.
- [llm-image-providers.md](llm-image-providers.md) — LLM (OpenRouter) + image (fal.ai) provider decision for the article pipeline, and the provider-neutral `LlmClient` / `ImageClient` interfaces in `@shared/providers`.
