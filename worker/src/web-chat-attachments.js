import { officialModel } from './official-pricing.js';
import { readPrivateMedia, stagePrivateMedia } from './web-chat-images.js';

export const WEB_CHAT_ATTACHMENT_BODY_LIMIT = 3 * 1024 * 1024;
export const WEB_CHAT_VISION_PAYLOAD_LIMIT = 6 * 1024 * 1024;
const jpegPrefix = 'data:image/jpeg;base64,';
const recentVisualTurns = 2;
const json = (body, status) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export function supportsWebChatVision(modelId, cachedModel) {
  const input = (cachedModel || officialModel(modelId))?.modalities?.input;
  return Array.isArray(input) && input.includes('image');
}

function validJpeg(data, maxBytes, maxSide) {
  if (typeof data !== 'string' || !data.startsWith(jpegPrefix)) return false;
  const encoded = data.slice(jpegPrefix.length);
  if (encoded.length > Math.ceil(maxBytes / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const bytes = atob(encoded);
  const byte = index => bytes.charCodeAt(index);
  if (bytes.length < 24 || bytes.length > maxBytes || byte(0) !== 255 || byte(1) !== 216 || byte(bytes.length - 2) !== 255 || byte(bytes.length - 1) !== 217) return false;
  // Read the JPEG frame header to enforce the pixel limit as well as the byte limit.
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (byte(offset++) !== 255) return false;
    while (byte(offset) === 255) offset++;
    const marker = byte(offset++), length = byte(offset) * 256 + byte(offset + 1);
    if (!Number.isInteger(length) || length < 2 || offset + length > bytes.length) return false;
    if ([192, 193, 194].includes(marker)) {
      const height = byte(offset + 3) * 256 + byte(offset + 4), width = byte(offset + 5) * 256 + byte(offset + 6);
      return length >= 8 && height > 0 && height <= maxSide && width > 0 && width <= maxSide;
    }
    if (marker === 218) return false;
    offset += length;
  }
  return false;
}

export function parseWebChatAttachments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4) return null;
  const attachments = [];
  for (const file of value) {
    if (!file || !['image', 'video'].includes(file.kind) || typeof file.name !== 'string' || file.name.length > 180 || !file.name.trim()) return null;
    const video = file.kind === 'video';
    if (video && (attachments.some(item => item.kind === 'video') || !Number.isInteger(file.durationMs) || file.durationMs < 1 || file.durationMs > 120000)) return null;
    if (!Array.isArray(file.frames) || file.frames.length < 1 || (video ? file.frames.length > 12 : file.frames.length !== 1)) return null;
    const frames = [];
    for (const frame of file.frames) {
      if (!frame || !validJpeg(frame.data, video ? 64 * 1024 : 256 * 1024, video ? 768 : 1600)) return null;
      if (video && (!Number.isInteger(frame.timeMs) || frame.timeMs < 0 || frame.timeMs >= file.durationMs || frame.timeMs <= (frames.at(-1)?.timeMs ?? -1))) return null;
      frames.push(video ? { data: frame.data, timeMs: frame.timeMs } : { data: frame.data });
    }
    const name = file.name.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').trim() || (video ? '视频' : '图片');
    attachments.push({ kind: file.kind, name, frames, ...(video ? { durationMs: file.durationMs } : {}) });
  }
  return attachments;
}

const manifest = attachments => attachments.map(({ kind, name, frames, durationMs }) => ({ kind, name, frameCount: frames.length, durationMs }));
export const publicChatAttachments = (requestId, manifestJson) => JSON.parse(manifestJson).map((file, index) => ({ ...file, url: `/api/chat/attachments/${requestId}/${index}` }));

async function readAttachments(env, accountId, record) {
  const raw = await readPrivateMedia(env, accountId, record, WEB_CHAT_ATTACHMENT_BODY_LIMIT);
  if (!raw) throw Error('ATTACHMENTS_MISSING');
  return JSON.parse(new TextDecoder().decode(raw));
}

