/**
 * @file HVP (Hierarchical Verification Plan) grammar for tree-sitter
 * @license MIT
 *
 * HVP is line-oriented with seven bracket-like block-pair keywords
 * (plan/endplan, feature/endfeature, metric/endmetric, measure/endmeasure,
 * override/endoverride, filter/endfilter, until/enduntil, where until is a
 * 3-way branch with elseuntil/else) — see ../hvp-language-server/src/core/keywords.ts,
 * the source of truth this grammar mirrors, and ../MIGRATION.md for context.
 *
 * This grammar deliberately does not enforce every semantic rule the LSP
 * server's analyzeBlocks() already checks (mismatched/orphan/unclosed blocks,
 * which block kind may nest where). It just needs to turn valid and
 * near-valid HVP into a sensible parse tree for syntax highlighting; tree-sitter's
 * built-in error recovery handles the rest.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: 'hvp',

  extras: ($) => [/\s/, $.comment],

  word: ($) => $.identifier,

  rules: {
    source_file: ($) => repeat($._top_level_item),

    // Real-world HVP files put override/filter/until "plan modifier" blocks
    // either outside a plan entirely (their own modifier file, per the
    // language doc) or nested inside plan...endplan (as
    // hvp-language-server/test/fixtures/valid-blocks.hvp does) — both are
    // accepted here since blockAnalysis.ts treats all 7 block pairs as a
    // single generic stack regardless of position, not a strict grammar.
    _top_level_item: ($) => choice($.plan_block, $.override_block, $.filter_block, $.until_block),

    // ------------------------------------------------------------------
    // Comments
    // ------------------------------------------------------------------
    comment: ($) =>
      token(
        choice(seq('//', /[^\n\r]*/), seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'))
      ),

    // ------------------------------------------------------------------
    // Lexical primitives
    // ------------------------------------------------------------------
    identifier: (_$) => /[A-Za-z_]\w*/,

    // Dotted names: metric-name.enum-member ("test.fail"), full override
    // paths ("myplan.DVD_RW.Line"), qualified metric references
    // ("test.percent.pass"). Built from repeated `identifier` nodes (rather
    // than a single dotted-name token) so each segment highlights on its own.
    path: ($) => seq($.identifier, repeat(seq('.', $.identifier))),

    date: (_$) => /\d{1,2}-\d{1,2}-\d{4}/,

    integer: (_$) => /\d+/,
    float: (_$) => /\d+\.\d+/,
    percent: (_$) => /\d+(\.\d+)?%/,
    number: ($) => choice($.percent, $.float, $.integer),

    string: ($) => seq('"', repeat(choice($._string_content, $.escape_sequence, $.interpolation)), token.immediate('"')),
    // A maximal run of plain characters, not one char at a time: keeping
    // this a single multi-char token (instead of matching one character per
    // repeat() iteration) avoids creating a token boundary at every
    // character, which is what would let `extras` (specifically `comment`)
    // get parsed out of the *middle* of a string like
    // `"module: top.dut // not a real comment"` — see
    // hvp-language-server/test/fixtures/keywords-in-strings-comments.hvp.
    // prec(1) also outranks comment's default precedence in case a boundary
    // does land right at a `//`/`/*`.
    _string_content: (_$) => token.immediate(prec(1, /[^"\\$]+|\$/)),
    escape_sequence: (_$) => token.immediate(/\\./),
    // `${identifier}` substitution inside strings, e.g. source =
    // "instance: ${root_mod}level2" — see "Using Attributes in Source
    // Specifications" in the language doc.
    interpolation: ($) => seq(token.immediate('${'), token.immediate(/[A-Za-z_]\w*/), token.immediate('}')),

    // ------------------------------------------------------------------
    // Types (attribute-type / metric-type / annotation-type)
    // ------------------------------------------------------------------
    // integer/real/string/set/ratio/percent are used bare; enum and
    // aggregate carry a bracketed member list and get their own rules below.
    // The language doc doesn't fully specify whether `set` ever takes a
    // bracketed value list like `enum` does (no example in the corpus) —
    // treated as bare for now, see MIGRATION.md Decisions log.
    _type: ($) => choice($.type_keyword, $.enum_type, $.aggregate_type),
    type_keyword: (_$) => choice('integer', 'real', 'string', 'set', 'ratio', 'percent'),

    enum_type: ($) => seq('enum', '{', $.enum_member, repeat(seq(',', $.enum_member)), '}'),
    // enum-identifier ::= identifier | INT | SNUM (signed number) per the BNF.
    enum_member: ($) => choice($.identifier, seq(optional('-'), $.integer)),

    // metric aggregate{Line(weight=1.0), Cond(weight=2.0)} MyAgg; — see
    // "Adjusting Weight in a User-Defined Aggregate Metric".
    aggregate_type: ($) => seq('aggregate', '{', $.aggregate_member, repeat(seq(',', $.aggregate_member)), '}'),
    aggregate_member: ($) =>
      seq(field('name', $.identifier), optional(seq('(', 'weight', '=', field('weight', $.number), ')'))),

    // ------------------------------------------------------------------
    // plan / endplan
    // ------------------------------------------------------------------
    plan_block: ($) =>
      seq('plan', field('name', $.identifier), ';', repeat($._plan_item), 'endplan'),

    _plan_item: ($) =>
      choice(
        $.attribute_declaration,
        $.annotation_declaration,
        $.metric_block,
        $.feature_block,
        $.subplan_statement,
        $.override_block,
        $.filter_block,
        $.until_block
      ),

    attribute_declaration: ($) =>
      seq('attribute', field('type', $._type), field('name', $.identifier), '=', field('value', $._expression), ';'),
    annotation_declaration: ($) =>
      seq('annotation', field('type', $._type), field('name', $.identifier), '=', field('value', $._expression), ';'),

    subplan_statement: ($) =>
      seq(
        'subplan',
        field('name', $.identifier),
        optional(seq('#', '(', $.subplan_parameter, repeat(seq(',', $.subplan_parameter)), ')')),
        ';'
      ),
    subplan_parameter: ($) => seq(field('name', $.identifier), '=', field('value', $._expression)),

    // ------------------------------------------------------------------
    // feature / endfeature
    // ------------------------------------------------------------------
    feature_block: ($) =>
      seq('feature', field('name', $.identifier), ';', repeat($._feature_item), 'endfeature'),

    _feature_item: ($) =>
      choice(
        $.feature_block,
        $.measure_block,
        $.subplan_statement,
        $.attribute_declaration,
        $.annotation_declaration,
        $.assignment_statement
      ),

    // Covers attribute/annotation value specs ("weight = 3;"), goal
    // overrides ("Group = Group >= 0.8;"), and full-path override
    // assignments ("myplan.DVD_RW.Line = Line > 85%;").
    assignment_statement: ($) => seq(field('target', $.path), '=', field('value', $._expression), ';'),

    // ------------------------------------------------------------------
    // metric / endmetric
    // ------------------------------------------------------------------
    metric_block: ($) =>
      seq('metric', field('type', $._type), field('name', $.identifier), ';', repeat($._metric_item), 'endmetric'),

    _metric_item: ($) => choice($.goal_statement, $.aggregator_statement, $.apply_statement, $.assignment_statement),

    goal_statement: ($) => seq('goal', '=', field('value', $._expression), ';'),
    aggregator_statement: ($) => seq('aggregator', '=', field('value', $.identifier), ';'),
    // aggregate-metric apply mode (e.g. "apply = explicit;")
    apply_statement: ($) => seq('apply', '=', field('value', $.identifier), ';'),

    // ------------------------------------------------------------------
    // measure / endmeasure
    // ------------------------------------------------------------------
    measure_block: ($) =>
      seq(
        'measure',
        field('metrics', $.metric_reference_list),
        field('name', $.identifier),
        ';',
        repeat($._measure_item),
        'endmeasure'
      ),
    metric_reference_list: ($) => seq($.path, repeat(seq(',', $.path))),

    _measure_item: ($) => choice($.source_statement, $.assignment_statement),
    source_statement: ($) => seq('source', '=', field('value', $.source_list), ';'),
    source_list: ($) => seq($.string, repeat(seq(',', $.string))),

    // ------------------------------------------------------------------
    // override / endoverride
    // ------------------------------------------------------------------
    override_block: ($) =>
      seq('override', field('name', $.identifier), ';', repeat($.assignment_statement), 'endoverride'),

    // ------------------------------------------------------------------
    // filter / endfilter
    // ------------------------------------------------------------------
    filter_block: ($) =>
      seq('filter', field('name', $.identifier), ';', repeat($.filter_statement), 'endfilter'),

    filter_statement: ($) =>
      seq(field('action', choice('keep', 'remove')), 'feature', 'where', field('condition', $._expression), ';'),

    // ------------------------------------------------------------------
    // until / elseuntil / else / enduntil — a 3-way branch, not a simple
    // pair: only `until` opens a frame and only `enduntil` closes it;
    // `elseuntil`/`else` are branches *within* that frame. Body items are
    // documented as override-specification | filter-specification, but
    // hvp-language-server/test/fixtures/valid-blocks.hvp shows bare
    // assignments directly inside until/elseuntil/else too, so both are
    // accepted.
    // ------------------------------------------------------------------
    until_block: ($) =>
      seq(
        'until',
        field('date', $.date),
        ';',
        repeat($._until_item),
        repeat($.elseuntil_clause),
        optional($.else_clause),
        'enduntil'
      ),
    elseuntil_clause: ($) => seq('elseuntil', field('date', $.date), ';', repeat($._until_item)),
    else_clause: ($) => seq('else', ';', repeat($._until_item)),
    _until_item: ($) => choice($.override_block, $.filter_block, $.assignment_statement),

    // ------------------------------------------------------------------
    // Expressions — goal/filter/override-value expressions. Precedence
    // follows the "Goal Specification" section's operator-precedence table
    // (highest to lowest: * / , + - , comparisons, ! , && , ||).
    // ------------------------------------------------------------------
    _expression: ($) =>
      choice($.number, $.string, $.path, $.parenthesized_expression, $.unary_expression, $.binary_expression),

    parenthesized_expression: ($) => seq('(', $._expression, ')'),

    unary_expression: ($) => prec(3, seq('!', $._expression)),

    binary_expression: ($) =>
      choice(
        prec.left(6, seq($._expression, field('operator', choice('*', '/')), $._expression)),
        prec.left(5, seq($._expression, field('operator', choice('+', '-')), $._expression)),
        prec.left(
          4,
          seq($._expression, field('operator', choice('==', '!=', '>=', '<=', '>', '<')), $._expression)
        ),
        prec.left(2, seq($._expression, field('operator', '&&'), $._expression)),
        prec.left(1, seq($._expression, field('operator', '||'), $._expression))
      ),
  },
});
