# Todo

Designs written down before they are built, because they are load-bearing enough
that getting the shape wrong would be expensive to unpick.

A file here is a decision record, not a wish list. It states what the thing is,
what it refuses to do and why, and what would build on it. When one is built, the
design moves into the code's own documentation and the file goes.

| | |
|---|---|
| [source-editing.md](./source-editing.md) | Changing a declared value in the panel and having it land in the user's TypeScript. Underneath it, the locate-and-splice layer that lint quick-fixes and any future codemod would share. |
| [event-log.md](./event-log.md) | The raw trace stream per phase in the studio, filterable by agent. What turns "something went wrong" into "here is what happened". |
