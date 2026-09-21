import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
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
  const [state, setState] = createStore({ email: "", balance: "—", loading: false, error: false })
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
    if (state.loading) return
    setState({ loading: true, error: false })
    try {
      const account = await window.api.botgo.account()
      setState({ email: account.email, balance: money(account.balanceMicros) })
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
    const timer = setInterval(() => { if (expanded()) void refresh() }, 15000)
    onCleanup(() => clearInterval(timer))
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
      <header class="botgo-account-heading">
        <span class="botgo-account-mark" aria-hidden="true"><Mark /></span>
        <h2 id="botgo-account-title">{t("botgo.account.title")}</h2>
        <button class="botgo-account-close" aria-label={t("botgo.account.close")} onClick={close}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <p class="botgo-account-full-email">{state.email}</p>
      <dl class="botgo-account-funds" aria-busy={state.loading}>
        <dt>{t("botgo.account.balance")}</dt><dd>{state.balance}</dd>
      </dl>
      <Show when={state.error}><p class="botgo-account-error" role="alert">{t("botgo.account.error")}</p></Show>
      <div class="botgo-account-actions">
        <button class="botgo-account-primary" onClick={() => window.api.openExternal("https://botgo.win/?panel=recharge")}>{t("botgo.account.recharge")}<span aria-hidden="true">↗</span></button>
        <button disabled={state.loading} onClick={() => void refresh()}>{state.loading ? t("botgo.account.refreshing") : t("botgo.account.refresh")}</button>
        <button class="botgo-account-danger" disabled={state.loading} onClick={() => { setState({ loading: true }); void window.api.botgo.logout().catch(() => setState({ error: true, loading: false })) }}>{t("botgo.account.logout")}</button>
      </div>
    </dialog>
  </>
}
