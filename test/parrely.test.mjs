import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deviceLogin, parse } from "../bin/parrely.mjs";

test("package exposes the parrely executable for npx", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "parrely");
  assert.equal(pkg.bin.parrely, "bin/parrely.mjs");

  const directory = await mkdtemp(join(tmpdir(), "parrely-bin-"));
  const executable = join(directory, "parrely");
  await symlink(new URL("../bin/parrely.mjs", import.meta.url), executable);
  await chmod(executable, 0o755);
  const result = spawnSync(executable, ["--help"], { encoding: "utf8" });
  await rm(directory, { recursive: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Parrely: hand off work/);
});

test("parse accepts login hints and device mode", () => {
  assert.deepEqual(parse(["--device", "--workspace", "team-one", "--name=cursor", "--harness", "cursor"]), {
    pos: [],
    flags: { device: true, workspace: "team-one", name: "cursor", harness: "cursor" },
  });
});

test("device login sends hints, waits, backs off, and returns credentials", async () => {
  const requests = [];
  const responses = [
    {
      ok: true,
      body: {
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: "https://agents.parrely.com/cli/device",
        verification_uri_complete: "https://agents.parrely.com/cli/device?code=ABCD-EFGH",
        interval: 2,
      },
    },
    { ok: false, status: 400, body: { error: "authorization_pending" } },
    { ok: false, status: 400, body: { error: "slow_down" } },
    { ok: true, body: { access_token: "agent-token", agent: "codex" } },
  ];
  const fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    const response = responses.shift();
    return { ok: response.ok, status: response.status ?? 200, json: async () => response.body };
  };
  const waits = [];
  const output = [];

  const credentials = await deviceLogin(
    "https://agents.parrely.com",
    { workspace: "team-one", name: "codex", harness: "codex" },
    { fetch, sleep: async (ms) => waits.push(ms), log: (message) => output.push(message) },
  );

  assert.deepEqual(credentials, { agent: "codex", token: "agent-token" });
  assert.deepEqual(requests[0], {
    url: "https://agents.parrely.com/cli/device",
    body: { agent_name: "codex", harness: "codex", workspace: "team-one" },
  });
  assert.deepEqual(requests.slice(1).map(({ body }) => body), [
    { device_code: "device-secret" },
    { device_code: "device-secret" },
    { device_code: "device-secret" },
  ]);
  assert.deepEqual(waits, [2000, 2000, 7000]);
  assert.match(output[0], /ABCD-EFGH[\s\S]*verification_uri|ABCD-EFGH[\s\S]*https:\/\/agents\.parrely\.com/);
});
