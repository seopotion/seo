Regroup stubs for design-sync. Each `<Name>.md` holds only a `category:` line, which
sets the component's section in the claude.ai/design pane; the body stays empty on
purpose so the converter keeps synthesizing `<Name>.prompt.md` (JSDoc + props +
examples from `.design-sync/previews/`). Add prose here only if a component needs
guidance that doesn't fit `.design-sync/conventions.md`.
