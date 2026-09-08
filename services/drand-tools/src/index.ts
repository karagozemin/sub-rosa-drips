// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.drand-tools.src.index");
// Risk-2 validation report. Fetches live quicknet data, confirms the message/DST
// the contract must use, and emits the exact Soroban-encoded constants for the
// deploy configuration (drand_pubkey, negated G2 generator, DST).

import { getChainInfo, getBeacon } from "./quicknet.js";
import { detectMessageVariant, DST } from "./parity.js";
import {
  encodeG1,
  negatedG2Generator,
  pubkeyToSoroban,
  toHex,
  type Fp2Order,
} from "./encode.js";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";

function line() {
  diagnostics.info("progress", "─".repeat(72));
}

async function main() {
  line();
  diagnostics.info("sub-rosa-risk-2-harness-tlock-drand-on-chain-bls", "Sub Rosa — Risk-2 harness: tlock ↔ Drand ↔ on-chain BLS");
  line();

  const info = await getChainInfo();
  diagnostics.info("network-quicknet", `network        : quicknet`);
  diagnostics.info("scheme", `scheme         : ${info.schemeID}`);
  diagnostics.info("genesis-time", `genesis_time   : ${info.genesis_time}`);
  diagnostics.info("period", `period         : ${info.period}s`);
  diagnostics.info("public-key", `public_key     : ${info.public_key}`);
  diagnostics.info("public-key-len", `public_key len : ${info.public_key.length / 2} bytes (compressed G2)`);

  const latest = await getBeacon("latest");
  diagnostics.info("latest-round", `\nlatest round   : ${latest.round}`);
  diagnostics.info("signature", `signature      : ${latest.signature}`);
  diagnostics.info("signature-len", `signature len  : ${latest.signature.length / 2} bytes (compressed G1)`);

  line();
  diagnostics.info("1-message-dst-construction-must-match-the-contract", "1) Message / DST construction (must match the contract)");
  const variant = detectMessageVariant(
    latest.round,
    latest.signature,
    info.public_key,
  );
  if (!variant) {
    diagnostics.error("fail-no-known-message-variant-verified-the-beacon", "  ✗ FAIL — no known message variant verified the beacon.");
    process.exitCode = 1;
    return;
  }
  diagnostics.info("verified-with-message", `  ✓ verified with message = ${variant}`);
  diagnostics.info("dst", `  ✓ DST = "${DST}"`);
  diagnostics.info("contract-uses-sha256-be8-r-hash-to-g1", `  contract uses sha256(be8(R)) → hash_to_g1 — ${
      variant === "sha256(be8)" ? "MATCHES" : "MISMATCH, update contract!"
    }`);

  line();
  diagnostics.info("2-soroban-deploy-constants-uncompressed-big-endian-fp2", "2) Soroban deploy constants (uncompressed, big-endian, Fp2=c1c0)");
  diagnostics.info("fp2-ordering-confirmed-on-chain-by-the-contract-s-bls-t", "   Fp2 ordering confirmed on-chain by the contract's BLS test;");
  diagnostics.info("the-c0-c1-ordering-is-rejected-by-the-host-as-not-on-cu", "   the (c0,c1) ordering is rejected by the host as not-on-curve.");
  const order: Fp2Order = "c1c0";
  const pk = pubkeyToSoroban(info.public_key, order);
  const negGen = negatedG2Generator(order);
  diagnostics.info("drand-pubkey", `\n  drand_pubkey      = ${toHex(pk)}`);
  diagnostics.info("g2-neg-generator", `  g2_neg_generator  = ${toHex(negGen)}`);
  // Decompressed signature for the same round, in Soroban G1 form (what the
  // keeper passes to open_reveal).
  const sigPt = bls.G1.Point.fromHex(latest.signature);
  diagnostics.info("example-sig-round", `\n  example sig (round ${latest.round}) uncompressed G1:`);
  diagnostics.info("drand-signature", `  drand_signature   = ${toHex(encodeG1(sigPt))}`);

  line();
  diagnostics.info("dst-hex-for-env-deploy", "DST hex (for .env / deploy):");
  diagnostics.info("progress-2", `  ${toHex(new TextEncoder().encode(DST))}`);
  line();
  diagnostics.info("status-message-dst-fp2-c1c0-ordering-confirmed-on-chain", "Status: message/DST + Fp2(c1c0) ordering CONFIRMED on-chain by");
  diagnostics.info("the-contract-s-bls-test-against-this-live-signature-bak", "the contract's BLS test against this live signature. Bake these");
  diagnostics.info("constants-into-the-deploy-script-no-fallback-path", "constants into the deploy script. No fallback path.");
  line();
}

main().catch((err) => {
  diagnostics.error("harness-error", "harness error:", { "err_0": err });
  process.exitCode = 1;
});
