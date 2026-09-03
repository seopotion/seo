# Design

Planning and design documents for the project. These describe what we intend to build; the code does not exist yet.

- [architecture.md](architecture.md) — target stack (TypeScript monorepo, Hono/Lambda backend, Next.js frontend, AWS CDK) and key design constraints.
- [monorepo-and-api-client.md](monorepo-and-api-client.md) — monorepo layout, shared packages, and the typed Hono OpenAPI client shared with the frontend (patterns learned from the dkn-harbor repo).
- [data-layer.md](data-layer.md) — MongoDB data layer using Zod + the official `mongodb` driver (no Mongoose): connection reuse on Lambda, repository pattern, index management.
- [product-flow.md](product-flow.md) — end-to-end product flow: auth, setup/onboarding, dashboard, subscription model, and endpoints. UI mockups are described inline as text/diagrams.
- [llm-image-providers.md](llm-image-providers.md) — LLM (OpenRouter) + image (fal.ai) provider decision for the article pipeline, and the provider-neutral `LlmClient` / `ImageClient` interfaces in `@shared/providers`.
- [article-images.md](article-images.md) — article cover/OG + inline image pipeline (#51): image SQS task, per-stage S3 + CloudFront storage, embedded image state, idempotent per-slot retries.
- [admin-panel.md](admin-panel.md) — internal operator panel for the wizard-of-oz operating model: separate admin Lambda + auth boundary, on-behalf-of mutations over the existing repos, append-only audit log, pipeline trigger/replay levers.
- [integrations-model.md](integrations-model.md) — generalised publishing-connection entity (#7): an `integrations` collection keyed by (org, provider) replacing the hardcoded `org.wordpress_token`, per-article `publications[]` replacing `wordpress_post_id`, and the migration off both.
- [github-app.md](github-app.md) — the GitHub App behind static-site publishing: registration and per-env apps, `contents: write` only (and why *not* `workflows: write`), the state/grant-guarded install flow, installation-token minting, and the private key in SSM.
- [static-site-integration.md](static-site-integration.md) — publishing to git-hosted static sites (Vue/Next/Astro/Nuxt/Hugo): the frozen content contract we commit into a client repo (`manifest.json` + Markdown, text only — images stay on our CDN), atomic Git Data API commits, and the publish semantics. Extends the integration model (#7).
- [documentation-ia.md](documentation-ia.md) — user-facing documentation / help center: what's documentable today (live features vs. hold), the coverage-gap analysis vs. competitors (Outrank, Surfer, Frase), and the information architecture for splitting the single `/docs` page into per-guide routes.
- [article-image-direction.md](article-image-direction.md) — org-level image direction (#312): the scanner picks a medium enum, palette and subject notes once; the planner inherits them, and legacy `image_style` is moved into notes on read.
