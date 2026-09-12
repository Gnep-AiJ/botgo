#!/usr/bin/env node
const { main } = require("../lib/cli.cjs");

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
