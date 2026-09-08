// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '@sub-rosa/logging';
const diagnostics = createLogger("services.drand-tools.src.vectors");
// Emit a frozen quicknet test vector for the contract's Rust BLS test.
// Real network data captured at a fixed finalized round — not a mock.

import { getSystemEnv } from "@sub-rosa/config";
import { getBeacon, getChainInfo } from "./quicknet.js";
import { pubkeyToSoroban, negatedG2Generator, encodeG1, toHex } from "./encode.js";
import { bls12_381 as bls } from "@noble/curves/bls12-381.js";
import { verifyBeacon } from "./parity.js";

const env = getSystemEnv();
const ROUND = Number(env.VECTOR_ROUND ?? 29155653);

const info = await getChainInfo();
const b = await getBeacon(ROUND);

diagnostics.info("round", `ROUND = ${ROUND}`);
diagnostics.info("offchain-verify", `OFFCHAIN_VERIFY = ${verifyBeacon(ROUND, b.signature, info.public_key, "sha256(be8)")}`);
diagnostics.info("sig-g1", `SIG_G1 = ${toHex(encodeG1(bls.G1.Point.fromHex(b.signature)))}`);
diagnostics.info("pubkey-c0c1", `PUBKEY_C0C1 = ${toHex(pubkeyToSoroban(info.public_key, "c0c1"))}`);
diagnostics.info("pubkey-c1c0", `PUBKEY_C1C0 = ${toHex(pubkeyToSoroban(info.public_key, "c1c0"))}`);
diagnostics.info("neggen-c0c1", `NEGGEN_C0C1 = ${toHex(negatedG2Generator("c0c1"))}`);
diagnostics.info("neggen-c1c0", `NEGGEN_C1C0 = ${toHex(negatedG2Generator("c1c0"))}`);
