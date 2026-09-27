import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'

const runtime = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'dsh-runtime')
const modules = join(runtime, 'node_modules')
const lock = JSON.parse(readFileSync(join(runtime, 'package-lock.json'), 'utf8'))
const entries = lock.packages
if (lock.lockfileVersion !== 3 || !entries || !existsSync(modules)) {
  throw new Error('Pinned DSH installation and lockfile are required before pruning')
}

// dsh and sdk-minimal declare the entire optional plugin catalogue as dependencies.
// These roots cover the CLI boot imports and the enabled sdk-minimal/F1 engineer rows.
const roots = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-sdk-minimal',
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-cmdline',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-http-proxy',
  '@deepseek-ai/dsh-launch-environment',
  '@deepseek-ai/dsh-plugin-manager',
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/dsh-sdk-app',
  '@deepseek-ai/dsh-sdk-jsonrpc-server',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-llm-retry',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-compaction-basic',
  'commander',
  'js-yaml',
  'node-addon-require-builtin'
]

function resolveDependency(from, name, required = true) {
  let parent = from
  while (parent) {
    const candidate = `${parent}/node_modules/${name}`
    if (entries[candidate]) return candidate
    const i = parent.lastIndexOf('/node_modules/')
    parent = i < 0 ? '' : parent.slice(0, i)
  }
  const root = `node_modules/${name}`
  if (entries[root]) return root
  if (required) throw new Error(`Missing pinned DSH dependency: ${name} (required by ${from})`)
  return null
}

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))
function sourceImports(key) {
  const names = new Set()
  const stack = [resolve(runtime, key)]
  while (stack.length) {
    const dir = stack.pop()
    if (!existsSync(dir)) continue
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name === 'node_modules' || item.name === 'types') continue
      const file = join(dir, item.name)
      if (item.isDirectory()) {
        stack.push(file)
      } else if (item.isFile() && /\.[cm]?js$/.test(item.name)) {
        const source = readFileSync(file, 'utf8')
        const pattern = /(?:\b(?:import|export)\s+[^;\n]{0,300}?\s+from\s+|\bimport\s*\(|\brequire\s*\(|\bimport\s+)['"]([^'"]+)['"]/g
        for (const match of source.matchAll(pattern)) {
          const spec = match[1]
          if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('#')) continue
          const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
          if (!builtins.has(name)) names.add(name)
        }
      }
    }
  }
  return names
}

// The private runtime only serves the custom race-gateway route. Remove the
// JSON-RPC server's eager DeepSeek fallback so its adapter packages stay out.
const jsonRpcPath = join(modules, '@deepseek-ai', 'dsh-sdk-jsonrpc-server', 'lib', 'index.js')
let jsonRpcSource = readFileSync(jsonRpcPath, 'utf8')
const deepSeekImport = 'import * as LlmDeepSeek from "@deepseek-ai/dsh-llm-deepseek-api-key";\n'
const deepSeekFallback = 'this.llmFiber = await this.ctx.plugin(LlmDeepSeek);'
const hasDeepSeekImport = jsonRpcSource.includes(deepSeekImport)
const hasDeepSeekFallback = jsonRpcSource.includes(deepSeekFallback)
if (hasDeepSeekImport !== hasDeepSeekFallback) {
  throw new Error('Pinned JSON-RPC DeepSeek fallback is partially changed; review runtime slimming')
}
if (hasDeepSeekImport) {
  jsonRpcSource = jsonRpcSource
    .replace(deepSeekImport, '')
    .replace(deepSeekFallback, 'throw new Error("DeepSeek adapter is not bundled in this runtime");')
  writeFileSync(jsonRpcPath, jsonRpcSource)
}

