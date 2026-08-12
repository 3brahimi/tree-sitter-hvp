; Highlight query for HVP (Hierarchical Verification Plan).
;
; Uses tree-sitter's standard capture-name conventions (@keyword, @string,
; @comment, @number, @property, @function, @type, @variable, @operator,
; @punctuation.*, ...) so any editor that consumes this grammar (Zed today,
; see ../../MIGRATION.md) gets sensible highlighting without needing
; HVP-specific theme rules.
;
; Ordering: per tree-sitter-highlight's reference resolution (see
; crates/highlight/src/highlight.rs's HighlightIter — when multiple patterns
; match the *exact same node*, the last matching pattern in this file wins),
; general/fallback patterns come first and specific structural overrides
; come last, so e.g. a declaration-name identifier ends up @function even
; though the generic `(identifier) @variable` catch-all also matches it.

; ---------------------------------------------------------------------
; Comments & literals
; ---------------------------------------------------------------------

(comment) @comment

(string) @string
(escape_sequence) @string.escape
(interpolation) @string.special

(number) @number
(date) @number

; ---------------------------------------------------------------------
; Generic identifier fallback — overridden below by more specific,
; structurally-informed captures for the same node.
; ---------------------------------------------------------------------

(identifier) @variable

; ---------------------------------------------------------------------
; Punctuation & operators
; ---------------------------------------------------------------------

"." @punctuation.delimiter
["," ";"] @punctuation.delimiter
["(" ")" "{" "}"] @punctuation.bracket
"#" @punctuation.special

[
  "=" "==" "!=" ">=" "<=" ">" "<"
  "&&" "||" "!"
  "+" "-" "*" "/"
] @operator

; ---------------------------------------------------------------------
; Keywords
; ---------------------------------------------------------------------

; The 7 block-pair keywords (see ../../hvp-language-server/src/core/keywords.ts)
; plus until's elseuntil/else branches and subplan.
[
  "plan" "endplan"
  "feature" "endfeature"
  "metric" "endmetric"
  "measure" "endmeasure"
  "override" "endoverride"
  "filter" "endfilter"
  "until" "elseuntil" "else" "enduntil"
  "subplan"
] @keyword

["attribute" "annotation"] @keyword

["keep" "remove" "where"] @keyword

; ---------------------------------------------------------------------
; Types
; ---------------------------------------------------------------------

(type_keyword) @type
["enum" "aggregate"] @type

; ---------------------------------------------------------------------
; Statement keywords that behave like object fields (mirrors
; tools/gen-grammars.ts's variable.other.property.hvp scope for these).
; ---------------------------------------------------------------------

["goal" "aggregator" "apply" "source" "weight"] @property

; ---------------------------------------------------------------------
; Declaration names (plan/feature/metric/measure/override/filter/subplan) —
; overrides the generic @variable fallback above for these identifiers.
; ---------------------------------------------------------------------

(plan_block name: (identifier) @function)
(feature_block name: (identifier) @function)
(metric_block name: (identifier) @function)
(measure_block name: (identifier) @function)
(override_block name: (identifier) @function)
(filter_block name: (identifier) @function)
(subplan_statement name: (identifier) @function)
(aggregate_member name: (identifier) @variable)

; ---------------------------------------------------------------------
; Assignment / declaration targets — attribute-value, annotation-value and
; goal-override left-hand sides (e.g. `weight = 3;`, `MyLine = MyLine >= 50%;`,
; `myplan.DVD_RW.Line = Line > 85%;`).
; ---------------------------------------------------------------------

(attribute_declaration name: (identifier) @property)
(annotation_declaration name: (identifier) @property)
(subplan_parameter name: (identifier) @property)
(assignment_statement target: (path (identifier) @property))

; ---------------------------------------------------------------------
; Fixed-vocabulary values
; ---------------------------------------------------------------------

(aggregator_statement value: (identifier) @constant)
(apply_statement value: (identifier) @constant)
(enum_member (identifier) @constant)

; Built-in metric names (best-effort match against
; hvp-language-server/src/core/keywords.ts's BUILTIN_METRICS base names —
; same context-free limitation the generated TextMate/sublime-syntax
; grammars already have: it highlights the bare word wherever it appears as
; an identifier, not just in a genuine metric-reference position). Placed
; last so it wins over every other identifier capture above.
((identifier) @type.builtin
  (#any-of? @type.builtin
    "Line" "Cond" "FSM" "Toggle" "Branch" "Assert" "Group" "SnpsAvg" "test" "AssertResult"))
