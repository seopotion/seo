# Org-level image direction

Design for [#312](https://github.com/seopotion/seo/issues/312). Written 2026-09-02.
Follows [`article-image-prompts.md`](article-image-prompts.md) (#309/#310), which
left the medium as a per-article classification of a free-text preset.

## Decision

Art direction is a structured org preset, decided once by the scanner and
inherited by every article. The planner only decides what each picture shows.

```ts
engagement.image_direction: {
  medium: 'photograph' | 'flat_illustration' | 'three_d_render' | 'watercolor' | 'line_art' | 'isometric';
  palette: string;  // ≤ 6 words, '' = none
  notes: string;    // subject preferences, '' = none
}
```

| Concern | Choice |
| --- | --- |
| Who picks the medium | The scanner, as a structured-output enum, from the site's visual character. Screenshots/diagrams are never a medium. |
| Palette | One per org, from the site's brand colours; applied to every slot. Per-slot palette is gone — it is what broke colour identity. Still filtered by `findTextRisk` at assembly. |
| Planner | Told the medium and notes; returns `subject`, `composition`, `lighting`, `objects`, `alt` per slot. No `medium`, no `palette`. |
| Legacy `image_style` | Moved into `notes` on read by a `z.preprocess` (medium `photograph`, palette `''`). No migration, nothing dropped. |
| Editing | Admin presets editor: medium select, palette, notes. Customer settings/onboarding UI is a separate frontend issue. |

## Verification

Unit tests per package; a local fal render loop before the PR; a staging article
after deploy showing three images with one medium and one palette.
