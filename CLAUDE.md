# tree-sitter-hvp — developer map

Read `../MIGRATION.md` first — it has the target architecture, phase checklist,
decisions log, and "resume here" state for the whole multi-repo split this package is
part of. This repo is Phase 6, promoted from "optional/later" to required-next because
Phase 5's spike found Zed's extension API has no LSP-only language-registration path —
`zed-hvp` cannot exist without a real tree-sitter grammar to point at.

Full HVP language spec: `../hvp-documentation/Using the HVP Language.md`.
Real-world usage corpus: `../mipi_dphy.hvp` (2554 lines) — parses clean, zero `ERROR`
nodes, see "Verification" below.

**Status: Phase 6 done.**

## Architecture

- `grammar.js` — the grammar. Top level (`source_file`) is a sequence of `plan_block`,
  `override_block`, `filter_block`, or `until_block` — real HVP files put plan-modifier
  blocks (`override`/`filter`/`until`) either in their own "modifier file" (per the
  language doc's framing) or nested inside `plan`/`endplan`
  (`../hvp-language-server/test/fixtures/valid-blocks.hvp` does the latter), and
  `hvp-language-server/src/core/blockAnalysis.ts` treats all 7 block pairs as one
  generic stack regardless of position — so both are accepted here rather than the
  grammar picking one and rejecting the other.
- Each of the 7 block-pair keywords (`plan`/`feature`/`metric`/`measure`/`override`/
  `filter`/`until`) gets its own rule (`plan_block`, `feature_block`, ...). `until` is
  the odd one out: `until_block` has `repeat($.elseuntil_clause)` then
  `optional($.else_clause)` inside it (not a separate pair) — only `until`/`enduntil`
  touch the "stack," matching how `blockAnalysis.ts` treats `elseuntil`/`else` as
  branches within the same frame, not their own opens/closes.
- Assignments (`assignment_statement`, `target: (path) = value: (_expression)`) are the
  single rule behind attribute-value specs, annotation-value specs, and goal overrides
  (`weight = 3;`, `Group = Group >= 0.8;`, `myplan.DVD_RW.Line = Line > 85%;`) — the
  language doc gives these different names but identical syntax, so one rule covers all
  three.
- `path` (`identifier ('.' identifier)*`) is built from repeated `identifier` nodes
  rather than a single dotted-name token, so each segment highlights on its own and
  `queries/highlights.scm` doesn't need a special case for dotted vs. bare names.
- `_expression` implements the "Goal Specification" section's operator-precedence table
  verbatim: `* /` (tightest) > `+ -` > comparisons (`== != >= <= > <`) > `!` > `&&` >
  `||` (loosest). No function-call expressions (`match(...)`) — the language doc lists
  that as an example of syntax Verification Planner explicitly does **not** support, so
  it's left to fall into `ERROR` recovery rather than given a grammar rule.
- String content is deliberately **not** matched one character at a time
  (`/[^"\\$]+/`, a multi-char run, not `/[^"\\$]/`). See the comment on
  `_string_content` in `grammar.js` — matching one char per `repeat()` iteration would
  create a token boundary at every character, which is exactly the gap `extras`
  (specifically `comment`) could slip into and split a string like `"module: top.dut //
  not a real comment"` in half. This is what
  `../hvp-language-server/test/fixtures/keywords-in-strings-comments.hvp` exists to
  catch, and it parses clean.
- `queries/highlights.scm` maps node types to tree-sitter's standard capture names
  (`@keyword`, `@string`, `@comment`, `@number`, `@property`, `@function`, `@type`,
  `@variable`, `@operator`, `@punctuation.*`, ...) — see the file's own header comment
  for the pattern-ordering rule this depends on (general/fallback patterns first,
  specific structural overrides last — confirmed against
  `tree-sitter/crates/highlight/src/highlight.rs`'s `HighlightIter`, which keeps
  overwriting the active capture with each *later* pattern that matches the exact same
  node, i.e. last-match-for-a-node wins, not first).

## Design decisions not obvious from the language doc

See `../MIGRATION.md`'s Decisions log (2026-08-12, Phase 6 entries) for the full list —
summarized here for quick reference:

- `set` (an attribute-type per the doc's BNF) is treated as a bare type keyword like
  `integer`/`real`/`string`, not a bracketed `set{...}` like `enum`. The language doc
  never shows an example of `set` in use, and the real-world corpus (`../mipi_dphy.hvp`)
  doesn't use it either, so this is a guess, not a verified shape.
- `until`/`elseuntil`/`else` bodies accept bare `assignment_statement`s directly, not
  just `override_block`/`filter_block` as the doc's BNF states (`override-specification
  | filter-specification`) — `valid-blocks.hvp`'s fixture uses bare assignments
  (`Priority = 1;`) directly inside `until`, so the grammar follows the real fixture
  over the letter of the BNF.
- `elseuntil_clause` is `repeat()`, not `optional()` — the doc's example shows only one,
  but nothing rules out a project having several time-boundary milestones chained
  together, and being permissive here costs nothing.
- Multi-language tree-sitter bindings (`bindings/{node,rust,python,go,swift,c,zig}`,
  `binding.gyp`, `Cargo.toml`, etc.) that `tree-sitter init` normally scaffolds were
  **not** created. Nothing in this phase or in how Zed consumes a grammar repository
  needs them — Zed builds directly from `grammar.js`/`src/parser.c` via its own
  extension pipeline, not via a published npm/crates.io/PyPI binding. Add them later if
  a real Node/Rust/etc. consumer needs one.
- `tree-sitter init`'s interactive wizard could not run in this environment (it hard
  errors with "not a terminal" outside a real TTY, and there was no way to fake one that
  actually completed the prompt flow here) — `package.json`/`tree-sitter.json` were
  hand-written instead, using the exact templates extracted from the installed
  `tree-sitter-cli` binary (`strings` on `node_modules/tree-sitter-cli/tree-sitter`) plus
  the published `config.schema.json`/a real-world example (`tree-sitter-tcl`'s
  `tree-sitter.json`) fetched to confirm the schema, so the result matches what `init`
  would have produced.

## Testing

- `test/corpus/*.txt` — 11 tests across 9 files (`plan.txt`, `feature.txt`,
  `metric.txt`, `measure.txt`, `override.txt`, `filter.txt`, `until.txt`,
  `comments_and_strings.txt`, `expressions.txt`), one file per language feature area.
  Covers all 7 block pairs, the `until`/`elseuntil`/`else` 3-way branch, enum and
  aggregate (with per-submetric `weight`) metric types, multi-metric/multi-source
  `measure`, full hierarchical-path `override` assignments, `filter`'s `keep`/`remove
  ... where`, comments (including block-keyword lookalikes inside strings/comments,
  the same case `keywords-in-strings-comments.hvp` covers), `${...}` string
  interpolation, and goal-expression operator precedence. `npm test` runs all of them.
- Real-world confidence check: `npx tree-sitter parse ../mipi_dphy.hvp --stat` — the
  full 2554-line file parses with **zero** `ERROR`/`MISSING` nodes. This file only
  exercises `plan`/`feature`/`measure`/`attribute`/`annotation`/`source`/`weight`/
  `apply` in practice (no `metric`/`override`/`filter`/`until`/`subplan`), so the corpus
  tests above are what actually cover those.
- `../hvp-language-server/test/fixtures/*.hvp` were also parsed directly (not as
  corpus tests, since several are deliberately invalid HVP used to test the LSP
  server's diagnostics, not the grammar): the valid ones parse clean, and the invalid
  ones (`mismatched-close.hvp`, `orphan-close.hvp`, `unclosed-eof.hvp`,
  `missing-semicolon.hvp`) correctly produce `ERROR`/`MISSING` nodes rather than
  crashing or silently accepting garbage — this grammar doesn't try to diagnose *why*
  they're invalid (that's `analyzeBlocks()`'s job), just to degrade gracefully.

## Not done here

- Publishing (npm, or any tree-sitter grammar registry) — deliberately deferred to a
  human, same pattern as every other phase in this migration.
- Wiring this grammar into `zed-hvp/extension.toml`'s `[grammars]` entry and
  `languages/hvp/config.toml`'s `grammar` field, and building the rest of `zed-hvp` —
  that's Phase 5 (resumed), out of scope for this repo. See `../MIGRATION.md`.
- Replacing `hvp-language-server/src/core/blockAnalysis.ts`'s regex-based block
  scanning with this grammar — explicitly out of scope per the plan, a longer-term
  possibility at most.
