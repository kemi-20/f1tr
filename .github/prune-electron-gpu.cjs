const { lstat, unlink } = require('node:fs/promises')
const { join } = require('node:path')

const UNUSED_GPU_FILES = [
  'dxcompiler.dll',
  'dxil.dll',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll'
]

module.exports = async function pruneElectronGpu(context) {
  if (context.electronPlatformName !== 'win32') return

  const files = UNUSED_GPU_FILES.map(name => join(context.appOutDir, name))
  const stats = await Promise.all(files.map(file => lstat(file)))
  if (stats.some(stat => !stat.isFile())) {
    throw new Error('Expected GPU runtime file is not a regular file')
  }

  await Promise.all(files.map(file => unlink(file)))
  console.log(`Pruned ${files.length} optional Electron GPU runtime files (${stats.reduce((sum, stat) => sum + stat.size, 0)} bytes)`)
}
