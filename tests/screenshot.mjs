/**
 * Screenshot harness — launches the app via electron-vite dev, waits for the
 * renderer to settle, captures a screenshot, dumps any console errors, and exits.
 *   node tests/screenshot.mjs [seconds-to-wait]
 */
import { spawn, execSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const waitSec = Number(process.argv[2] ?? 12)
const shotDir = resolve('tests', 'shots')
if (!existsSync(shotDir)) mkdirSync(shotDir, { recursive: true })

// We run electron-vite dev in the background, but we need OUR OWN main entry that
// can capturePage. Simplest: build to out/, then run electron directly with a tiny
// custom main that requires the real one but captures a screenshot after load.
console.log('[shot] building app…')
execSync('npx electron-vite build', { stdio: 'inherit', cwd: process.cwd() })

// Write a capture-main that wraps out/main/index.js
const captureMain = `
const { app, BrowserWindow, session } = require('electron')
const path = require('path')
const fs = require('fs')
// disable CSP for screenshot capture so we isolate "is it CSP?" vs "is it a render bug?"
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1480, height: 900, show: true, backgroundColor: '#07090E',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  const errs = []
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2) errs.push('[render-error] ' + message + ' @ ' + sourceId + ':' + line)
  })
  win.webContents.on('render-process-gone', (e, d) => errs.push('[render-gone] ' + JSON.stringify(d)))
  win.webContents.on('did-fail-load', (e, code, desc) => errs.push('[did-fail-load] ' + code + ' ' + desc))
  // capture both WITH the real preload (full app) — load the built renderer file.
  // __dirname is out/, so renderer is ./renderer (NOT ../renderer).
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  setTimeout(() => {
    win.webContents.capturePage().then((img) => {
      const png = img.toPNG()
      const out = path.join('${shotDir.replace(/\\/g, '/')}', 'capture.png')
      fs.writeFileSync(out, png)
      // also dump the captured HTML after load
      win.webContents.executeJavaScript('document.documentElement.outerHTML.slice(0,2000)').then((html) => {
        fs.writeFileSync(path.join('${shotDir.replace(/\\/g, '/')}', 'rendered.html'), html)
        fs.writeFileSync(path.join('${shotDir.replace(/\\/g, '/')}', 'errors.txt'), errs.join('\\n') || '(no render errors)')
        console.log('[shot] saved ' + out + ' (' + png.length + ' bytes), ' + errs.length + ' render errors')
        app.quit()
      }).catch((e) => { fs.writeFileSync(path.join('${shotDir.replace(/\\/g, '/')}', 'errors.txt'), 'execJS fail: '+e+'\\n'+errs.join('\\n')); app.quit() })
    }).catch((e) => { fs.writeFileSync(path.join('${shotDir.replace(/\\/g, '/')}', 'errors.txt'), 'capture fail: '+e); app.quit() })
  }, ${waitSec * 1000})
})
process.on('uncaughtException', (e) => { fs.writeFileSync(path.join('${shotDir.replace(/\\/g, '/')}', 'errors.txt'), 'uncaught: '+e.stack); app.quit() })
`
const capturePath = resolve('out', 'capture-main.cjs')
writeFileSync(capturePath, captureMain)

console.log('[shot] launching electron with capture harness…')
const electronBin = resolve('node_modules', 'electron', 'dist', 'electron.exe')
const cp = spawn(electronBin, [capturePath], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})
cp.on('exit', (code) => {
  console.log('[shot] electron exited ' + code)
  // report
  try {
    const errs = require('node:fs').readFileSync(resolve('tests', 'shots', 'errors.txt'), 'utf8')
    console.log('[shot] render errors:\n' + errs)
  } catch {}
})
