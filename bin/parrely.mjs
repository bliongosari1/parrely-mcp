#!/usr/bin/env node
// Parrely from the command line, for agents that can't install an MCP server. Every Parrely tool is a command.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync, statSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG = join(homedir(), ".parrely", "config.json");
const TOOLS_CACHE = join(homedir(), ".parrely", "tools.json");
const TOOLS_CACHE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_URL = "https://agents.parrely.com";

const HELP = `Parrely: hand off work between AI agents in any tool.

Usage:
  parrely login [--workspace NAME] [--name NAME] [--harness NAME]
                                      Sign in and choose which agent this computer acts as
  parrely login --device             Sign in with a short code on a headless machine
  parrely tools                     List every command
  parrely <command> [--arg value]   Run one, e.g.
    parrely briefing
    parrely handoff --to codex --title "Fix the flaky test" --context "What's done, what's left"
    parrely check-handoffs
    parrely remember "We deploy after 2pm on Fridays"
  parrely init                      Tell the agents in this repo to use Parrely (AGENTS.md, CLAUDE.md)

Options:
  --as NAME     Act as another agent you've logged in as (or set PARRELY_AGENT)
  --json        Print the raw response
`;

const readConfig = () => (existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {});

function writeConfig(c) {
  mkdirSync(dirname(CONFIG), { recursive: true });
  writeFileSync(CONFIG, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
}

/** Splits argv into positionals and --flags. A flag given twice becomes a list. */
export function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const v = inline ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true);
    flags[k] = k in flags ? [flags[k], v].flat() : v;
  }
  return { pos, flags };
}

function auth(flags) {
  const c = readConfig();
  const url = process.env.PARRELY_URL || c.url || DEFAULT_URL;
  const agent = flags.as || process.env.PARRELY_AGENT || c.agent;
  const token = process.env.PARRELY_TOKEN || (agent && c.tokens?.[agent]);
  if (!token) fail(agent ? `Not logged in as ${agent}. Run: parrely login` : "Not logged in. Run: parrely login");
  return { url, token };
}

async function call(flags, method, path, body) {
  const { url, token } = auth(flags);
  const res = await fetch(new URL(`/api/v1${path}`, url), {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e) => fail(`Couldn't reach Parrely at ${url}: ${e.message}`));
  if (res.status === 401) fail("Your Parrely key was replaced or revoked. Run: parrely login");
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function tools(flags, refresh = false) {
  const { url } = auth(flags);
  if (!refresh && existsSync(TOOLS_CACHE) && Date.now() - statSync(TOOLS_CACHE).mtimeMs < TOOLS_CACHE_MS) {
    try {
      const cached = JSON.parse(readFileSync(TOOLS_CACHE, "utf8"));
      if (cached.url === url) return cached.body;
    } catch {}
  }
  const { status, body } = await call(flags, "GET", "/tools");
  if (status >= 400 || !Array.isArray(body.tools)) fail(body.error ?? "Couldn't load Parrely commands.");
  mkdirSync(dirname(TOOLS_CACHE), { recursive: true });
  writeFileSync(TOOLS_CACHE, `${JSON.stringify({ url, body })}\n`, { mode: 0o600 });
  return body;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Turns --flags into tool arguments using the tool's schema: numbers, booleans, lists, and the first positional for its main text field. */
function toArgs(schema, pos, flags) {
  const props = schema?.properties ?? {};
  const args = {};
  for (const [rawKey, raw] of Object.entries(flags)) {
    if (rawKey === "as" || rawKey === "json") continue;
    const key = rawKey.replace(/-/g, "_");
    const type = props[key]?.type;
    const list = [raw].flat();
    const one = (v) => (type === "number" || type === "integer" || props[key]?.items?.type === "integer" || props[key]?.items?.type === "number" ? Number(v) : type === "boolean" ? v === true || v === "true" : v);
    args[key] = type === "array" ? list.flatMap((v) => String(v).split(",")).map(one) : one(list.at(-1));
  }
  if (pos.length) {
    const main = (schema?.required ?? []).find((k) => props[k]?.type === "string" && !(k in args)) ?? Object.keys(props).find((k) => props[k]?.type === "string" && !(k in args));
    if (!main) fail("This command takes --flags, not text. Run: parrely tools");
    args[main] = pos.join(" ");
  }
  return args;
}

const hint = (value) => (typeof value === "string" ? value : undefined);

function loginHints(flags) {
  return { name: hint(flags.name), harness: hint(flags.harness), workspace: hint(flags.workspace) };
}

function openBrowser(page) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  return new Promise((resolve) => {
    let finished = false;
    const done = (opened) => {
      if (!finished) resolve(opened);
      finished = true;
    };
    const child = spawn(opener, [page.toString()], { stdio: "ignore" });
    child.once("error", () => done(false));
    child.once("close", (code) => done(code === 0));
  });
}

async function browserLogin(url, flags) {
  const state = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      server.close();
      resolve(value);
    };
    const server = createServer((req, res) => {
      const q = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
      if (!req.url?.startsWith("/callback") || q.get("state") !== state || !q.get("token"))
        return void res.writeHead(400).end("Run parrely login again.");
      res.writeHead(200, { "content-type": "text/html" }).end("<p style=\"font:16px system-ui;margin:3em\">Parrely CLI connected. You can close this tab.</p>");
      finish({ agent: q.get("agent"), token: q.get("token") });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", async () => {
      const page = new URL("/cli/login", url);
      const hints = loginHints(flags);
      page.search = new URLSearchParams({
        port: String(server.address().port),
        state,
        ...Object.fromEntries(Object.entries(hints).filter(([, value]) => value)),
      }).toString();
      const opened = await openBrowser(page);
      if (opened) console.log(`Opening ${page.origin} to sign in. If nothing opens, visit:\n${page}`);
      else finish(null);
    });
  });
}

