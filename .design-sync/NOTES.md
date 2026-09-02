# design-sync notes (apps/web/components/ui → claude.ai/design "SEOPotion Web UI")

Repo-specific gotchas for re-syncs. `config.json` holds the machine-readable part; this
file holds the why. Project: https://claude.ai/design/p/cb0a9723-6c9b-470e-8d98-0c3bd1b30c3d

## Build pipeline (package shape, source-only)
- The web app has no library build, so `.design-sync/build.mjs` (= `cfg.buildCmd`) makes a
  scratch package in `.design-sync/pkg/` (its `package.json` is committed; `dist/` is
  gitignored): tsc declarations of `components/ui/index.ts`, an esbuild ESM entry with bare
  deps external, and `globals.css` compiled by the app's own `@tailwindcss/postcss` with
  `base: apps/web` (so every class the app uses ships) plus the safelist in
  `.design-sync/tailwind.css`. Run it before every converter run.
- TypeScript 6 refuses a CLI file list while a tsconfig exists: `--ignoreConfig` is required.
- Converter staging deps (`.ds-sync/`): `npm i esbuild ts-morph @types/react playwright` then
  `npx playwright install chromium`. `@tailwindcss/cli` was also installed once but is NOT
  used — build.mjs goes through the repo's postcss plugin so the Tailwind version always
  matches the app.
- Worktrees: a stale `node_modules` (missing `@radix-ui/react-dialog`) broke tsc; `npm ci` at
  the root fixed it without touching the lockfile. Check before blaming the converter.
- Every PascalCase export is a card (41 from 17 files). Compound folding needs `.d.ts`
  namespace members (`Table.Row`), which this flat-export set lacks — so sub-parts
  (CardHeader, TableRow, SelectItem…) are separate roots whose previews show them inside
  the parent composition.
- Groups come from `.design-sync/docs/<Name>.md` stubs (frontmatter `category:` only, body
  empty on purpose so the converter keeps synthesizing `.prompt.md` with props + examples).
- `dtsPropsFor` restores native props the extractor strips (`disabled`, `placeholder`,
  `onValueChange`, `onOpenChange`, `htmlFor`, `colSpan`…). If a component's real props
  change, update the matching body here or the `.d.ts` lies.
- `biome.json` `files.includes` and the root `tsconfig.json` both leave `.design-sync/` out, so
  `npm run lint` / `check` never see the previews or `build.mjs`; the converter's own
  esbuild compile is their only check.

## Previews (`.design-sync/previews/`)
- Stories must be `export const Name = () => (<jsx/>)` — that exact form is what the
  `.prompt.md` example extractor matches.
- Never import a sibling preview file (`from './Card'`): the import policy resolves any
  module named like an exported component to the bundle global, so it yields the
  component, not the stories. Write standalone compositions.
- Arbitrary-value Tailwind classes (`grid-cols-[auto_1fr]`, `w-[..]`) only exist in the
  compiled CSS when the app itself uses them; previews and designs must stick to built-in
  utilities (a missing class fails silently — no build error, just an unstyled element).
- Radix overlays render statically with `defaultOpen`. Card modes: the Dialog family is
  `single` (960x640); the whole Select family is `single` (640x420, one primary story —
  portal content escapes grid cells, `[GRID_OVERFLOW]`); the Table family and Skeleton are
  `column` (stories wider than a grid cell).

## Component facts learned while authoring previews
- `Input readOnly` has no visual treatment (only disabled / aria-invalid / focus are styled);
  filled and read-only render identically.
- `aria-invalid="true"` on Input/Textarea shows the destructive border at rest; the 3px
  20%-alpha ring reads as a soft halo, not a hard ring.
- `Switch` has no label slot: compose `<Switch id>` + `<Label htmlFor>`; Label's
  `peer-disabled:` dimming works because Switch carries the `peer` class. An inline hint is a
  trailing `<span className="font-normal text-muted-foreground">` inside Label (its root is
  `flex items-center gap-2`).
- `Skeleton` (`bg-muted`) is very faint on white — token behaviour, not a defect; frame
  skeleton layouts with `rounded-xl border` so they stay legible.
- `EmptyState` has no title/description slots; the rich composition mirrors the app's
  `NoArticlesState` (content-history page): icon tile + h2 + muted p + Button.
- Radix Dialog auto-focuses the first focusable on open, so an open-by-default dialog
  captures with a focus ring on its first button — a real state, not a defect; grade it good.
- In `cardMode: column` tables, long 4-column rows squeeze the last column; put
  `whitespace-nowrap` on date columns.
- Capture writes one sheet per component under its group prefix (`data__Table`,
  `overlays__Dialog`); there is no cross-group duplicate to look for.
- The user's zsh aliases `g`; shell helper functions in Bash snippets need another name.
- `<Select defaultOpen>` renders the Radix popover statically; the portal lands on `body`,
  so a cell's `overflow:hidden` never clips it, and several open selects on one card do
  not dismiss each other. Wrap each open story in `min-h-72`/`min-h-80` to keep the
  popover inside its own cell. Scroll buttons render once the list exceeds `max-h-96`
  (~30 items) and `defaultValue` deep in the list scrolls it so both chevrons show.
- 2026-09-02 safelist bug: the `{w,max-w,min-w}` × `xs…7xl` line lacked its hyphen, so
  `max-w-xs` etc. were missing until wave C noticed; fixed in `tailwind.css`.

## Fonts
- The app self-hosts Inter via `next/font/google` in `apps/web/app/[locale]/layout.tsx`
  (exposed as `--font-inter`, first in `--font-sans`). The sync cannot reach next/font's
  build output, so `.design-sync/fonts.css` ships the same family from the
  `@fontsource-variable/inter` devDependency via `extraFonts`; keep both on the same Inter
  major so designs and production match.

## Known render warns (validate lines triaged as legitimate)
- `[FONT_MISSING] "Cambria"` — Tailwind's default `--font-serif` fallback stack; a system
  font, nothing uses `font-serif`, nothing to ship.

## Re-sync risks
- `.design-sync/tailwind.css` (safelist) and the family table in `conventions.md` are
  maintained by hand and must agree; a class named in conventions but absent from the
  compiled CSS renders unstyled in every design.
- The auto-detected class set follows `apps/web` usage; classes the app stops using
  disappear from `_ds_bundle.css` on the next build (safelisted ones stay).
- `dtsPropsFor` bodies drift silently when a component's props change.
- Renders were verified against the local `_ds_bundle.css`; claude.ai/design consumes the
  same file, but the runtime's own page styles were not observed.
