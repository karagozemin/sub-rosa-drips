<!-- SPDX-License-Identifier: MIT -->
# Receipt CLI

Export a round receipt from Soroban RPC, verify a receipt offline, or create a
redacted copy for a public demo. See the canonical [receipt format and verification
guide](../../docs/RECEIPTS.md) for the schema and verification guarantees.

Run the following commands from the repository root after `pnpm install`.
The CLI command runs inside `services/receipt-cli`, so relative file paths below
are relative to that workspace.

## Offline verification

Verify the committed golden fixture without a wallet or network access:

```sh
pnpm --filter @sub-rosa/receipt-cli receipt verify src/fixtures/golden.json
```

Request machine-readable output:

```sh
pnpm --filter @sub-rosa/receipt-cli receipt verify src/fixtures/golden.json --json
```

JSON output includes `valid`, `receiptId`, `roundId`, `checkedAt`, `errors`, and
`warnings`. Successful verification exits with code 0; invalid receipts, unreadable
files, malformed input, and usage errors exit with code 1. Warnings alone do not
make an otherwise valid receipt fail.

To also verify a local artifact, supply a receipt containing `artifactChecksum`
and the exact artifact file whose SHA-256 checksum was recorded in that receipt:

```sh
pnpm --filter @sub-rosa/receipt-cli receipt verify /absolute/path/to/receipt.json --json --verify-artifact-checksum /absolute/path/to/artifact.wasm
```

These are placeholder paths to your own files. A missing file, absent checksum
metadata, or checksum mismatch fails verification. The golden-fixture commands
above do not require an artifact file.

## Export from RPC

Export reads the configured network; it requires no transaction signing.
Replace the contract ID and round ID with a deployed contract and existing round:

```sh
CONTRACT_ID='<deployed-round-contract-id>' pnpm --filter @sub-rosa/receipt-cli receipt export 1
```

The command writes `round-1-receipt.json` in the CLI workspace.

| Variable | Meaning | Default |
| --- | --- | --- |
| `CONTRACT_ID` | Deployed round contract ID (`C…`) | Required |
| `RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NETWORK_PASSPHRASE` | Network passphrase | `Test SDF Network ; September 2015` |

## Redact a copy

Use an explicit output path to keep the original receipt intact:

```sh
pnpm --filter @sub-rosa/receipt-cli receipt redact src/fixtures/golden.json /tmp/sub-rosa-receipt.redacted.json
```

For which fields are removed and how redaction affects verification, consult the
[receipt guide](../../docs/RECEIPTS.md). Review the resulting file before publishing.

## Development checks

```sh
pnpm receipt-cli:test
pnpm receipt-cli:typecheck
```
