<!-- SPDX-License-Identifier: MIT -->
# Structured logging

`createLogger(component, { sink, clock })` exposes `debug`, `info`, `warn` and
`error`. Each method takes a stable event name, an optional message and optional
structured context. Each diagnostic is one JSON line with `timestamp`, `level`,
`component` and `event`. Debug/info use stdout; warn/error use stderr.

```ts
const logger = createLogger('keeper', {
  clock: () => sharedClock.toISOString(),
  sink: (line, level) => captured.push({ line, level }),
});
logger.info('round-settled', 'Settlement completed', { roundId: 42n });
```

Errors (including causes), bigint, arrays, nested objects and cycles are safe to
serialize. Accessors are not invoked. Sensitive key names are recursively redacted,
as are URL credentials, token query parameters, authorization strings, Stellar
secret seeds and PEM private keys. Keep secrets in named context fields, never
interpolate arbitrary secrets into messages. A failing sink cannot change a
command's exit status. The default clock also works for plain Node operational
scripts without a TypeScript loader.

KeeperStore accepts a logger as its second constructor argument; checkHealth
accepts one after its clock; status-server configuration accepts `logger`; and
writeDemoTrace accepts an optional logger after the trace. Existing callback-based
keeper and agent diagnostics remain injectable.

Receipt CLI `--json` results remain raw machine-readable data, written through
`writeData`; they are not diagnostic records and retain their existing schema.
Other diagnostic output is now JSONL, with the previous human text in `message`.
Consumers of human diagnostics should parse each line before inspecting fields.
Exit codes and stdout/stderr routing remain unchanged.

`pnpm logging:test` validates serialization, routing, redaction and the repository
guard. `pnpm logging:check` runs the guard alone. CI runs both before coverage.
The guard scans packages, services, web, operational scripts and workflow files.
It excludes dependencies/build directories, test files, generated round bindings,
and this package's sole transport implementation. Literal bracket calls are
checked as well as direct property calls. It is a source guard, not a JavaScript
alias/data-flow analyzer; do not alias console to bypass it.

See [migration inventory](../../../docs/LOGGING_MIGRATION.md) for the call sites,
components, events, levels and command-data exceptions.
