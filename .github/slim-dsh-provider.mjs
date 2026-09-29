import { build } from 'esbuild'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const runtime = resolve(dirname(fileURLToPath(import.meta.url)), '../resources/dsh-runtime')
const modules = join(runtime, 'node_modules')
const adapter = join(modules, '@deepseek-ai/dsh-llm-pi-ai')
const pi = join(modules, '@earendil-works/pi-ai')
const manifest = JSON.parse(readFileSync(join(adapter, 'package.json'), 'utf8'))
if (manifest.version !== '0.2.0-rc.1' || JSON.parse(readFileSync(join(pi, 'package.json'), 'utf8')).version !== '0.85.1') {
  throw new Error('Provider slimming requires the audited pinned DSH/pi-ai versions')
}
let source = readFileSync(join(adapter, 'lib/index.js'), 'utf8').replaceAll('\r\n', '\n')
function replaceOnce(before, after) {
  if (source.split(before).length !== 2) throw new Error('Pinned provider source changed; review slimming transform')
  source = source.replace(before, after)
}
replaceOnce('import { builtinModels, builtinProviders, getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";',
  'import { createModels as builtinModels } from "f1tr-pi-models";\nconst builtinProviders = () => [];\nconst getBuiltinModels = () => [];\nconst getBuiltinProviders = () => [];')
for (const [symbol, path] of [['anthropicMessagesApi', 'anthropic-messages'], ['openAIResponsesApi', 'openai-responses']]) {
  replaceOnce(`import { ${symbol} } from "@earendil-works/pi-ai/api/${path}.lazy";`, '')
}
replaceOnce('"openai-completions": openAICompletionsApi,\n\t"openai-responses": openAIResponsesApi,\n\t"anthropic-messages": anthropicMessagesApi',
  '"openai-completions": openAICompletionsApi')

// Keep upstream streaming, replay and cancellation logic, but link only its one
// supported wire protocol. DSH services remain external so Cordis has one identity.
const result = await build({
  stdin: { contents: source, resolveDir: adapter, sourcefile: 'f1tr-completions.js', loader: 'js' },
  bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', target: 'node20',
  external: ['@deepseek-ai/*'],
  alias: { 'f1tr-pi-models': join(pi, 'dist/models.js') },
  banner: { js: 'import { createRequire as f1trCreateRequire } from "node:module"; const require = f1trCreateRequire(import.meta.url);' },
  legalComments: 'inline'
})
const inputs = Object.keys(result.metafile.inputs)
if (inputs.some(path => /(?:@anthropic-ai|@aws-sdk|@aws-crypto|@smithy|@google\/genai|bowser|providers\/all|models\.generated|api\/openai-responses|api\/anthropic-messages)/.test(path.replaceAll('\\', '/')))) {
  throw new Error('Unexpected provider or vendor SDK in completions-only output')
}
// Carry licenses of all linked packages even when their original directories go.
const licenses = new Map()
for (const input of inputs) {
  let dir = dirname(resolve(input))
  while (dir.startsWith(modules) && dir !== modules) {
    const file = join(dir, 'package.json')
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8'))
      if (!licenses.has(pkg.name)) {
        const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license'].map(name => join(dir, name)).find(existsSync)
          ?? (['@earendil-works/pi-ai', '@earendil-works/pi-telemetry'].includes(pkg.name) && pkg.version === '0.85.1'
            ? join(runtime, '../dsh-f1-plugin/PI-LICENSE.txt') : undefined)
        if (!license) throw new Error(`Missing license for bundled dependency ${pkg.name}`)
        licenses.set(pkg.name, `${pkg.name}@${pkg.version}\n${readFileSync(license, 'utf8')}`)
      }
      break
    }
    dir = dirname(dir)
  }
}
writeFileSync(join(adapter, 'lib/index.js'), result.outputFiles[0].text)
writeFileSync(join(adapter, 'THIRD_PARTY_LICENSES.txt'), [...licenses.values()].join('\n\n'))
writeFileSync(join(adapter, 'f1tr-slim.json'), JSON.stringify({ version: manifest.version, protocols: ['openai-completions'], packages: [...licenses.keys()], bytes: result.outputFiles[0].contents.length }, null, 2))
console.log(`Completions-only provider: ${result.outputFiles[0].contents.length} bytes, ${licenses.size} linked packages; no other vendor SDKs`)
