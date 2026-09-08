// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '@sub-rosa/logging';
import { runCommand, UsageError } from '@sub-rosa/command';
import { KeeperStore, normalizeRoundId } from "./store.js";

const diagnostics = createLogger("services.keeper.src.queue");

runCommand({
  name: "services.keeper.queue",
  description: "Manage the watched rounds queue for the keeper service",
  usage: "npm run queue <add|list|remove> [roundId]",
  async run(ctx) {
    const [cmd, rawRoundId] = ctx.positionals;
    if (!cmd) {
      throw new UsageError("Missing command: add, list, or remove");
    }

    const store = new KeeperStore();

    if (cmd === "add") {
      if (!rawRoundId) {
        diagnostics.error("error-missing-roundid", "Error: missing roundId");
        throw new UsageError("missing roundId");
      }
      const roundId = normalizeRoundId(rawRoundId);
      const contractId = ctx.env.ROUND_CONTRACT_ID;
      const network = ctx.env.NETWORK_PASSPHRASE;
      store.addRound(roundId, { contractId, network });
      diagnostics.info("added-round", `Added round ${roundId} to the queue.`);
      return 0;
    }

    if (cmd === "list") {
      const rounds = store.listRounds();
      if (rounds.length === 0) {
        diagnostics.info("queue-is-empty", "Queue is empty.");
        return 0;
      }
      diagnostics.info("watching", `Watching ${rounds.length} rounds:\n`);
      for (const r of rounds) {
        const extra = r.lastAction ? ` (action: ${r.lastAction})` : "";
        const err = r.lastError ? ` (error: ${r.lastError})` : "";
        const contract = r.contractId ? ` [${r.contractId}]` : "";
        diagnostics.info("round", `- Round ${r.roundId}${contract}: ${r.lastStatus}${extra}${err} [retries: ${r.retryCount}]`);
      }
      return 0;
    }

    if (cmd === "remove") {
      if (!rawRoundId) {
        diagnostics.error("error-missing-roundid-2", "Error: missing roundId");
        throw new UsageError("missing roundId");
      }
      const roundId = normalizeRoundId(rawRoundId);
      store.removeRound(roundId);
      diagnostics.info("removed-round", `Removed round ${roundId} from the queue.`);
      return 0;
    }

    diagnostics.error("unknown-command", `Unknown command: ${cmd}`);
    throw new UsageError(`Unknown command: ${cmd}`);
  },
});
