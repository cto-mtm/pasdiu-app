// Shared view-transition-name builders (see docs/animations.md, Recipe 1).
// Hero transitions work by giving the source and target elements the exact
// same name, so both pages must derive it from one function — never inline
// the string on either side.

export function clientTitleTransitionName(id: string): string {
  return `client-title-${id}`
}
