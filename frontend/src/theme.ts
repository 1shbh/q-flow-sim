export function readColorToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
