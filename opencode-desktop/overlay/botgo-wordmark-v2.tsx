import { type ComponentProps } from "solid-js"

// This is the welcome-surface mark. It deliberately uses currentColor so the
// shared V2 theme controls its contrast on both light and dark backgrounds.
export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  return (
    <svg
      data-component="botgo-wordmark"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 160"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
      aria-hidden="true"
    >
      {/* This is a quiet background mark, not a second page heading. */}
      <g transform="translate(179 22) scale(0.72)" opacity="0.12">
        <rect x="30" y="24" width="112" height="112" rx="28" fill="currentColor" opacity="0.18" />
        <path d="M86 43v18" stroke="currentColor" stroke-width="7" stroke-linecap="round" />
        <circle cx="86" cy="38" r="7" fill="currentColor" />
        <rect x="52" y="67" width="68" height="51" rx="17" fill="currentColor" />
        <circle cx="73" cy="92" r="6" fill="var(--v2-background-bg-deep)" />
        <circle cx="99" cy="92" r="6" fill="var(--v2-background-bg-deep)" />
        <text x="174" y="113" fill="currentColor" font-family="Segoe UI, Arial, sans-serif" font-size="108" font-weight="650" letter-spacing="-5">
          BotGo
        </text>
      </g>
    </svg>
  )
}
