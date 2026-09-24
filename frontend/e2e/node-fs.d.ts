// The one Node API the E2E tests use (reading a downloaded file). Declared here instead of adding
// @types/node as a dependency; the tests run under Playwright's Node runtime.
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
}
