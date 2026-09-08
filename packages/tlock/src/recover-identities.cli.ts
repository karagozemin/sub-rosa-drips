// Copyright (c) 2026 Sub Rosa contributors
import process from "node:process";
import { runCommand } from "@sub-rosa/command";
import { runAuditorRecoveryCli, usage } from "./auditor-recovery-cli.js";

runCommand({
  name: "tlock.recover-identities",
  description: "Auditor identity recovery CLI",
  usage: usage(),
  async run(ctx) {
    const stdin = process.stdin.isTTY ? "" : await new Promise<string>((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    });

    const result = runAuditorRecoveryCli(ctx.rawArgs, stdin);
    process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
    return result.exitCode;
  },
});
