import fs from 'node:fs'
import path from 'node:path'
const root = process.env.BOTGO_PROFILE_ROOT
if (!root) throw Error('BotGo profile root is required')
const pointer = path.join(root, 'active-account.json')
if (fs.existsSync(pointer)) {
  const id = JSON.parse(fs.readFileSync(pointer, 'utf8')).id
  if (!/^[a-f0-9]{24}$/.test(id)) throw Error('Invalid account scope')
  process.env.HERMES_HOME = path.join(root, 'accounts', id)
}
process.env.HERMES_DESKTOP_CDP_PORT = 'off'
process.env.HERMES_DESKTOP_APP_NAME = 'BotGo'
