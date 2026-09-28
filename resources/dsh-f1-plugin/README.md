# F1TR DSH plugin

This package registers bounded race tools and has no shell, filesystem, generic IPC, or arbitrary method-dispatch tool. Tool imports use the DSH tool API and Node built-ins.

## DSH API

Verified against the immutable `dsh-v0.1.7-rc.2` source. The entry follows the tagged tool-authoring contract: `export const name`, `export const inject = ['tools']`, `apply(ctx)`, `ctx.tools.register(defineTool(...))`, and a required canonical `output` with `schema: { type: 'string' }` and a text renderer. The runtime package peer is pinned to `@deepseek-ai/dsh-tools` `0.1.7-rc.2`.

The DSH parameter root is implicitly open, and its author schema DSL does not express numeric bounds or string-length limits. The plugin therefore rejects unknown keys and validates all ranges and text limits again inside `execute`.

## Staging

CI stages the package's `.mjs` and `.md` files into `resources/dsh-runtime/plugin`. The patch loads `index.mjs` for tools and `bind-preset.mjs` for the native `f1-race-engineer` preset. The binder registers `preset.mjs` through the pinned DSH agent-preset registry; that plugin reads the shipped `race-engineer.md` policy. Missing policy fails startup. Communication preferences are separate from this policy. Node ESM resolution reaches the runtime's pinned dependencies without a plugin-local `node_modules` directory.

## Pipe contract

Each tool invocation opens one local Windows named-pipe connection. The plugin reads `F1TR_BRIDGE_PIPE` and `F1TR_BRIDGE_TOKEN` on every call and fails closed unless the pipe matches `\\.\pipe\<local-name>` and the token is 32 random bytes encoded as 64 hex characters. No default endpoint or token exists.

The request is one UTF-8 JSON line, at most 4,096 bytes:

```json
{"token":"<64 hex chars>","id":"<UUID>","name":"<fixed tool name>","args":{}}
```

The host returns one UTF-8 JSON line with no trailing frame data, at most 65,536 bytes:

```json
{"id":"<same UUID>","ok":true,"result":"<plain text>"}
```

`error`, when present, must be a string no longer than 512 UTF-8 bytes. The plugin requires the matching ID, a boolean `ok`, and a string `result`; it ignores error text and returns a generic failure instead of forwarding it. The rendered tool value is always a plain string and is capped at 60,000 UTF-8 bytes, including an untrusted-data warning. Screenshot results must be vision descriptions as text, never image bytes.

Cancellation is connection-scoped: when DSH aborts `exec.signal`, or the plugin's per-operation deadline expires, the plugin destroys that request's pipe connection. The host must treat peer disconnect as cancellation and stop owned work before releasing its request resources. It must not dispatch an operation before fully reading and authenticating the request.

For per-app isolation, the host must create a dedicated pipe per DSH app instance, restrict the pipe ACL to the intended local user/session, generate a fresh 32-byte token with a cryptographically secure RNG for that instance, and validate the token before returning data or performing actions. Host-side input validation, output bounds, disconnect handling, and per-client `speak_radio` rate limiting remain required; plugin checks are defense in depth, not an authorization boundary for the host.

## Tool arguments and limits

- `get_race_state`: `{ "section": "all|player|rivals|weather|session|trackPositions|events" }`.
- `get_telemetry_history` and `get_lap_history`: required `section`, optional integer `offset` 0-100000 (default 0), optional integer `limit` 1-4 (default 3).
- `read_telemetry_packet`: required `packet` inventory key with packet ID 0-16 and optional `:carIndex` 0-23; optional integer `offset` 0-11 (default 0).
- `capture_screenshot`: `{}`; host returns a bounded vision description as text.
- `speak_radio`: `{ "text": "..." }`; trimmed, non-empty, at most 280 Unicode characters, no control characters, and at most two calls per 10 seconds in this plugin process.
- `get_race_events`: optional integer `offset` 0-8191 (default 0) and `limit` 1-20 (default 20); reads full-weekend event records.
- `get_stint_history`: optional integer `offset` 0-8191 (default 0) and `limit` 1-20 (default 20); reads full-weekend stint records.

The plugin permits at most four in-flight host requests. Telemetry tools use a 5-second deadline, screenshot 45 seconds, and radio 15 seconds. Host-provided telemetry, names, event strings, screenshot descriptions, and acknowledgements are untrusted content; every successful result carries a warning prefix. The host must also enforce the radio quota because the client-side limiter can be bypassed.

The plugin is covered by the repository MIT license. It contains no copied DSH implementation code; DSH retains its own package license.
