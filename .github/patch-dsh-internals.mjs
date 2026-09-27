import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve('resources/dsh-runtime/node_modules/node-addon-require-builtin')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
if (manifest.name !== 'node-addon-require-builtin' || manifest.version !== '0.1.6') {
  throw new Error('Unexpected DSH internal-loader package version')
}

const entry = resolve(root, 'lib/index.js')
const original = "const api = createEntryApi(node_path_1.default.resolve(__dirname, '..'));"
const replacement = `const api = process.execArgv.includes('--expose-internals')
    ? {
        requireBuiltin: (id) => require(id),
        isAllowedInternalId: () => true,
        getBindingInfo: () => { throw new Error('Native binding info is unavailable with exposed internals'); }
      }
    : createEntryApi(node_path_1.default.resolve(__dirname, '..'));`
const source = readFileSync(entry, 'utf8')
if (source.includes(replacement)) {
  console.log('Pinned DSH internal-loader compatibility patch already applied')
} else {
  if (source.split(original).length !== 2) {
    throw new Error('Pinned DSH internal-loader entry changed; refusing compatibility patch')
  }
  writeFileSync(entry, source.replace(original, replacement))
  console.log('Enabled exposed-internals fallback for pinned DSH native loader')
}
