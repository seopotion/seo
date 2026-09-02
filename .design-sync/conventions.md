## Building with SeoPotionUI — conventions

**Setup.** Nothing to wrap: there is no theme or context provider. Link `styles.css` once (it `@import`s `_ds_bundle.css`, the compiled Tailwind v4 stylesheet carrying the preflight reset, the tokens, every component style and the utility classes below). Components mount from `window.SeoPotionUI.*`. Dark mode is a `.dark` class on an ancestor; every token below is redefined there, so never hard-code colours. Text is Inter (self-hosted; `font-sans`), weights 100–900.

**Styling idiom: Tailwind utility classes, precompiled.** The stylesheet is static, so only the classes enumerated here (plus everything the product app itself uses) exist — a class outside this vocabulary silently renders unstyled. No arbitrary values (`w-[437px]`, `bg-[#123]`): use `style={{}}` for one-off measurements. Prefix any family with `sm:` `md:` `lg:` `xl:` for breakpoints (spacing, sizing, display, grid, text sizes) and with `hover:` `focus-visible:` `disabled:` `group-hover:` for states.

| Family | Classes |
|---|---|
| Surfaces & text | `bg-background` `text-foreground` `bg-card` `text-card-foreground` `bg-popover` `bg-muted` `text-muted-foreground` `bg-accent` `text-accent-foreground` `bg-primary` `text-primary-foreground` `bg-secondary` `text-secondary-foreground` `bg-destructive` |
| Edges | `border` `border-border` `border-input` `divide-y` `divide-border` `ring-ring` `focus-visible:ring-[3px]` |
| Status tones (soft, 4-value) | text/icon `text-success` · badge fill `bg-success-muted` · panel fill `bg-success-subtle` + edge `border-success-border`; same shape for `warning`, `error`, `info`, `progress`. `destructive` is the only solid red (`bg-destructive text-white`). Charts: `var(--chart-1)`…`var(--chart-3)` as inline colours. |
| Opacity | `bg-primary/90` `bg-muted/50` `border-border/50` (10 20 30 40 50 60 70 80 90) |
| Spacing | `p m px py pt pr pb pl mx my mt mb gap gap-x gap-y space-y` × `0 px 0.5 1 1.5 2 2.5 3 3.5 4 5 6 8 10 12 16 20 24 32 40 48 64`; `mx-auto` `-mt-2` |
| Sizing | `w h size min-w max-w min-h max-h` × scale, `full screen fit min max 1/2 1/3 2/3 1/4 3/4`; `size-4` for icons; `max-w-xs…7xl` `max-w-prose` |
| Layout | `flex inline-flex grid hidden block` `flex-col flex-wrap flex-1 shrink-0 grow` `grid-cols-1…12 col-span-* auto-rows-min` `items-center justify-between place-items-center self-start` `relative absolute fixed sticky inset-0 z-50` `overflow-hidden overflow-x-auto` `aspect-video` |
| Type | `text-xs text-sm text-base text-lg text-xl text-2xl…6xl` `font-medium font-semibold font-bold` `leading-none leading-6 leading-relaxed` `tracking-tight` `truncate line-clamp-2 whitespace-nowrap text-balance tabular-nums uppercase underline underline-offset-4` |
| Shape & depth | `rounded-sm rounded-md rounded-lg rounded-xl rounded-full` `shadow-xs shadow-sm shadow-md shadow-lg` `ring-2` `opacity-50` |
| Motion & cursor | `transition-colors transition-all duration-200 ease-out animate-pulse animate-spin` `cursor-pointer select-none pointer-events-none sr-only` |

**Which component.** `Button` variants: `default` (primary action), `secondary`, `outline`, `ghost`, `destructive`, `link`; sizes `sm default lg icon`; `asChild` to style an `<a>`. `Badge` for inline status pills — soft `success`/`warning`/`error`/`info`/`progress`/`neutral`, solid `destructive` only for irreversible actions. `StatusPanel tone=…` for page-level messages (loading, saved, errors); `Alert` + `AlertTitle`/`AlertDescription` for a titled callout with an icon. `EmptyState framed` for empty lists. Compose `Card` › `CardHeader` (`CardTitle`, `CardDescription`) › `CardContent` › `CardFooter`; `Dialog` › `DialogContent` › `DialogTitle` (`open`/`onOpenChange`); `Select` › `SelectTrigger` (`SelectValue placeholder`) + `SelectContent` › `SelectItem value`; `Table` › `TableHeader` (`TableRow` › `TableHead`) + `TableBody` (`TableRow` › `TableCell`). Pair every `Input`/`Textarea`/`Switch` with a `Label htmlFor`; `readOnly` has no visual state (only `disabled` and `aria-invalid` do). Page headers are `PageTitle` + `PageDescription`. Icons: lucide-style inline SVG sized `size-4`.

**Where the truth lives.** `_ds_bundle.css` — search `:root {` for every token value and `.dark {` for the dark set; the `.bg-…`/`.text-…` rules there are the exhaustive class list. Per component: `components/<group>/<Name>/<Name>.prompt.md` (props + verified examples) and `<Name>.d.ts`.

```jsx
const { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Label, Input, Switch, Button, StatusPanel } = window.SeoPotionUI;
<Card className="max-w-md">
  <CardHeader>
    <CardTitle>Publishing</CardTitle>
    <CardDescription>Where generated articles go.</CardDescription>
  </CardHeader>
  <CardContent className="grid gap-4">
    <div className="grid gap-2"><Label htmlFor="site">Site URL</Label><Input id="site" type="url" placeholder="https://blog.acme.com" /></div>
    <div className="flex items-center gap-3"><Switch id="auto" defaultChecked /><Label htmlFor="auto">Auto-publish new articles</Label></div>
    <StatusPanel tone="info">Articles publish daily at 07:00 UTC.</StatusPanel>
  </CardContent>
  <CardFooter className="gap-2"><Button>Save</Button><Button variant="ghost">Cancel</Button></CardFooter>
</Card>
```