export async function prepareTurnAttachments(env, accountId, body, incoming, { vision, signal }) {
  const { conversationId, retryRequestId } = body;
  const retry = retryRequestId && await env.DB.prepare(`SELECT a.* FROM web_chat_attachments a JOIN web_chat_turns t ON t.request_id=a.request_id
    WHERE t.conversation_id=? AND t.request_id=? AND t.state IN ('stopped','failed') AND t.created_at>datetime('now','-30 days')`).bind(conversationId, retryRequestId).first();
  if (retryRequestId && !retry) return { response: json({ error: '可重试的附件不存在或已过期。' }, 404) };
  const recent = (await env.DB.prepare(`SELECT a.* FROM web_chat_turns t JOIN web_chat_attachments a ON a.request_id=t.request_id
    WHERE t.conversation_id=? AND t.request_id<>? AND t.state IN ('completed','stopped') AND t.created_at>datetime('now','-30 days')
    ORDER BY t.rowid DESC LIMIT ?`).bind(conversationId, retryRequestId || '', recentVisualTurns - Number(!!(retry || incoming.length))).all()).results;
  if (!retry && !incoming.length && !recent.length) return { current: [], previous: new Map(), writes: [] };
  if (!env.DESKTOP_RELEASES) return { response: json({ error: '附件存储暂不可用。' }, 503) };
  if (!vision) return { response: json({ error: '请在模型栏选择支持图片和视频的模型。' }, 400) };
  try {
    const current = retry ? await readAttachments(env, accountId, retry) : incoming;
    const previous = new Map(await Promise.all(recent.map(async row => [row.request_id, await readAttachments(env, accountId, row)])));
    const writes = [];
    if (current.length) {
      const bytes = new TextEncoder().encode(JSON.stringify(current));
      const stored = await stagePrivateMedia(env, accountId, bytes, signal);
      writes.push(
        env.DB.prepare('INSERT INTO web_chat_attachments(id,request_id,storage_key,iv,bytes,manifest_json) VALUES(?,?,?,?,?,?)')
          .bind(stored.id, body.requestId, stored.storageKey, stored.iv, stored.bytes, JSON.stringify(manifest(current))),
        env.DB.prepare('DELETE FROM web_chat_image_gc WHERE storage_key=?').bind(stored.storageKey)
      );
    }
    return { current, previous, writes };
  } catch {
    return { response: signal.aborted ? json({ error: '请求已停止。', code: 'CANCELLED' }, 499) : json({ error: '附件读写失败，请稍后重试。' }, 503) };
  }
}

export async function chatAttachmentPreview(env, accountId, requestId, index) {
  const row = await env.DB.prepare(`SELECT a.* FROM web_chat_attachments a JOIN web_chat_turns t ON t.request_id=a.request_id
    JOIN web_conversations c ON c.id=t.conversation_id WHERE t.request_id=? AND c.account_id=? AND t.created_at>datetime('now','-30 days')`).bind(requestId, accountId).first();
  if (!row || index >= JSON.parse(row.manifest_json).length) return json({ error: '附件不存在或已过期。' }, 404);
  try {
    const files = await readAttachments(env, accountId, row);
    const bytes = Uint8Array.from(atob(files[index].frames[0].data.slice(jpegPrefix.length)), c => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' } });
  } catch {
    return json({ error: '附件预览暂不可用。' }, 503);
  }
}

export function chatAttachmentMessage(text, attachments) {
  if (!attachments?.length) return text;
  const parts = [{ type: 'text', text }];
  attachments.forEach((file, index) => {
    const video = file.kind === 'video';
    parts.push({ type: 'text', text: video ? `附件 ${index + 1} 是 ${(file.durationMs / 1000).toFixed(2)} 秒的视频。以下为按时间排列的抽帧画面，音轨未提供。` : `附件 ${index + 1} 是图片。` });
    for (const frame of file.frames) {
      if (video) parts.push({ type: 'text', text: `视频时间 ${(frame.timeMs / 1000).toFixed(2)} 秒` });
      parts.push({ type: 'image_url', image_url: { url: frame.data, detail: 'auto' } });
    }
  });
  return parts;
}
