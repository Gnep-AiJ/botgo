export const maxAttachments = 4;
export const attachmentPrompt = '请描述附件中的内容。';
export const attachmentModelHint = '请在模型栏选择支持图片和视频的模型。';

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const videoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
const mib = 1024 * 1024;

export function attachmentKind(file) {
  const unspecified = !file.type || file.type === 'application/octet-stream';
  if (imageTypes.includes(file.type) || (unspecified && /\.(jpe?g|png|webp)$/i.test(file.name))) return 'image';
  if (videoTypes.includes(file.type) || (unspecified && /\.(mp4|webm|mov)$/i.test(file.name))) return 'video';
  return null;
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function encodeFrame(source, width, height, maxSide, maxBytes, signal) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  for (const scale of [1, 0.75, 0.5]) {
    const ratio = Math.min(1, maxSide * scale / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.87, 0.72, 0.57]) {
      signal.throwIfAborted();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob?.type === 'image/jpeg' && blob.size <= maxBytes) return dataUrl(blob);
    }
  }
  throw new Error('附件压缩失败，请尝试较小的文件。');
}

function waitForVideo(video, event, signal, start) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    function cleanup() {
      video.removeEventListener(event, ready);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    }
    function ready() { cleanup(); resolve(); }
    function failed() { cleanup(); reject(new Error('浏览器无法解码该视频，请尝试可播放的 MP4 或 WebM。')); }
    function aborted() { cleanup(); reject(signal.reason); }
    video.addEventListener(event, ready);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    start();
  });
}

async function sampleVideo(file, signal) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  try {
    await waitForVideo(video, 'loadedmetadata', signal, () => { video.src = url; });
    const durationMs = Math.round(video.duration * 1000);
    if (!Number.isFinite(durationMs) || durationMs < 1 || !video.videoWidth) throw new Error('无法读取视频画面。');
    if (video.duration > 120) throw new Error('视频最长支持 2 分钟。');
    if (video.readyState < 2) await waitForVideo(video, 'loadeddata', signal, () => {});
    const end = Math.max(0, Math.min(durationMs - 1, Math.floor(durationMs * 0.95)));
    const count = Math.min(12, Math.max(2, Math.ceil(durationMs / 1000)), end + 1);
    const frames = [];
    for (let i = 0; i < count; i++) {
      const timeMs = Math.round(i * end / Math.max(1, count - 1));
      if (i > 0) await waitForVideo(video, 'seeked', signal, () => { video.currentTime = timeMs / 1000; });
      const data = await encodeFrame(video, video.videoWidth, video.videoHeight, 768, 64 * 1024, signal);
      frames.push({ data, timeMs });
    }
    return { durationMs, frames };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function prepareChatAttachment(file, kind, cancellation) {
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(25000)]);
  const name = file.name.slice(0, 180).trim() || (kind === 'image' ? '图片' : '视频');
  if (!file.size) throw new Error('文件为空，请重新选择。');
  if (kind === 'video') {
    if (file.size > 60 * mib) throw new Error('视频文件最大支持 60 MB。');
    return { kind, name, ...await sampleVideo(file, signal) };
  }
  if (file.size > 20 * mib) throw new Error('单张图片最大支持 20 MB。');
  const image = await createImageBitmap(file).catch(() => { throw new Error('无法读取图片，请尝试 JPG、PNG 或 WebP。'); });
  try {
    const data = await encodeFrame(image, image.width, image.height, 1600, 256 * 1024, signal);
    return { kind, name, frames: [{ data }] };
  } finally {
    image.close();
  }
}
