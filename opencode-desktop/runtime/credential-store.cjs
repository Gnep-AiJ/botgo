const fs = require("node:fs");
const path = require("node:path");

function createCredentialStore({ filePath, safeStorage }) {
  function available() {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error("Windows credential protection is unavailable");
  }
  return {
    load() {
      available();
      if (!fs.existsSync(filePath)) return null;
      const bytes = fs.readFileSync(filePath);
      try { return JSON.parse(safeStorage.decryptString(bytes)); }
      catch { throw Object.assign(new Error('Saved sign-in cannot be read'), { code: 'CREDENTIAL_UNREADABLE' }); }
    },
    save(value) {
      available();
      if (!value || typeof value.deviceToken !== "string") throw new Error("A device credential is required");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, safeStorage.encryptString(JSON.stringify({ deviceToken: value.deviceToken, desktopKey: value.desktopKey || null })));
    },
    clear() {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
    }
    ,archiveUnreadable() {
      if (fs.existsSync(filePath)) fs.renameSync(filePath, filePath + '.unreadable-' + Date.now());
    }
  };
}

module.exports = { createCredentialStore };
