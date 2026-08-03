// jest-axe ships no type declarations and there is no @types/jest-axe package. This is a
// deliberately minimal ambient declaration — just enough surface for how this test suite
// uses it (axe(container), expect(...).toHaveNoViolations()) — not a full re-implementation
// of jest-axe's API. Kept as a script-mode file (no top-level import/export) so this
// `declare module` for a brand-new (never-typed) module is unambiguous; the SEPARATE
// vitest-matchers.d.ts file handles augmenting vitest's own (already-typed) module, which
// needs module mode instead — see that file's own comment for why the two can't be merged.

declare module "jest-axe" {
  export interface AxeViolation {
    id: string;
    impact?: string;
    description: string;
    help: string;
    helpUrl: string;
    nodes: unknown[];
  }

  export interface AxeResults {
    violations: AxeViolation[];
  }

  export function axe(html: Element | Document | string, options?: unknown): Promise<AxeResults>;

  export interface MatcherResult {
    pass: boolean;
    message(): string;
  }

  export const toHaveNoViolations: Record<string, (...args: unknown[]) => MatcherResult>;
}
