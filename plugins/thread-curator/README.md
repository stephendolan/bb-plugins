# Thread Curator

Thread Curator turns BB's active thread list into a live map of the work in
progress. It combines the useful parts of T3 Sidebar and Thread Namer so one
small hidden Luna turn can update eligible thread names and the complete
category layout together.

## Behavior

- Parent threads are grouped into concise, model-created workstreams rather
  than filtered by project.
- Categories may merge, split, rename, and reorder as the active workload
  changes. Existing categories are included in each prompt to discourage
  needless churn.
- Thread cards keep T3 Sidebar's stable created-at ordering, status slots,
  settle/snooze shelves, context menu, and collapsed child-thread pills.
- Pinned threads remain in a fixed section above the dynamic groups.
- The first useful idle state of a new parent thread schedules a curation pass.
  Eligible naming work is batched into that same pass.
- Workers are hidden, reuse an existing environment, run with the provider's
  least privileged permission mode, and are stopped and deleted on every path.
- A failed pass leaves the last good category map on screen.

The prompt sends only compact thread metadata for grouping. It refers to
threads by integer index, including in the answer, so a busy sidebar does not
spend tokens repeating long thread IDs. Conversation excerpts are sent only
for threads that are actually eligible for naming. Settled and currently
snoozed parents are omitted entirely because their fixed shelves do not need
model-generated categories.

## Defaults

- Model: `gpt-5.6-luna`
- Reasoning: `high`
- Naming: keep plugin-written names current; never overwrite a human name
- Name length: 32 characters
- Curation: automatic

Change these in **Settings → Plugins → Thread Curator**. The sidebar also has a
manual refresh button, and each thread header has a combined rename/refresh
button.

## CLI

```sh
bb thread-curator refresh
bb thread-curator rename [<threadId>]
bb thread-curator status
```

## Development

```sh
npm install
npm run check
bb plugin install .
```

Select **Thread Curator** under **Settings → Appearance → Sidebar** after
installation. Disable T3 Sidebar and Thread Namer when using the combined
plugin so only one sidebar replacement and one naming worker are active.

## Credits

The thread-card, lifecycle, and child-thread interactions are adapted from
[T3 Sidebar](https://github.com/SawyerHood/bb-plugin-t3sidebar). The naming
policy and hidden-worker lifecycle are adapted from
[Thread Namer](https://github.com/suiramdev/bb-plugin-thread-namer). Both are
MIT-licensed; their notices are preserved in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## License

MIT
