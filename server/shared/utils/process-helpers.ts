import { spawn } from "node:child_process";

export interface RunCommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  input?: string;
}

export interface RunCommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[] = [],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) } as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        resolve({
          ok: false,
          code: null,
          stdout,
          stderr: `Command not found: ${command}`,
        });
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}
