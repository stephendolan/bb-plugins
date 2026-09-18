---
name: jev-classification
description: Classify, route, score, or filter with the jev_classify tool and the bb jev CLI. Use when a judgment repeats across many items, when a decision needs a probability rather than prose, or when configuring or checking the Jev plugin's API key and model.
---

# Jev classification

Jev answers typed questions about one state and returns calibrated
probabilities. It never writes prose, so it costs a fraction of a model turn
and returns in well under a second.

## Reach for it when

- The same judgment repeats across many items: triage, routing, labeling,
  relevance filtering, rubric grading.
- A threshold matters more than an explanation — you want `p >= 0.9`, not a
  paragraph.
- The possible answers are known before the call.

## Do not reach for it when

- You need generated text, code, or a written rationale.
- The decision happens once and you can simply make it yourself.
- The answer set is open-ended.

## Asking good questions

Send one state and a map of named questions. Every question is evaluated
against that same state in a single request, so group related judgments rather
than making several calls.

- `choice` — declare each option and what it means. Descriptions do the work;
  option names alone are usually too terse.
- `score` — give two to ten ordered levels, lowest first. The answer is a
  fractional position, so `1.6` sits between your second and third level.
- `boolean` — state the proposition plainly. The answer is P(true), not
  confidence in either outcome.

An array state counts as one state, not a batch. Classify separate items with
separate calls.

## Reading the answers

`choice` and `score` carry a full probability distribution and a TypeSafe
confidence value; `boolean` carries only P(true). Treat all of them as
estimates: check a threshold against labeled examples from the actual workflow
before automating on it. When the winning probability is close to the
runner-up, fall back to your own judgment.

A `score` is the probability-weighted mean of the distribution, not the single
most likely level, and the two disagree whenever the distribution is spread.
`nearestLevel` labels the mean, so read `probabilities` before quoting it —
a score of `1.46` can carry most of its mass on level `2`. Low `confidence` is
the signal that this is happening.

## Commands

```sh
bb jev status    # routing, model, and where the API key comes from
bb jev check     # one live probe that confirms the key and model work
bb jev classify --state <text> --questions <json> [--json]
```

`bb jev classify` takes the same shape as the tool:

```sh
bb jev classify \
  --state 'I was charged twice. Please refund the extra charge.' \
  --questions '{"department":{"type":"choice","instructions":"Which team should handle this?","criteria":{"billing":"Charges and refunds","support":"Everything else"}}}'
```

## Configuration

Settings live under `bb plugin config jev`:

- `apiKey` (secret) — a TypeSafe key for `typesafe` routing, or a Vercel AI
  Gateway key for `gateway` routing. Falls back to `TYPESAFE_AI_API_KEY` or
  `AI_GATEWAY_API_KEY` in the bb server's environment.
- `routing` — `typesafe` calls TypeSafe directly; `gateway` bills through
  Vercel AI Gateway.
- `model` — defaults to `jev-latest`. That alias moves when TypeSafe ships a
  release, so pin a versioned id once thresholds are tuned. Under `gateway`
  routing an unqualified id is prefixed with `typesafe-ai/`.

If a call fails with a missing-key error, run `bb jev status` to see which
source the plugin is reading from.
