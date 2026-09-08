// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.keeper.src.queue");
import { KeeperStore, normalizeRoundId } from "./store.js";

function usage() {
  diagnostics.info("usage-npm-run-queue-command-args-commands-add-roundid-a", `
Usage: npm run queue <command> [args]

Commands:
  add <roundId>      Add a round to the watched queue
  list               List all watched rounds and their status
  remove <roundId>   Remove a round from the queue
`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    usage();
  }

  const cmd = args[0];
  const store = new KeeperStore();

  if (cmd === "add") {
    const rawRoundId = args[1];
    if (!rawRoundId) {
      diagnostics.error("error-missing-roundid", "Error: missing roundId");
      usage();
    }
    const roundId = normalizeRoundId(rawRoundId);
    const contractId = process.env.ROUND_CONTRACT_ID;
    const network = process.env.NETWORK_PASSPHRASE;
    store.addRound(roundId, { contractId, network });
    diagnostics.info("added-round", `Added round ${roundId} to the queue.`);
  } else if (cmd === "list") {
    const rounds = store.listRounds();
    if (rounds.length === 0) {
      diagnostics.info("queue-is-empty", "Queue is empty.");
      return;
    }
    diagnostics.info("watching", `Watching ${rounds.length} rounds:\n`);
    for (const r of rounds) {
      const extra = r.lastAction ? ` (action: ${r.lastAction})` : "";
      const err = r.lastError ? ` (error: ${r.lastError})` : "";
      const contract = r.contractId ? ` [${r.contractId}]` : "";
      diagnostics.info("round", `- Round ${r.roundId}${contract}: ${r.lastStatus}${extra}${err} [retries: ${r.retryCount}]`);
    }
  } else if (cmd === "remove") {
    const rawRoundId = args[1];
    if (!rawRoundId) {
      diagnostics.error("error-missing-roundid-2", "Error: missing roundId");
      usage();
    }
    const roundId = normalizeRoundId(rawRoundId);
    store.removeRound(roundId);
    diagnostics.info("removed-round", `Removed round ${roundId} from the queue.`);
  } else {
    diagnostics.error("unknown-command", `Unknown command: ${cmd}`);
    usage();
  }
}

try {
  main();
} catch (error) {
  diagnostics.error("error", `Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
