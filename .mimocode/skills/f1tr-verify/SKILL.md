---
name: f1tr-verify
description: Run the F1TR Electron app verification gate before committing or after telemetry/reducer changes.
---

# F1TR Verification Gate

Run this gate whenever you touch `src/main/telemetry`, `src/main/state`, `src/main/triggers`, `src/main/engineer`, `src/main/tts`, `src/main/ipc`, or before pushing.

## 1. Static gate

From repo root:

```bash
npm run typecheck
npm test
```

- `npm run typecheck` covers both `tsconfig.node.json` and `tsconfig.web.json`; it must exit with zero errors.
- `npm test` runs the vitest suite; all tests must pass.

If either fails, stop and fix before continuing.

## 2. Build gate

```bash
npx electron-vite build
```

Must produce `out/main`, `out/preload`, and `out/renderer` without errors.

## 3. UDP integration smoke test

Use this when you change UDP receiving, packet parsing, state aggregation, or the trigger engine.

Prerequisites: port `20777` is free and no stale Electron dev process is holding it.

1. Kill stale dev processes:
   - Windows: `taskkill //F //IM electron.exe`
   - Unix: `pkill -f electron`
2. Start dev server in the background and capture logs:
   ```bash
   npx electron-vite dev > /tmp/f1tr-dev.log 2>&1 &
   ```
3. Wait for the log to contain `UDP receiver started` (poll every 0.5 s).
4. Inject a synthetic F1 25 session packet:
   ```bash
   node tests/live-udp-inject.mjs
   ```
5. Inspect the log for:
   - `format detected: 2025` or `2026`
   - No uncaught parser exceptions
   - No runaway dropped-packet warnings
6. Stop the dev process.

## 4. LLM/TTS smoke test (optional)

Use this when you change `LlmClient`, `EngineerService`, `MiMoTtsClient`, or SSE parsing.

```bash
node tests/live-llm.mjs
```

Requires a real `.env` key. Verify streaming output and cache usage.

## Stopping conditions

- All chosen gates pass, or
- A gate fails and you have captured its output to fix.
