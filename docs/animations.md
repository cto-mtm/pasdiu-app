# Animation Cookbook

Two primitives only:

1. **View Transitions API** (`document.startViewTransition`) for *between-page* animations, including Flutter-style hero / shared-element transitions.
2. **Vue's built-in `<Transition>` / `<TransitionGroup>`** for *within-page* enter/leave (modals, list items, toasts).

No motion libraries, no GSAP, no scroll-jacking, no JS-driven tweening.

Page-to-page transitions are driven centrally by the wrapper in `src/router/index.ts`. Pages opt into specific effects **purely via CSS** in `src/assets/css/transitions.css`. That router file never changes per-page.

---

## 1. Add a hero transition between two pages

The Flutter-`Hero` equivalent. Three steps, no JS. Name builders are centralized in `src/lib/viewTransitions.ts` so the source and target can never drift apart — add a `<thing>TransitionName(id)` helper there rather than hand-writing name strings in components.

1. On the **source** element (e.g. the client name in a `DashboardPage.vue` card), set the name via the helper:
   ```html
   <h3 :style="{ viewTransitionName: clientTitleTransitionName(c.id) }">
   ```
2. On the **target** element on the destination page (the `<h1>` in `ClientDetailPage.vue`), use the **same** helper:
   ```html
   <h1 :style="{ viewTransitionName: clientTitleTransitionName(client.id) }">
   ```
3. Navigate between the pages through the router. The browser matches the two names across the snapshot and morphs position/size/shape automatically.

The reference implementation is the `DashboardPage` client card title → `ClientDetailPage` header title (`client-title-<id>`), proving the recipe works on plain text, not just images.

> **Critical rule:** a `view-transition-name` must be unique per page at any moment. Never put a static name inside a `v-for` — always derive it from the item id.

---

## 2. Add a custom per-page transition

Worked example (shipped as Recipe 2b in `transitions.css`) — slide the `/settings` page in from the right:

1. Give the Settings page root a name via inline style:
   ```html
   <section style="view-transition-name: settings-page;">
   ```
2. Add one keyframe pair in `transitions.css`:
   ```css
   @keyframes slide-from-right { from { transform: translateX(30px); opacity: 0; } to { transform: none; opacity: 1; } }
   ::view-transition-new(settings-page) { animation: slide-from-right 260ms cubic-bezier(0.4, 0, 0.2, 1); }
   ```

That's it — no router changes. Any element with a unique `view-transition-name` becomes independently targetable via `::view-transition-*(<name>)`.

---

## 3. Animate a list reorder / insert / remove

Use Vue's `<TransitionGroup>` with the `name="list"` classes (Recipe 4 in `transitions.css`). `ProjectBoardPage.vue` uses this for the Kanban columns and list groups, so cards FLIP-move when a task changes status:

```html
<TransitionGroup name="list" tag="div" class="space-y-2">
  <TaskCard v-for="tk in tasksInColumn(col)" :key="tk.id" :task="tk" />
</TransitionGroup>
```

```css
.list-move { transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1); }
.list-enter-from, .list-leave-to { opacity: 0; transform: scale(0.96); }
.list-enter-active, .list-leave-active { transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1); }
.list-leave-active { position: absolute; }
```

---

## 4. The rules

- Animate **only** `transform` and `opacity` (compositor-friendly; everything else jank).
- Durations **200–350ms**. Easing `cubic-bezier(0.4, 0, 0.2, 1)`.
- **Where the CSS lives:** within-page Vue `<Transition>`/`<TransitionGroup>` CSS also lives in `src/assets/css/transitions.css`, as shared numbered recipes (e.g. Recipe 4 `list`, Recipe 6 `overlay`, Recipe 7 `toast`, Recipe 10 `tour-step`) — not in component `<style>` blocks.
- **Exempt micro-interactions:** Tailwind hover/focus color-feedback utilities (`transition-colors`, hover background shifts, etc.) don't count as animations here — the 200–350ms rule governs enter/leave and view transitions, not instant pointer feedback.
- **Exempt busy indicators:** a looping spinner (Recipe 11 `.refresh-spin`, used by `RefreshButton.vue`) has no start or end state to land on, so the 200–350ms duration rule doesn't apply to it. Everything else still does — transform-only, and killed under `prefers-reduced-motion` (the button's disabled state carries the "working" signal on its own).
- `view-transition-name` values must be **unique per page** at any moment.
- Always test with **reduced motion** on — Recipe 3 kills all view-transition animation under `prefers-reduced-motion: reduce`.
- **Never** nest `startViewTransition` calls, and never call it outside the router wrapper.
- Every recipe must look acceptable if it simply cross-fades — that's the automatic fallback.

---

## 5. Platform support

- **Chromium** (incl. Android WebView): View Transitions since **111**.
- **iOS WKWebView**: since **iOS 18**.

On anything older, the router wrapper silently degrades to instant navigation. That is the designed fallback, not a bug.
