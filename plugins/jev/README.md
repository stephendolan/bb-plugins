# Jev

Gives BB agents a native classification tool backed by
[TypeSafe's Jev](https://typesafe.ai) evaluation model.

Jev answers typed questions about a piece of state and returns calibrated
probabilities rather than prose. Agents reach for it when a judgment repeats
across many items — triage, routing, labeling, relevance filtering, rubric
grading — instead of burning a reasoning turn on each one.

```
bb plugin install ./plugins/jev
bb plugin config jev set apiKey <your-typesafe-key>
bb jev check
```

## The agent tool

`jev_classify` takes one state and a map of named questions, and answers all of
them in a single request:

| Question type | You declare | You get back |
| --- | --- | --- |
| `choice` | A map of option names to descriptions | The selected option, its probability, the full distribution, and TypeSafe's confidence |
| `score` | Two to ten ordered level descriptions | A fractional position in the rubric, its nearest level, the distribution, and confidence |
| `boolean` | A proposition, optionally with descriptions of each outcome | P(true) |

An array state is one state, not a batch — classify separate items with
separate calls.

The plugin also ships a skill telling agents when Jev is the right tool and how
to read the probabilities it returns.

## CLI

```sh
bb jev status    # routing, model, and where the API key comes from
bb jev check     # one live probe confirming the key and model work
bb jev classify --state <text> --questions <json> [--json]
```

```sh
bb jev classify \
  --state 'I was charged twice. Please refund the extra charge.' \
  --questions '{"department":{"type":"choice","instructions":"Which team should handle this?","criteria":{"billing":"Charges and refunds","support":"Everything else"}}}'
```

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| `apiKey` | — | Secret. A TypeSafe key for `typesafe` routing, a Vercel AI Gateway key for `gateway`. Falls back to `TYPESAFE_AI_API_KEY` or `AI_GATEWAY_API_KEY` in the bb server's environment. |
| `routing` | `typesafe` | `typesafe` calls TypeSafe directly; `gateway` bills through Vercel AI Gateway. |
| `model` | `jev-latest` | Under `gateway` routing an unqualified id is prefixed with `typesafe-ai/`. |

`jev-latest` moves when TypeSafe ships a release, so the same input can return
different probabilities. Pin a versioned model id once thresholds are tuned.

Settings are read per call, so a key or model change applies to the next
classification without a plugin reload.

## Development

```sh
npm run check    # types, typecheck, tests, build
```
