import { app, BrowserWindow, shell, Menu } from 'electron'
import { join } from 'node:path'
import { logger } from './logging/Logger'
import { ConfigStore } from './config/ConfigStore'
import { registerIpc } from './ipc/register'
import { setTelemetry } from './ipc/telemetryRef'
import { setEngineer, wireLlm } from './ipc/engineerRef'
import { setAudio, setTtsClient, wireTts } from './ipc/ttsRef'
import { TelemetryService } from './telemetry/TelemetryService'
import { EngineerService } from './engineer/EngineerService'
import { AudioPipeline } from './audio/AudioPipeline'
import { Sender } from './ipc/sender'

let mainWindow: BrowserWindow | null = null
let telemetry: TelemetryService | null = null
let engineer: EngineerService | null = null
let audio: AudioPipeline | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#07090E',
    title: 'F1 Race Engineer',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      // preload is built as CommonJS (.cjs) — see electron.vite.config preload.output.
      // A .js preload would be parsed as ESM under package.json "type":"module" and fail to load.
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // the engineer speaks autonomously on telemetry triggers, not per user gesture;
      // allow AudioContext without a click so the first utterance isn't silent.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // bind sender to this window once it's ready
    Sender.setWindow(mainWindow)
  })

  // detach sender + null ref on close so a late emit doesn't hit a destroyed webContents
  mainWindow.on('closed', () => {
    Sender.setWindow(null)
    mainWindow = null
  })

  // replay the latest of each channel once the renderer is ready, so events emitted
  // before React mounted are not permanently lost (paint/health/advice/status).
  mainWindow.webContents.once('did-finish-load', () => {
    for (const ch of ['state:paint', 'health', 'engineer:advice', 'engineer:status', 'session:meta']) {
      Sender.flush(ch)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // DEV/PROD load
  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ensure store is initialized
ConfigStore.getAll()

// Remove the default File/Window/Help menu bar entirely — this is a full-screen
// race-engineer cockpit, the OS menu is noise.
Menu.setApplicationMenu(null)

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  // start UDP telemetry ingest + trigger engine
  const cfg = ConfigStore.getAll()
  engineer = new EngineerService()
  setEngineer(engineer)

  // audio pipeline (TTS synthesis coordination)
  audio = new AudioPipeline()
  setAudio(audio)
  setTtsClient(null)
  engineer.setSpeakHandler((text, firing, voice, direction) => {
    audio!.enqueue(text, firing.priority, voice, direction)
  })
  engineer.setLanguage(cfg.language.mode)
  engineer.setVoice(cfg.language.voice, cfg.language.direction)

  telemetry = new TelemetryService(cfg.telemetry.port, cfg.triggers, (firing) => {
    // fire on the main event loop — serialize through the engineer's queue
    const state = telemetry!.aggregator.getState()
    engineer!.enqueue(state, firing)
  })
  setTelemetry(telemetry)
  telemetry.start()

  // wire the real LLM + TTS backends (P3/P5) if secrets are present
  void wireLlm(cfg)
  void wireTts(cfg)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  telemetry?.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  telemetry?.stop()
})

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err?.message ?? err, err?.stack ?? '')
})
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason)
})

export { mainWindow }
