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
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      ".astro/**",
      ".next/**",
      ".vercel/**",
      // CONSUMER-LOCAL: ffb's Vite output goes to app/assets/
      // (hashed bundle filenames) and the assembled deploy lands
      // at app/. These are build artifacts, not source; linting
      // them produces hundreds of false-positive findings on the
      // minified output. Ignoring the whole `app/` tree (the
      // Vite/esbuild assemble output) is the standard consumer-
      // local customization for repos with non-default build
      // output paths. The mergepath template covers the common
      // `dist/`/`build/` defaults; per-repo overrides land here.
      "app/**",
      // CONSUMER-LOCAL: legacy IIFE build at repo root from
      // `build:legacy` (esbuild → script.js). Same rationale.
      "script.js",
    ],
  },

  // Baseline JS recommended — required by the Mergepath policy floor.
  js.configs.recommended,

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

  // ─────────────────────────────────────────────────────────────────
  // CONSUMER-LOCAL OVERRIDE — legacy CDN-loaded Firebase globals.
  //
  // ffb's legacy top-level scripts (auth.js, firebase-config.js,
  // site/script.js) AND some src/ React code reference `firebase`,
  // `auth`, and `analytics` as globals — they're loaded by
  // <script> tags in index.html rather than imported per-module.
  // Declaring them here keeps lint quiet without forcing a
  // refactor to import-style; modernization can land separately.
  // `user` is a similar CDN global used in a few legacy code
  // paths.
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      globals: {
        firebase: "readonly",
        auth: "readonly",
        analytics: "readonly",
        user: "readonly",
      },
    },
  },



  // React + React Hooks recommended rulesets — applied to .jsx / .tsx.
  // Detect the React version automatically from package.json. The
  // React 17+ JSX transform makes `react/react-in-jsx-scope` obsolete;
  // turn it off explicitly so the rule doesn't flag every component.
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
    },
    settings: {
      react: { version: "detect" },
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // CONSUMER-LOCAL POLICY — React-rule overrides. MUST be LAST.
  //
  // Same policy as device-platform-reporting#83 — ffb doesn't use
  // propTypes (Vite + modern React) and `no-unescaped-entities`
  // is mostly cosmetic noise. The two react-hooks advisories
  // (set-state-in-effect + preserve-manual-memoization) are
  // turned off because the codebase uses setState-in-effect
  // intentionally for initialization (7 occurrences across pages)
  // and hasn't adopted the React Compiler's manual-memoization
  // contract.
  {
    files: ["**/*.{js,jsx,tsx}"],
    rules: {
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      // Additional React Compiler advisories not in dpr's list —
      // ffb's TipTap editor integration uses refs-during-render
      // intentionally (4 sites in TemplateEditor + RichTextEditor)
      // and has an immutability false-positive on a test helper.
      // Same policy class: these are React Compiler hints, not
      // runtime bugs. TODO: revisit when adopting the Compiler.
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      // CONSUMER-LOCAL: underscore-prefix convention for intentionally
      // unused vars / args / caught errors. Standard ESLint idiom
      // (`function (_, value) { ... }`, `catch (_e) {}`). 40+ sites
      // across src/main.js + src/app/. Allowing the convention is
      // cheaper than adding 40 disable comments.
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
      // CONSUMER-LOCAL: `catch (_) {}` swallow-pattern is intentional
      // in the legacy script.js compile-source — same rationale as
      // the unused-vars relax. allowEmptyCatch matches that idiom.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // CONSUMER-LOCAL OVERRIDE — vitest globals for test files.
  // Placed AFTER the React block so flat-config languageOptions
  // merge (rather than getting shadowed by the React block which
  // matches all .js — see #318 for the equivalent dpr fix). ffb
  // uses vitest (not jest); same template gap tracked as a
  // mergepath follow-up for `facts.testing: jest|vitest|none|mocha`.
  //
  // Pattern covers test files AND test helpers under tests/ (e.g.
  // tests/react/helpers/*.js use `vi.fn()` to build shared mocks).
  // Without the broader tests/** match, helpers trip no-undef on
  // `vi` even though they're only ever imported from test files.
  {
    files: [
      "**/__tests__/**",
      "**/*.test.{js,jsx,mjs}",
      "tests/**/*.{js,jsx,mjs}",
    ],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
];