const kept = new Set()
const importedBy = new Map()
const queue = roots.map((name) => resolveDependency('', name))
while (queue.length) {
  const key = queue.pop()
  if (kept.has(key)) continue
  kept.add(key)
  const meta = entries[key]
  const imports = sourceImports(key)
  // The selected profile supplies its own explicit plugin tree. Do not traverse
  // the CLI/profile package manifests, which list every unrelated DSH feature.
  const catalog = key === 'node_modules/@deepseek-ai/dsh' || key === 'node_modules/@deepseek-ai/dsh-sdk-minimal'
  const slimProvider = key === 'node_modules/@deepseek-ai/dsh-llm-pi-ai'
  if (slimProvider && !existsSync(join(runtime, key, 'f1tr-slim.json'))) {
    throw new Error('Run slim-dsh-provider.mjs before pruning')
  }
  const names = catalog || slimProvider ? imports : new Set([
    ...Object.keys({ ...meta.dependencies, ...meta.optionalDependencies }),
    ...imports
  ])
  for (const name of names) {
    if (key === 'node_modules/@deepseek-ai/dsh-sdk-app' &&
        (name === '@deepseek-ai/dsh-skill-office' || name === '@deepseek-ai/dsh-tool-workspace-dependencies')) continue
    const dependency = resolveDependency(key, name, !catalog && Object.hasOwn(meta.dependencies ?? {}, name))
    if (dependency) {
      if (!importedBy.has(dependency)) importedBy.set(dependency, key)
      queue.push(dependency)
    }
  }
}

if (kept.has('node_modules/@deepseek-ai/dsh-agent-preset')) {
  throw new Error('Unused DSH agent presets must not be packaged')
}
const forbidden = [...kept].filter((key) =>
  /node_modules\/(?:@anthropic-ai\/|@aws-sdk\/|@aws-crypto\/|@smithy\/|@google\/genai$|bowser$|@earendil-works\/pi-ai$|@deepseek-ai\/dsh-llm-deepseek(?:-api-key)?$|@deepseek-ai\/dsh-deepseek-llm-api-extensions$)/.test(key)
)
if (forbidden.length > 0) {
  const chain = (key) => {
    const parts = [key]
    let current = importedBy.get(key)
    while (current && parts.length < 16 && !parts.includes(current)) {
      parts.push(current)
      current = importedBy.get(current)
    }
    return parts.join(' <- ')
  }
  const chains = forbidden.map(chain).join(' | ')
  throw new Error(`Unexpected multi-provider dependency: ${chains}`)
}

// Profile resolution walks dependencies declared by the installed CLI package.
// Narrow that graph to the selected runtime and explicitly expose race-llm.
const cliManifestPath = join(modules, '@deepseek-ai', 'dsh', 'package.json')
const cliManifest = JSON.parse(readFileSync(cliManifestPath, 'utf8'))
if (cliManifest.name !== '@deepseek-ai/dsh' || cliManifest.version !== '0.1.7-rc.2') {
  throw new Error('Unexpected DSH CLI package; refusing to rewrite its runtime graph')
}
cliManifest.dependencies = Object.fromEntries(roots
  .filter((name) => name !== '@deepseek-ai/dsh')
  .map((name) => [name, entries[resolveDependency('', name)].version]))
writeFileSync(cliManifestPath, JSON.stringify(cliManifest, null, 2) + '\n')

const rootReal = realpathSync(modules)
const unused = Object.keys(entries)
  .filter((key) => key.startsWith('node_modules/') && !kept.has(key))
  .sort((a, b) => b.length - a.length)
let removed = 0
for (const key of unused) {
  const target = resolve(runtime, key)
  if (!target.startsWith(rootReal + sep)) throw new Error(`DSH package path escapes runtime: ${key}`)
  if (!existsSync(target)) continue
  if (lstatSync(target).isSymbolicLink()) throw new Error(`Unexpected symlink in DSH runtime: ${key}`)
  if (!realpathSync(target).startsWith(rootReal + sep)) throw new Error(`DSH package link escapes runtime: ${key}`)
  rmSync(target, { recursive: true, force: false })
  removed++
}
console.log(`DSH runtime: kept ${kept.size} pinned packages, removed ${removed} unused packages`)

// npm bin shims are never used at runtime: DSH imports modules directly and the
// packaged app does not execute npm scripts from its asar.
let removedBinDirs = 0
const pendingDirs = [modules]
while (pendingDirs.length > 0) {
  const dir = pendingDirs.pop()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const target = join(dir, entry.name)
    if (entry.name === '.bin') {
      if (!target.startsWith(rootReal + sep)) throw new Error(`Bin path escapes DSH runtime: ${target}`)
      rmSync(target, { recursive: true, force: false })
      removedBinDirs++
      continue
    }
    pendingDirs.push(target)
  }
}
console.log(`DSH runtime: removed ${removedBinDirs} .bin directories`)
