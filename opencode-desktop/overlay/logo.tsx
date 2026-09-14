import { type ComponentProps } from "solid-js"

function Robot() {
  return <>
    <rect x="2" y="2" width="44" height="44" rx="12" fill="#0877e8" />
    <path d="M24 10v7" stroke="#65daff" stroke-width="2.5" />
    <circle cx="24" cy="9" r="2" fill="#65daff" />
    <rect x="11" y="17" width="26" height="19" rx="7" fill="#f2faff" />
    <circle cx="19" cy="26" r="2.5" fill="#086dff" />
    <circle cx="29" cy="26" r="2.5" fill="#086dff" />
  </>
}

export const Mark = (props: { class?: string }) => (
  <svg data-component="logo-mark" class={props.class} viewBox="0 0 48 48" fill="none" aria-label="BotGo" role="img">
    <Robot />
  </svg>
)

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => (
  <svg ref={props.ref} data-component="logo-splash" class={props.class} viewBox="0 0 48 48" fill="none" aria-label="BotGo" role="img">
    <Robot />
  </svg>
)

export const Logo = (props: { class?: string }) => (
  <svg class={props.class} viewBox="0 0 170 48" fill="none" aria-label="BotGo" role="img">
    <Robot />
    <text x="59" y="34" fill="var(--icon-strong-base)" font-family="Segoe UI, sans-serif" font-weight="650" font-size="32">BotGo</text>
  </svg>
)
