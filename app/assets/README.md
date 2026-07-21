# App icon & splash sources

`icon.png` (1024×1024) and `splash.png` (2732×2732) here are **placeholders**
generated from `src/assets/logo-white.svg` on the app's charcoal background.
`@capacitor/assets` only accepts PNG, so the native icons come from these files
(not the SVG the web app uses).

To use your real logo for native icons:

1. Export your 1:1 logo to a **1024×1024 `icon.png`** and a **2732×2732 `splash.png`**
   (logo centered on a solid `#121212` background) and drop them here, overwriting
   the placeholders. Optional for Android adaptive icons: `icon-foreground.png` +
   `icon-background.png`.
2. Run `npm run cap:assets` (from `app/`). It generates every required size for
   iOS and Android directly into the native projects.
3. Re-run after every `npx cap add <platform>`.

Note: the browser favicon and the in-app header/login logo all come from
`src/assets/logo-white.svg` / `logo-black.svg` — replace those two SVGs to update
everything except the native launcher icons.
