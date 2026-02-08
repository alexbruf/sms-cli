import type { Subprocess } from "bun";
import { unlinkSync } from "fs";

let serverProc: Subprocess | null = null;
let testDbPath: string | null = null;

export async function startServer(
  port: number,
  dbPath: string,
): Promise<void> {
  testDbPath = dbPath;
  serverProc = Bun.spawn(["bun", "run", "src/server/main.ts"], {
    cwd: import.meta.dir + "/../..",
    env: {
      ...process.env,
      SMS_SERVER_PORT: String(port),
      SMS_DB_PATH: dbPath,
      ASG_ENDPOINT: "http://localhost:19999",
      ASG_USERNAME: "test",
      ASG_PASSWORD: "test",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Server failed to start");
}

export function stopServer(): void {
  serverProc?.kill();
  serverProc = null;
  if (testDbPath) {
    try {
      unlinkSync(testDbPath);
    } catch {}
    try {
      unlinkSync(testDbPath + "-wal");
    } catch {}
    try {
      unlinkSync(testDbPath + "-shm");
    } catch {}
    testDbPath = null;
  }
}

export async function runCli(
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/main.ts", ...args], {
    cwd: import.meta.dir + "/../..",
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}
