import { Show, createSignal, onMount, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { useLocation } from "@solidjs/router"
import { useCommand } from "@opencode-ai/app"
import { t } from "./i18n"

export function BotGoAccount() {
  const command = useCommand()
  const location = useLocation()
  const [state, setState] = createStore({ email: "", balance: "—", cost: "—", loading: false, error: false, unsettled: false })
  let dialog!: HTMLDialogElement
  const [mount, setMount] = createSignal<HTMLElement>()
  onMount(() => {
    const sync = () => setMount(document.getElementById("opencode-titlebar-right") ?? undefined)
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    onCleanup(() => observer.disconnect())
  })
  const open = () => { dialog.showModal(); void refresh() }
  const money = (value: number) => `¥${(value / 1e6).toFixed(6)}`
  async function refresh() {
    setState({ loading: true, error: false, cost: "—", unsettled: false })
    try {
      const account = await window.api.botgo.account()
      setState({ email: account.email, balance: money(account.balanceMicros) })
      const task = location.pathname.match(/\/session\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1]
      if (task) {
        const value = await window.api.botgo.usage(task) as { chargedMicros?: number; requests?: { state: string }[] }
        if (!Number.isSafeInteger(value?.chargedMicros) || !Array.isArray(value.requests)) throw Error("Invalid usage")
        setState({ cost: money(value.chargedMicros!), unsettled: value.requests.some(row => row.state !== "completed") })
      }
    } catch { setState({ error: true }) }
    finally { setState({ loading: false }) }
  }
  command.register(() => [{ id: "botgo.account", title: t("botgo.account.title"), category: "BotGo", keybind: "mod+shift+b",
    onSelect: open }])
  return <>
  <Show when={mount()}>{target => <Portal mount={target()}><button class="botgo-account-trigger" aria-label={t("botgo.account.title")} onClick={open}>BotGo</button></Portal>}</Show>
  <dialog ref={dialog} class="botgo-account-dialog" aria-labelledby="botgo-account-title">
    <h2 id="botgo-account-title">{t("botgo.account.title")}</h2>
    <p>{state.email}</p>
    <dl><dt>{t("botgo.account.balance")}</dt><dd>{state.balance}</dd><dt>{t("botgo.account.cost")}</dt><dd>{state.cost}</dd></dl>
    <Show when={state.unsettled}><p>{t("botgo.account.unsettled")}</p></Show>
    <Show when={state.error}><p role="alert">{t("botgo.error.connection")}</p></Show>
    <div class="botgo-account-actions">
      <button disabled={state.loading} onClick={() => void refresh()}>{t("botgo.account.refresh")}</button>
      <button onClick={() => window.api.openExternal("https://botgo.win/workspace.html")}>{t("botgo.account.recharge")}</button>
      <button disabled={state.loading} onClick={() => { setState({ loading: true }); void window.api.botgo.logout().catch(() => setState({ error: true, loading: false })) }}>{t("botgo.account.logout")}</button>
      <button onClick={() => dialog.close()}>{t("botgo.account.close")}</button>
    </div>
  </dialog>
  </>
}
