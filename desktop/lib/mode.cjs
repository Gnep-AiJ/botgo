const modes = {
  "read-only": ["exec", "--json", "--sandbox", "read-only"],
  "workspace-write": ["exec", "--json", "--sandbox", "workspace-write"],
  "full-access": ["exec", "--json", "--sandbox", "danger-full-access"]
};

function codexArgumentsFor(mode) {
  if (!Object.hasOwn(modes, mode)) throw new Error("Unsupported permission mode");
  return [...modes[mode]];
}

module.exports = { codexArgumentsFor };
