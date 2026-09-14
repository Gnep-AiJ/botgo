import { onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Mark } from "@opencode-ai/ui/logo"
import { t } from "./i18n"
import "./botgo-gate.css"

export function BotGoGate(props: { children: JSX.Element }) {
  const [state, setState] = createStore<Awaited<ReturnType<typeof window.api.botgo.state>>>({ status: "connecting" })
  const refresh = () => window.api.botgo.state().then(setState).catch(() => setState({ status: "error", error: "connection" }))
  onMount(() => { void refresh() })
  const timer = setInterval(() => { if (state.status !== "ready") void refresh() }, 1000)
  onCleanup(() => clearInterval(timer))
  const login = async () => {
    setState({ status: "connecting", error: undefined })
    await window.api.botgo.login().then(setState).catch(() => setState({ status: "error", error: "connection" }))
  }
  return (
    <Show when={state.status === "ready"} fallback={
      <main class="botgo-gate">
        <section class="botgo-login" aria-labelledby="botgo-login-title">
          <Mark class="botgo-login-logo" />
          <h1 id="botgo-login-title">BotGo</h1>
          <p>{t("botgo.login.description")}</p>
          <Show when={state.status === "error"}>
            <p role="alert" class="botgo-login-error">{t(state.error === "models" ? "botgo.error.models" : state.error === "session" ? "botgo.error.session" : "botgo.error.connection")}</p>
          </Show>
          <button onClick={login} disabled={state.status === "connecting" || state.status === "waiting"}>
            {t(state.status === "connecting" ? "botgo.login.connecting" : state.status === "waiting" ? "botgo.login.waiting" : "botgo.login.action")}
          </button>
          <Show when={state.status === "waiting" && state.url}>
            <a href={state.url} onClick={(event) => { event.preventDefault(); if (state.url) window.api.openExternal(state.url) }}>{t("botgo.login.reopen")}</a>
            <button class="botgo-secondary" onClick={() => void window.api.botgo.cancel().then(setState)}>{t("botgo.login.cancel")}</button>
          </Show>
        </section>
      </main>
    }>{props.children}</Show>
  )
}
