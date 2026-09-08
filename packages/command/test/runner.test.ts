import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CommandError,
  ConfigError,
  DependencyError,
  ExitCode,
  UsageError,
  findRepoRoot,
  runCommand,
} from "../src/index.js";

/**
 * Creates a mock writable stream capturing written chunks into an array.
 *
 * @returns {{ stream: { write: (chunk: string) => boolean }, getOutput: () => string }}
 */
function createBufferStream() {
  const chunks: string[] = [];
  return {
    stream: {
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
    },
    getOutput() {
      return chunks.join("");
    },
  };
}

describe("Command Runner Lifecycle", () => {
  it("displays help and exits with 0 without running preflight or run handler", async () => {
    let preflightRan = false;
    let runRan = false;
    const stdout = createBufferStream();

    const exitCode = await runCommand(
      {
        name: "test-cmd",
        description: "A test command for help validation",
        options: {
          flag: { type: "boolean", short: "f", description: "A sample flag" },
        },
        requiredEnv: ["MANDATORY_ENV_VAR"],
        preflight() {
          preflightRan = true;
        },
        run() {
          runRan = true;
        },
      },
      {
        argv: ["--help"],
        env: {},
        stdout: stdout.stream,
        terminate: false,
      }
    );

    assert.equal(exitCode, ExitCode.SUCCESS);
    assert.equal(preflightRan, false);
    assert.equal(runRan, false);
    assert.match(stdout.getOutput(), /Usage: test-cmd/);
    assert.match(stdout.getOutput(), /A test command for help validation/);
    assert.match(stdout.getOutput(), /MANDATORY_ENV_VAR/);
  });

  it("fails with usage exit code on invalid arguments or missing positionals", async () => {
    const stderr = createBufferStream();

    const exitCodeUnknown = await runCommand(
      {
        name: "test-cmd",
        description: "Test argument validation",
        options: {
          verbose: { type: "boolean", short: "v" },
        },
        run() {},
      },
      {
        argv: ["--unknown-option"],
        stderr: stderr.stream,
        terminate: false,
      }
    );
    assert.equal(exitCodeUnknown, ExitCode.USAGE);

    const exitCodeMissingPositional = await runCommand(
      {
        name: "test-cmd",
        description: "Test positional validation",
        positionals: [
          { name: "target", description: "Target identifier", required: true },
        ],
        run() {},
      },
      {
        argv: [],
        stderr: stderr.stream,
        terminate: false,
      }
    );
    assert.equal(exitCodeMissingPositional, ExitCode.USAGE);
  });

  it("fails with config exit code when required environment variables are absent", async () => {
    const stderr = createBufferStream();

    const exitCode = await runCommand(
      {
        name: "test-cmd",
        description: "Test env preflight",
        requiredEnv: ["CRITICAL_CONFIG_KEY"],
        run() {},
      },
      {
        argv: [],
        env: {},
        stderr: stderr.stream,
        terminate: false,
      }
    );

    assert.equal(exitCode, ExitCode.CONFIG);
    assert.match(stderr.getOutput(), /Missing required environment variable: CRITICAL_CONFIG_KEY/);
  });

  it("fails with dependency exit code on external dependency failure", async () => {
    const stderr = createBufferStream();

    const exitCode = await runCommand(
      {
        name: "test-cmd",
        description: "Test dependency error mapping",
        run() {
          throw new DependencyError("RPC endpoint unreachable");
        },
      },
      {
        argv: [],
        stderr: stderr.stream,
        terminate: false,
      }
    );

    assert.equal(exitCode, ExitCode.DEPENDENCY);
    assert.match(stderr.getOutput(), /RPC endpoint unreachable/);
  });

  it("maps unexpected errors to code 1", async () => {
    const stderr = createBufferStream();

    const exitCode = await runCommand(
      {
        name: "test-cmd",
        description: "Test unexpected failure",
        run() {
          throw new Error("Unexpected database corruption");
        },
      },
      {
        argv: [],
        stderr: stderr.stream,
        terminate: false,
      }
    );

    assert.equal(exitCode, ExitCode.UNEXPECTED);
    assert.match(stderr.getOutput(), /Unexpected database corruption/);
  });

  it("propagates cancellation and returns interrupted exit code 130", async () => {
    const controller = new AbortController();
    const stderr = createBufferStream();
    let abortedInHandler = false;

    const promise = runCommand(
      {
        name: "test-cmd",
        description: "Test cancellation",
        async run(ctx) {
          controller.abort();
          if (ctx.signal.aborted) {
            abortedInHandler = true;
          }
          throw new Error("Execution cancelled");
        },
      },
      {
        argv: [],
        signal: controller.signal,
        stderr: stderr.stream,
        terminate: false,
      }
    );

    const exitCode = await promise;
    assert.equal(abortedInHandler, true);
    assert.equal(exitCode, ExitCode.INTERRUPTED);
  });

  it("executes registered cleanups in strict LIFO order exactly once", async () => {
    const events: string[] = [];
    const stderr = createBufferStream();

    const exitCode = await runCommand(
      {
        name: "test-cmd",
        description: "Test LIFO cleanup execution",
        run(ctx) {
          ctx.registerCleanup(() => {
            events.push("cleanup-1");
          });
          ctx.registerCleanup(() => {
            events.push("cleanup-2");
          });
          ctx.registerCleanup(() => {
            events.push("cleanup-3");
          });
          throw new Error("Failure triggering cleanup");
        },
      },
      {
        argv: [],
        stderr: stderr.stream,
        terminate: false,
      }
    );

    assert.equal(exitCode, ExitCode.UNEXPECTED);
    assert.deepEqual(events, ["cleanup-3", "cleanup-2", "cleanup-1"]);
  });

  it("continues executing remaining cleanups if an individual cleanup throws", async () => {
    const events: string[] = [];
    const stderr = createBufferStream();

    await runCommand(
      {
        name: "test-cmd",
        description: "Test resilient cleanup",
        run(ctx) {
          ctx.registerCleanup(() => {
            events.push("first-cleanup");
          });
          ctx.registerCleanup(() => {
            throw new Error("Faulty cleanup");
          });
          ctx.registerCleanup(() => {
            events.push("third-cleanup");
          });
        },
      },
      {
        argv: [],
        stderr: stderr.stream,
        terminate: false,
      }
    );

    assert.deepEqual(events, ["third-cleanup", "first-cleanup"]);
    assert.match(stderr.getOutput(), /Cleanup error: Faulty cleanup/);
  });

  it("operates independently of caller working directory and resolves repo root", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cmd-test-"));
    try {
      const detectedRoot = findRepoRoot(tmp);
      assert.ok(detectedRoot.length > 0);

      let resolvedPath = "";
      const exitCode = await runCommand(
        {
          name: "test-cmd",
          description: "Test cwd independence",
          run(ctx) {
            resolvedPath = ctx.resolvePath("package.json");
          },
        },
        {
          argv: [],
          repoRoot: detectedRoot,
          terminate: false,
        }
      );

      assert.equal(exitCode, ExitCode.SUCCESS);
      assert.equal(resolvedPath, join(detectedRoot, "package.json"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("supports custom integer exit codes returned from run handler", async () => {
    const exitCode = await runCommand(
      {
        name: "test-cmd",
        description: "Test numeric return",
        run() {
          return 5;
        },
      },
      {
        argv: [],
        terminate: false,
      }
    );
    assert.equal(exitCode, 5);
  });

  it("supports custom argument parser callback", async () => {
    let capturedArg = "";
    const exitCode = await runCommand(
      {
        name: "test-cmd",
        description: "Test custom parser",
        parseArgs(rawArgs) {
          return {
            args: { custom: rawArgs[0] || "" },
            positionals: rawArgs.slice(1),
          };
        },
        run(ctx) {
          capturedArg = ctx.args.custom;
        },
      },
      {
        argv: ["hello-world", "pos1"],
        terminate: false,
      }
    );

    assert.equal(exitCode, ExitCode.SUCCESS);
    assert.equal(capturedArg, "hello-world");
  });
});
