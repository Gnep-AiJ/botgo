import assert from 'node:assert/strict';
import { createWebChatRuntime } from './fixtures/web-chat-runtime.mjs';
import { handleWebChat } from '../worker/src/web-chat.js';
import { purgeWebChatImages } from '../worker/src/web-chat-images.js';

const runtime = await createWebChatRuntime({ imagesFixture: true });
const { db, env, media, models, upstreamCalls } = runtime;
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKgA8cv/2Q==';
const data = 'data:image/jpeg;base64,' + jpeg;
const image = { kind: 'image', name: '照片.png', frames: [{ data }] };
const video = { kind: 'video', name: '样片.mp4', durationMs: 4000, frames: [{ timeMs: 0, data }, { timeMs: 3500, data }] };
const call = (path, method = 'GET', body, account = 'fixture-a') => handleWebChat(new Request('https://botgo.test' + path, {
  method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
}), env, { waitUntil() {} }, path, account ? { sub: account } : null);
const start = async topic => (await call('/conversations', 'POST', { title: '附件对话', topic })).json();
const send = body => call('/chat/stream', 'POST', { requestId: crypto.randomUUID(), ...body });
const charge = () => db.prepare("SELECT credit_balance*10000+credit_remainder_micros AS balance,billing_reserved_micros AS reserved FROM accounts WHERE id='fixture-a'").get();
const history = async id => (await call('/conversations/' + id)).json();

try {
  const list = await (await call('/chat/models')).json();
  assert.ok(list.models.every(model => model.attachments));
  const conversation = await start('doctor');
  const base = { conversationId: conversation.id, model: models[0].id, content: '' };
  for (const attachments of [[{ ...image, frames: [{ data: 'https://example.invalid/image.jpg' }] }], [video,video], [{ ...video, durationMs: 120001 }], [{ ...video, frames: [{ timeMs: 4000, data }] }]]) {
    assert.equal((await send({ ...base, attachments })).status, 400);
  }
  assert.equal(upstreamCalls.length, 0);
  assert.equal(media.size, 0);

  const first = await send({ ...base, attachments: [image] });
  assert.equal(first.status, 200);
  assert.match(await first.text(), /本地联调回答/);
  assert.equal(upstreamCalls[0].messages.at(-1).content.find(part => part.type === 'image_url').image_url.url, data);
  assert.match(upstreamCalls[0].messages[0].content, /医学信息助手/);
  const original = (await history(conversation.id)).messages[0];
  assert.equal(original.content, '请描述附件中的内容。');
  assert.equal(original.attachments[0].name, image.name);
  assert.doesNotMatch(JSON.stringify(original), /base64/);
  assert.doesNotMatch(db.prepare('SELECT snapshot FROM metered_requests').get().snapshot, /base64|照片/);
  const encrypted = Buffer.from([...media.values()][0]);
  assert.equal(encrypted.includes(Buffer.from(jpeg)), false);

  const preview = original.attachments[0].url.slice(4);
  assert.equal((await call(preview, 'GET', undefined, null)).status, 401);
  assert.equal((await call(preview, 'GET', undefined, 'fixture-b')).status, 404);
  const ownPreview = await call(preview);
  assert.equal(ownPreview.headers.get('content-type'), 'image/jpeg');
  assert.match(ownPreview.headers.get('cache-control'), /no-store/);
  assert.deepEqual(Buffer.from(await ownPreview.arrayBuffer()), Buffer.from(jpeg, 'base64'));

  const responses = { ...base, model: models[1].id, content: '概括视频画面' };
  await (await send({ ...responses, attachments: [video] })).text();
  const videoInput = upstreamCalls.at(-1).input.at(-1).content;
  assert.deepEqual(videoInput.filter(part => part.type === 'input_image').map(part => part.image_url), [data, data]);
  assert.ok(videoInput.some(part => part.type === 'input_text' && part.text.includes('3.50 秒')));
  assert.equal(upstreamCalls.at(-1).input[1].content.at(-1).type, 'input_image', 'previous photo remains in context');
  await (await send({ ...responses, content: '前面的图里还有什么？' })).text();
  assert.equal(upstreamCalls.at(-1).input.filter(message => Array.isArray(message.content)).length, 2);

  db.prepare('INSERT INTO official_model_cache(model_id,model_json) VALUES(?,?)').run(models[0].id, JSON.stringify({ modalities: { input: ['text'] } }));
  const metadata = await (await call('/chat/models')).json();
  assert.equal(metadata.models.find(model => model.id === models[0].id).attachments, false);
  assert.equal(metadata.defaultModel, models[1].id);
  assert.equal((await send({ ...base, content: '追问前面的图片' })).status, 400);

  runtime.setUpstreamMode('reject');
  const before = charge(), retryRequestId = crypto.randomUUID();
  const failed = await send({ ...responses, requestId: retryRequestId, attachments: [image] });
  assert.match(await failed.text(), /本次未扣费/);
  assert.deepEqual(charge(), before);
  assert.equal((await history(conversation.id)).messages.at(-1).state, 'failed');
  const other = await start('tarot');
  assert.equal((await send({ ...responses, conversationId: other.id, retryRequestId })).status, 404);
  runtime.setUpstreamMode('normal');
  await (await send({ ...responses, retryRequestId })).text();
  assert.equal(upstreamCalls.at(-1).input.at(-1).content.at(-1).image_url, data);
  assert.equal(upstreamCalls.at(-1).input.filter(message => Array.isArray(message.content)).length, 2, 'current upload and recent visual history are bounded');
  assert.equal(charge().reserved, 0);

  const put = env.DESKTOP_RELEASES.put;
  env.DESKTOP_RELEASES.put = async () => { throw new Error('isolated storage failure'); };
  const storageFailureId = crypto.randomUUID();
  assert.equal((await send({ ...responses, requestId: storageFailureId, attachments: [image] })).status, 503);
  assert.equal(db.prepare('SELECT 1 FROM web_chat_turns WHERE request_id=?').get(storageFailureId), undefined);
  env.DESKTOP_RELEASES.put = put;
  assert.equal((await call('/conversations/' + conversation.id, 'DELETE')).status, 200);
  assert.equal((await call(preview)).status, 404);
  db.exec("UPDATE web_chat_image_gc SET created_at=datetime('now','-11 minutes')");
  await purgeWebChatImages(env);
  assert.equal(media.size, 0);
  console.log('Web chat attachment validation, both protocols, saved frames, access control, retry, billing and cleanup passed');
} finally {
  await runtime.settle();
  runtime.close();
}
