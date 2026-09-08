// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from '../packages/logging/src/index.cjs';
const diagnostics = createLogger("scripts.check-fixture-sizes");
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GROUPS = [
  {
    label: "Receipt fixtures",
    dir: "services/receipt-cli/src/fixtures",
    perFileBytes: 10_240,
    totalBytes: 51_200,
    include: /\.json$/,
  },
  {
    label: "Contract test snapshots",
    dir: "contracts/round/test_snapshots/test",
    perFileBytes: 262_144,
    totalBytes: 5_242_880,
    include: /\.json$/,
  },
  {
    label: "Demo trace outputs",
    dir: "apps/web/src/demo",
    perFileBytes: 20_480,
    totalBytes: 51_200,
    include: /\.(ts|js)$/,
  },
];

function walk(dir, include) {
  const files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walk(full, include));
      } else if (!include || include.test(entry.name)) {
        files.push(full);
      }
    }
  } catch (error) {
    // Un directorio ausente es normal al recorrer en profundidad. Cualquier
    // otro error, como un permiso denegado, no lo es: tragarselo hacia que un
    // grupo ilegible se viera igual que uno vacio.
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
  }
  return files;
}

function formatBytes(bytes) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function checkGroup(group) {
  const files = walk(group.dir, group.include).map((f) => {
    const bytes = statSync(f).size;
    return { path: relative(process.cwd(), f), bytes, ok: bytes <= group.perFileBytes };
  });

  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
  const totalOk = totalBytes <= group.totalBytes;
  const allFilesOk = files.every((f) => f.ok);

  return {
    label: group.label,
    dir: group.dir,
    dirExists: existsSync(group.dir),
    files,
    totalBytes,
    totalOk,
    ok: allFilesOk && totalOk,
  };
}

function main() {
  let allPassed = true;

  for (const group of GROUPS) {
    const result = checkGroup(group);

    // Todo grupo configurado en GROUPS es obligatorio. Antes un grupo ausente
    // o vacio salia por SKIP y el proceso terminaba en 0, asi que borrar un
    // grupo entero desactivaba en silencio el presupuesto que lo cuidaba.
    //
    // Los dos casos se informan por separado a proposito: "no existe" y "esta
    // vacio" se arreglan distinto, y un solo mensaje para los dos te obliga a
    // ir a mirar cual de los dos fue.
    if (!result.dirExists) {
      diagnostics.info("fail", `  [FAIL] ${group.label} — required fixture directory is missing: ${group.dir}`);
      allPassed = false;
      continue;
    }

    if (result.files.length === 0) {
      diagnostics.info("progress", `  [FAIL] ${group.label} — required fixture directory has no matching files: ` +
          `${group.dir} (expected files matching ${group.include})`);
      allPassed = false;
      continue;
    }

    const perFileLimit = formatBytes(group.perFileBytes);
    const totalLimit = formatBytes(group.totalBytes);

    diagnostics.info("progress-2", `\n${result.label}  (per-file ≤ ${perFileLimit}, total ≤ ${totalLimit})`);
    diagnostics.info("progress-3", "-".repeat(60));

    for (const f of result.files) {
      const tag = f.ok ? "PASS" : "FAIL";
      const size = formatBytes(f.bytes);
      if (f.ok) {
        diagnostics.info("progress-4", `  [${tag}]  ${size.padStart(10)}  ${f.path}`);
      } else {
        diagnostics.info("progress-5", `  [${tag}]  ${size.padStart(10)}  ${f.path}  (limit ${perFileLimit})`);
        allPassed = false;
      }
    }

    const totalTag = result.totalOk ? "PASS" : "FAIL";
    const groupTag = result.ok ? "PASS" : "FAIL";
    const totalSize = formatBytes(result.totalBytes);
    diagnostics.info("progress-6", `  [${totalTag}]  ${totalSize.padStart(10)}  total  (limit ${totalLimit})`);
    diagnostics.info("group", `  Group: [${groupTag}]`);
  }

  diagnostics.info("progress-7", "");
  if (allPassed) {
    diagnostics.info("all-fixture-size-budgets-are-within-limits", "All fixture size budgets are within limits.");
    process.exit(0);
  } else {
    diagnostics.info("fixture-check-failed-a-budget-was-exceeded-or-a-require", "Fixture check failed: a budget was exceeded or a required group is missing.");
    diagnostics.info("to-update-budgets-edit-groups-in-scripts-check-fixture", "To update budgets, edit GROUPS in scripts/check-fixture-sizes.mjs.");
    process.exit(1);
  }
}

main();
