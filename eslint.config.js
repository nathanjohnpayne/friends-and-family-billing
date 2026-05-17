// eslint.config.js (CommonJS variant)
//
// Auto-generated from nathanjohnpayne/mergepath's templated source
// at examples/eslint.config.cjs.js (per the Mergepath ESLint
// standard, mergepath#250). Edit upstream, not this rendered copy
// — local edits will be overwritten on the next propagation run.
//
// This is the CommonJS variant. It's rendered for consumers whose
// package.json does NOT declare `"type": "module"` (default CJS
// resolution). ESM consumers get the sibling examples/
// eslint.config.js (ESM variant) instead — see .mergepath-sync.yml
// for the consumers: partitioning.
//

const js = require("@eslint/js");
const globals = require("globals");

const react = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");

module.exports = [
  // Ignore generated / vendored output. Customize per-consumer via
  // a follow-up commit on the propagation PR if a repo needs extras
  // (e.g., functions/lib for cloud-functions repos).
  //
  // `.claude/worktrees/**` is the per-agent worktree root that
  // Claude Code creates for parallel sub-tasks; linting the working
  // copies inside it is duplicative and noisy on every agent run.
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      ".astro/**",
      ".next/**",
      ".vercel/**",
      ".claude/worktrees/**",
    ],
  },

  // Baseline JS recommended — required by the Mergepath policy floor.
  js.configs.recommended,

  // Baseline rule policy applied to all JS sources. `^_`-prefix
  // unused-vars is the standard convention for marking intentionally-
  // unused locals (args, vars, caught errors, destructured-array
  // leftovers); the `allowEmptyCatch` setting permits the
  // `catch (_) {}` swallow idiom that appears in legacy code.
  // Both relaxations were added by hand by 5 of 6 consumers during
  // the Phase D fanout (#250) — folding them into the baseline
  // removes the per-consumer churn.
  {
    rules: {
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // Apply browser + node globals to all JS sources by default. Narrow
  // these per-file-pattern in a follow-up commit if the repo has a
  // clean split (e.g., scripts/* node-only, src/* browser-only).
  //
  // `*.cjs` files are split out so ESLint parses them as CommonJS
  // (`sourceType: "commonjs"`) rather than ES modules — otherwise
  // top-level `require`/`module.exports` and CommonJS scope rules
  // produce false-positive parse errors. The defaults ESLint applies
  // by extension are: `module` for `.js`/`.mjs`, `commonjs` for
  // `.cjs`; we make that explicit here so the policy is
  // self-documenting.
  {
    files: ["**/*.{js,mjs,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },




  // React + React Hooks recommended rulesets — applied to .jsx / .tsx.
  // Detect the React version automatically from package.json. The
  // React 17+ JSX transform makes `react/react-in-jsx-scope` obsolete;
  // turn it off explicitly so the rule doesn't flag every component.
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      // React Compiler advisories — disabled by default because they
      // only fire usefully once the React Compiler is adopted; until
      // then they're noisy on idiomatic React (set-state-in-effect
      // for init, ref-during-render in TipTap-style editors). Inlined
      // here (vs a sibling block) so they inherit this entry's
      // `files:` and `plugins:` scope — codex P1 #327 round 3
      // caught the standalone block referencing react-hooks/* rules
      // without a scope, breaking ESLint on .js files of React
      // consumers (where the plugin isn't loaded for that glob).
      // React Compiler adopters override locally back to "error".
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
    },
    settings: {
      react: { version: "detect" },
    },
  },

  // jsx_in_js variant — an ADDITIONAL React rule entry whose files
  // glob includes `.js` so repos that babel-/vite-transpile JSX in
  // plain `.js` files (e.g., device-platform-reporting, friends-and-
  // family-billing) lint those files under the React rule set.
  // Renders alongside the default `**/*.{jsx,tsx}` block above for
  // React consumers that opt in; eslint flat-config merges rules
  // across overlapping globs so the .js files inherit the React
  // rules via this second entry. Setting jsx_in_js: true on a
  // non-React consumer is a manifest misconfiguration — this block
  // would reference undeclared `react`/`reactHooks` and the
  // rendered config would fail to load.
  {
    files: ["**/*.{js,jsx,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      // React Compiler advisories — disabled by default because they
      // only fire usefully once the React Compiler is adopted; until
      // then they're noisy on idiomatic React (set-state-in-effect
      // for init, ref-during-render in TipTap-style editors). Inlined
      // here (vs a sibling block) so they inherit this entry's
      // `files:` and `plugins:` scope — codex P1 #327 round 3
      // caught the standalone block referencing react-hooks/* rules
      // without a scope, breaking ESLint on .js files of React
      // consumers (where the plugin isn't loaded for that glob).
      // React Compiler adopters override locally back to "error".
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
    },
    settings: {
      react: { version: "detect" },
    },
  },

// React Compiler advisory disables are now INSIDE the React block(s)
// above (so they inherit the same `files:` and `plugins:` scope and
// don't reference react-hooks/* on files where the plugin isn't
// loaded — codex P1 #327 round 3). The standalone block previously
// at this position has been removed.

  // Vitest globals — applied to common test file patterns. Without
  // this block, `describe`/`it`/`expect`/`vi`/etc. trigger no-undef
  // in every test file. Pattern covers __tests__ dirs and *.test.*
  // files; broaden per-consumer if test helpers live elsewhere.
  {
    files: ["tests/**", "**/__tests__/**", "**/*.test.{js,jsx,mjs,ts,tsx}"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        vi: "readonly",
      },
    },
  },

];
