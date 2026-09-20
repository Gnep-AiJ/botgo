import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { useLocation } from "@solidjs/router"
import { useCommand } from "@opencode-ai/app"
import { Mark } from "@opencode-ai/ui/logo"
import { t } from "./i18n"

const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function BotGoAccount() {
  const command = useCommand()
  const location = useLocation()
  const [state, setState] = createStore({ email: "", balance: "--", cost: "--", loading: false, error: false, unsettled: false })
  const [mount, setMount] = createSignal<HTMLElement>()
  const [expanded, setExpanded] = createSignal(false)
  let dialog!: HTMLDialogElement

  const money = (value: number) => currency.format(value / 1e6)
  const close = () => { dialog.close(); setExpanded(false) }
  const show = () => {
    dialog.showModal()
    setExpanded(true)
    void refresh()
  }

  async function refresh() {
    setState({ loading: true, error: false, cost: "--", unsettled: false })
    try {
      const account = await window.api.botgo.account()
      setState({ email: account.email, balance: money(account.balanceMicros) })
      const task = location.pathname.match(/\/session\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1]
      if (!task) return
      const usage = await window.api.botgo.usage(task) as { chargedMicros?: number; requests?: { state: string }[] }
      const chargedMicros = usage?.chargedMicros
      if (typeof chargedMicros !== "number" || !Number.isSafeInteger(chargedMicros) || !Array.isArray(usage?.requests)) throw Error("Invalid usage")
      setState({ cost: money(chargedMicros), unsettled: usage.requests.some((row) => row.state !== "completed") })
    } catch {
      setState({ error: true })
    } finally {
      setState({ loading: false })
    }
  }

  onMount(() => {
    const sync = () => setMount(document.getElementById("opencode-titlebar-right") ?? undefined)
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    onCleanup(() => observer.disconnect())
    void refresh()
  })

  command.register(() => [{
    id: "botgo.account",
    title: t("botgo.account.title"),
    category: "BotGo",
    keybind: "mod+shift+b",
    onSelect: show,
  }])

  return <>
    <Show when={mount()}>{(target) => <Portal mount={target()}>
      <button
        class="botgo-account-trigger"
        aria-label={state.email ? `${t("botgo.account.title")}: ${state.email}` : t("botgo.account.title")}
        aria-expanded={expanded()}
        title={t("botgo.account.title")}
        onClick={show}
      >
        <span class="botgo-account-avatar" aria-hidden="true"><Mark /></span>
        <span class="botgo-account-summary">
          <span class="botgo-account-label">{t("botgo.account.title")}</span>
          <span class="botgo-account-balance">{state.balance}</span>
        </span>
      </button>
    </Portal>}</Show>
    <dialog ref={dialog} class="botgo-account-dialog" aria-labelledby="botgo-account-title" onClose={() => setExpanded(false)}>
      <h2 id="botgo-account-title">{t("botgo.account.title")}</h2>
      <p class="botgo-account-full-email">{state.email}</p>
      <dl>
        <dt>{t("botgo.account.balance")}</dt><dd>{state.balance}</dd>
        <dt>{t("botgo.account.cost")}</dt><dd>{state.cost}</dd>
      </dl>
      <Show when={state.unsettled}><p>{t("botgo.account.unsettled")}</p></Show>
      <Show when={state.error}><p role="alert">{t("botgo.error.connection")}</p></Show>
      <div class="botgo-account-actions">
        <button disabled={state.loading} onClick={() => void refresh()}>{t("botgo.account.refresh")}</button>
        <button onClick={() => window.api.openExternal("https://botgo.win/index.html?panel=recharge")}>{t("botgo.account.recharge")}</button>
        <button class="botgo-account-danger" disabled={state.loading} onClick={() => { setState({ loading: true }); void window.api.botgo.logout().catch(() => setState({ error: true, loading: false })) }}>{t("botgo.account.logout")}</button>
        <button onClick={close}>{t("botgo.account.close")}</button>
      </div>
    </dialog>
  </>
}