async function postLogin(url, path, body, fetchImpl) {
  const res = await fetchImpl(new URL(path, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

export async function deviceLogin(url, flags, { fetch: fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console.log } = {}) {
  const hints = loginHints(flags);
  const requested = await postLogin(
    url,
    "/cli/device",
    {
      agent_name: hints.name ?? hints.harness ?? "cursor",
      harness: hints.harness ?? hints.name ?? "cursor",
      ...(hints.workspace ? { workspace: hints.workspace } : {}),
    },
    fetchImpl,
  ).catch((e) => {
    throw new Error(`Couldn't reach Parrely at ${url}: ${e.message}`);
  });
  if (!requested.ok) throw new Error(requested.body.error_description ?? requested.body.error ?? `Device login failed (${requested.status}).`);

  const { device_code: deviceCode, user_code: userCode, verification_uri: verificationUri, verification_uri_complete: completeUri } = requested.body;
  if (!deviceCode || !userCode || !(completeUri || verificationUri)) throw new Error("Parrely returned an invalid device login response.");
  log(`Your code: ${userCode}\nOpen this URL to approve it:\n${completeUri || verificationUri}`);

  let interval = Math.max(1, Number(requested.body.interval) || 5) * 1000;
  for (;;) {
    await sleep(interval);
    const polled = await postLogin(url, "/cli/device/token", { device_code: deviceCode }, fetchImpl).catch((e) => {
      throw new Error(`Couldn't reach Parrely at ${url}: ${e.message}`);
    });
    if (polled.ok && polled.body.access_token && polled.body.agent)
      return { agent: polled.body.agent, token: polled.body.access_token };
    if (polled.body.error === "authorization_pending") continue;
    if (polled.body.error === "slow_down") {
      interval += 5000;
      continue;
    }
    throw new Error(polled.body.error_description ?? polled.body.error ?? `Device login failed (${polled.status}).`);
  }
}

async function login(flags) {
  const url = typeof flags.url === "string" ? flags.url : process.env.PARRELY_URL || readConfig().url || DEFAULT_URL;
  const useDevice = flags.device === true || !process.stdin.isTTY;
  const credentials = useDevice ? await deviceLogin(url, flags) : (await browserLogin(url, flags)) ?? (console.log("No browser is available. Switching to device login."), await deviceLogin(url, flags));
  const { agent, token } = credentials;
  const c = readConfig();
  writeConfig({ ...c, url, agent, tokens: { ...c.tokens, [agent]: token } });
  console.log(`Logged in as ${agent}. Try: parrely briefing`);
}

const RULES = `
## Parrely

This repo uses Parrely to coordinate AI agents. If the Parrely MCP tools aren't available, use the \`parrely\` CLI instead:

- At the start of a task, run \`parrely briefing\` and follow it.
- To hand work to another agent, run \`parrely handoff --to <agent> --title "<task>" --context "<what's done, what's left, how to test>"\`.
- To follow work you handed off, run \`parrely check-handoffs\`.
- On a handoff you took, run \`parrely report-progress --id <id> --note "<update>"\` as you go, and \`parrely finish-intent --id <intent> --summary "<what you did, PR link>"\` when done.
- \`parrely tools\` lists everything else.
`;

function init() {
  const files = ["AGENTS.md", "CLAUDE.md"].filter((f) => existsSync(f));
  const targets = files.length ? files : ["AGENTS.md"];
  for (const f of targets) {
    if (existsSync(f) && readFileSync(f, "utf8").includes("## Parrely")) {
      console.log(`${f} already mentions Parrely.`);
      continue;
    }
    appendFileSync(f, RULES);
    console.log(`Added Parrely instructions to ${f}.`);
  }
}

/** Replies name MCP tools like `check_handoffs`; show them as the commands to run instead. */
const asCommands = (text, tools) => text.replace(/`([a-z_]+)`/g, (m, n) => (tools.some((t) => t.name === n) ? `\`parrely ${n.replace(/_/g, "-")}\`` : m));

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parse(rest);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return console.log(HELP);
  if (cmd === "login") return login(flags);
  if (cmd === "init") return init();
  if (cmd === "tools") {
    const body = await tools(flags, true);
    if (flags.json) return console.log(JSON.stringify(body, null, 2));
    for (const t of body.tools ?? []) console.log(`${t.name.replace(/_/g, "-").padEnd(22)} ${t.description.split(/(?<=\.)\s+(?=[A-Z])/)[0]}`);
    return;
  }
  const name = cmd.replace(/-/g, "_");
  auth(flags);
  let available = (await tools(flags)).tools ?? [];
  let tool = available.find((t) => t.name === name);
  if (!tool) {
    available = (await tools(flags, true)).tools ?? [];
    tool = available.find((t) => t.name === name);
  }
  if (!tool) fail(`No command called "${cmd}". Run: parrely tools`);
  const { status, body } = await call(flags, "POST", `/tools/${name}`, toArgs(tool.inputSchema, pos, flags));
  if (flags.json) console.log(JSON.stringify(body, null, 2));
  else console.log(asCommands(body.text ?? body.error ?? "", available));
  if (status >= 400 || body.isError) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main().catch((e) => fail(e.message));
