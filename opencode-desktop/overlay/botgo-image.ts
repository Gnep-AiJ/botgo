import { Effect, Schema } from "effect"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"

const Parameters = Schema.Struct({
  prompt: Schema.String.annotate({ description: "A clear description of the image to create" }),
  size: Schema.optional(Schema.String.annotate({ description: "1024x1024, 1536x1024, or 1024x1536" })),
  quality: Schema.optional(Schema.String.annotate({ description: "low, medium, or high" })),
})

function models() {
  try {
    const value = JSON.parse(process.env.BOTGO_IMAGE_MODELS || "[]")
    return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(item.id)) : []
  } catch {
    return []
  }
}

export const BotGoImageTool = Tool.define(
  "botgo_image_generation",
  Effect.succeed({
    description: `When the user explicitly asks you to generate an image, use this tool with their requested content. It uses the account's current default BotGo image model, saves one image under generated-images/ in the current project, and returns it to the conversation. Do not use it for image analysis or ordinary text requests. Ask only if the image request is ambiguous.`,
    parameters: Parameters,
    execute: (args: { prompt: string; size?: string; quality?: string }, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const available = models()
        if (!available.length) throw new Error("当前没有可用的生图模型，请重新连接 BotGo 账户。")
        if (!args.prompt.trim() || args.prompt.length > 8192) throw new Error("提示词不能为空，且最多 8192 个字符。")
        const url = process.env.BOTGO_IMAGE_API_URL
        const key = process.env.BOTGO_IMAGE_API_KEY
        if (!url || !key) throw new Error("BotGo 生图接口未连接。")
        const endpoint = new URL(url)
        if (endpoint.hostname !== "127.0.0.1" || endpoint.pathname !== "/v1/images/generations") throw new Error("BotGo 本地生图接口无效。")

        const instance = yield* InstanceState.context
        const folder = path.join(instance.directory, "generated-images")
        const filename = `image-${Date.now()}-${randomUUID()}.png`
        const filepath = path.join(folder, filename)
        const relative = path.relative(instance.worktree, filepath)
        yield* ctx.ask({
          permission: "edit",
          patterns: [relative],
          always: [],
          metadata: { filepath, description: "Save generated image in the project" },
        })
        yield* Effect.promise(() => mkdir(folder, { recursive: true }))
        const response = yield* Effect.promise(() => fetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-session-id": ctx.sessionID },
          body: JSON.stringify({ prompt: args.prompt, size: args.size || "1024x1024", quality: args.quality || "high", n: 1 }),
          signal: ctx.abort,
        }))
        if (!response.ok) {
          const data = yield* Effect.promise(() => response.json().catch(() => ({})))
          throw new Error(data?.error?.message || data?.error || `生图请求失败（HTTP ${response.status}）。`)
        }
        const data = yield* Effect.promise(() => response.json())
        const image = data?.data?.[0]?.b64_json
        if (typeof image !== "string" || image.length > 16 * 1024 * 1024) throw new Error("上游返回的图片内容无效或过大。")
        yield* Effect.promise(() => writeFile(filepath, Buffer.from(image, "base64"), { flag: "wx" }))
        return {
          title: "图片已生成",
          output: `图片已保存：${relative}`,
          metadata: { filepath: relative },
          attachments: [{ type: "file" as const, mime: "image/png", url: `data:image/png;base64,${image}` }],
        }
      }),
  }),
)
