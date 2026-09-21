import { app, dialog } from "electron"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import updaterModule from "./botgo/updater.cjs"
import type { UpdaterController } from "./updater-controller"
import type { createBotGo } from "./botgo-main"
import { getLogger } from "./logging"
import { setAppQuitting } from "./windows"

const execFileAsync = promisify(execFile)

export function setupAutoUpdater(stop: () => Promise<void>, botgo: ReturnType<typeof createBotGo>): UpdaterController {
  const updates = join(app.getPath("userData"), "updates")
  return updaterModule.createUpdater({
    currentVersion: app.getVersion(),
    origin: "https://botgo.win",
    directory: updates,
    deviceToken: () => botgo.deviceToken(),
    verifySignature: async (file: string) => {
      const verifier = app.isPackaged
        ? join(process.resourcesPath, "botgo", "verify-signature.ps1")
        : join(app.getAppPath(), "src", "main", "botgo", "verify-signature.ps1")
      try {
        await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", verifier, "-FilePath", file], { windowsHide: true, timeout: 30000 })
      } catch {
        throw Error("The update signature could not be verified")
      }
    },
    stop,
    launch: async (file: string) => {
      const installer = spawn(file, ["/S", "--updated", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true })
      await new Promise<void>((resolve, reject) => { installer.once("spawn", resolve); installer.once("error", reject) })
      installer.unref()
      setAppQuitting()
      app.quit()
    },
    onLog: (message: string, data: object) => getLogger().log(message, data),
  }) as UpdaterController
}

export async function showUpdaterDialog(controller: UpdaterController, alertOnFail: boolean) {
  const state = await controller.check()
  if (state.status === "error") {
    if (alertOnFail) await dialog.showMessageBox({ type: "error", title: "BotGo Desktop", message: "Unable to check for updates. Please try again later." })
    return
  }
  if (state.status === "up-to-date") {
    if (alertOnFail) await dialog.showMessageBox({ type: "info", title: "BotGo Desktop", message: "You are using the latest version." })
    return
  }
  if (state.status !== "ready") return
  const result = await dialog.showMessageBox({
    type: "info",
    title: "BotGo Desktop",
    message: `Version ${state.version} is ready to install.`,
    buttons: ["Restart and update", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  if (result.response === 0) await controller.install()
}
