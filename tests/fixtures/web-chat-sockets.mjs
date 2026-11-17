export function connect(address, options) {
  if (!globalThis.__botgoTestSocketConnect) throw new Error('Test SMTP socket is not installed');
  return globalThis.__botgoTestSocketConnect(address, options);
}
