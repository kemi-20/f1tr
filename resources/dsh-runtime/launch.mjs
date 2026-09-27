// Electron 32's Node supports DSH's selected runtime, but not import.meta.main.
// Importing the pinned CLI and explicitly calling its export also avoids loading
// any application GUI when ELECTRON_RUN_AS_NODE is set by the trusted host.
import { runCli } from './node_modules/@deepseek-ai/dsh/lib/bin.js'

await runCli()
