import { app, safeStorage, shell } from "electron"
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import bridgeModule from "./botgo/bridge.cjs"
import authModule from "./botgo/authorize.cjs"
import credentialModule from "./botgo/credential-store.cjs"
import diagnosticModule from "./botgo/diagnostic.cjs"
import networkModule from "./botgo/network.cjs"
import { write } from "./logging"

export type BotGoState = { status: "signed-out" | "connecting" | "waiting" | "ready" | "error"; email?: string; balanceMicros?: number; url?: string; error?: string }

export function createBotGo() {
  const origin = "https://botgo.win"
  // The isolated Electron smoke test has no device credential and never ships.
  // Its fake state permits renderer checks without touching account data or network.
  const nativeSmoke = process.env.BOTGO_NATIVE_SMOKE === "1" && !app.isPackaged
  const storage = credentialModule.createCredentialStore({ filePath: join(app.getPath("userData"), "device.enc"), safeStorage })
  let state: BotGoState = { status: "signed-out" }
  let bridge: Awaited<ReturnType<typeof bridgeModule.createBridge>> | undefined
  let authorization: Awaited<ReturnType<typeof authModule.beginAuthorization>> | undefined
  let pending: Promise<void> | undefined
  const ready = Promise.withResolvers<void>()
  let stage = "initialize"
  const taskPath = (email: string) => join(app.getPath("userData"), `tasks-${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0,24)}.json`)
  const taskStore = {
    load(email: string) { const file = taskPath(email); return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {} },
    save(email: string, value: Record<string,string>) { const file = taskPath(email); writeFileSync(file + ".next", JSON.stringify(value)); renameSync(file + ".next", file) },
  }

  async function connect() {
    stage = "storage"
    if (nativeSmoke) {
      state = { status: "ready", email: "native-smoke@invalid", balanceMicros: 12000000 }
      return
    }
    const credential = storage.load()
    if (!credential?.deviceToken) return
    state = { status: "connecting" }
    stage = "session"
    bridge = await bridgeModule.createBridge({ origin, deviceToken: credential.deviceToken, taskStore,
      onDiagnostic: (data: Record<string, unknown>) => write("botgo-request", "timing", data) })
    const account = bridge.account()
    const accountID = createHash("sha256").update(account.email.toLowerCase()).digest("hex").slice(0,24)
    for (const name of ["DATA", "CONFIG", "CACHE", "STATE"]) {
      const directory = join(app.getPath("userData"), "accounts", accountID, name.toLowerCase())
      mkdirSync(directory, { recursive: true })
      process.env[`XDG_${name}_HOME`] = directory
    }
    process.env.BOTGO_MANAGED_CONFIG = JSON.stringify(bridge.config())
    process.env.OPENCODE_CONFIG_CONTENT = process.env.BOTGO_MANAGED_CONFIG
    state = { status: "ready", email: account.email, balanceMicros: account.balanceMicros }
  }
  function error(error: unknown) {
    write("botgo-auth", "sign-in failed", diagnosticModule.diagnostic(error, stage), "warn")
    if ((error as { code?: string })?.code === "CANCELLED") { state = { status: "signed-out" }; return }
    const status = (error as { status?: number })?.status
    state = { status: "error", error: status === 401 || (error as { code?: string })?.code === "CREDENTIAL_UNREADABLE" ? "session" : status && (status >= 500 || (stage === "session" && status === 404)) ? "models" : "connection" }
    if (status === 401) storage.clear()
  }
  async function login() {
    if (pending || authorization || bridge) return { ...state }
    pending = (async () => {
      stage = "storage"
      let saved
      try { saved = storage.load() }
      catch (failure) {
        if ((failure as { code?: string })?.code !== "CREDENTIAL_UNREADABLE") throw failure
        // Only explicit sign-in archives unreadable encrypted bytes; never erase tasks.
        storage.archiveUnreadable()
      }
      if (saved?.deviceToken) { await connect(); return }
      state = { status: "connecting" }
      stage = "authorize-start"
      authorization = await authModule.beginAuthorization({ origin, save: (value: { deviceToken: string }) => { stage = "storage"; storage.save(value) } })
      stage = "authorize-exchange"
      state = { status: "waiting", url: authorization.url }
      void shell.openExternal(authorization.url).catch(() => undefined)
      void authorization.done
        .then(async () => {
          await connect()
          // The local service reads its managed model configuration on startup.
          // Restart only after an approved device credential has been saved so the
          // next process starts that service with the account configuration.
          if (state.status === "ready") {
            app.relaunch()
            app.quit()
          }
        })
        .catch(error)
        .finally(() => { authorization = undefined })
    })().catch(error).finally(() => { pending = undefined })
    await pending
    return { ...state }
  }
  // A first launch has no saved credential. Resolving after that storage check
  // lets the local service and sign-in renderer start, instead of waiting for a
  // sign-in action that cannot be shown yet.
  async function initialize() {
    try { await connect() }
    catch (failure) { error(failure) }
    finally { ready.resolve() }
  }
  app.once("before-quit", () => { authorization?.cancel(); void bridge?.close() })
  return {
    ready: ready.promise, initialize, login,
    // Main process only. The device token is never exposed through preload.
    deviceToken: () => storage.load()?.deviceToken,
    state: () => ({ ...state }),
    async account() {
      if (nativeSmoke) return { email: "native-smoke@invalid", balanceMicros: 12000000 }
      const credential = storage.load()
      if (!credential?.deviceToken) throw Error("No device credential")
      const response = await networkModule.fetchRead(fetch, `${origin}/api/desktop/account`, { redirect: "error",
        headers: { authorization: `Bearer ${credential.deviceToken}` } })
      if (!response.ok) throw Error(`Account HTTP ${response.status}`)
      const result = await response.json()
      if (typeof result.account?.email !== "string" || !Number.isSafeInteger(result.account?.balanceMicros)) throw Error("Invalid account response")
      state = { ...state, email: result.account.email, balanceMicros: result.account.balanceMicros }
      return { email: result.account.email as string, balanceMicros: result.account.balanceMicros as number }
    },
    cancel: () => { if (authorization?.cancel()) { authorization = undefined; state = { status: "signed-out" } }; return { ...state } },
    usage: (taskId: string) => bridge?.usage(taskId),
    async logout() {
      authorization?.cancel()
      const credential = storage.load()
      if (credential?.deviceToken) {
        const response = await fetch(`${origin}/api/desktop/revoke`, { method: "POST", redirect: "error",
          headers: { authorization: `Bearer ${credential.deviceToken}` }, signal: AbortSignal.timeout(20000) })
        if (!response.ok && response.status !== 401) throw Error("Device revocation failed")
      }
      await bridge?.close(); bridge = undefined
      storage.clear()
      // Explicit user logout starts a clean account lifecycle; no task is replayed.
      app.relaunch(); app.quit()
    },
  }
}
