/**
 * Real upload to Apify: creates the actor as PRIVATE (never public), builds it on Apify, and reports the outcome.
 * Making an actor public, listing it in the Store and setting a price stay deliberate human decisions.
 */
const API = "https://api.apify.com/v2";

export interface UploadSpec {
  name: string;
  title: string;
  description: string;
  files: Record<string, string>;
}

export interface UploadResult {
  actorId: string;
  name: string;
  consoleUrl: string;
  buildId: string;
  buildNumber: string | null;
  buildStatus: string;
  logTail: string[];
  created: boolean;
}

export class ApifyUploadError extends Error {
  constructor(
    message: string,
    public code: "token_rejected" | "name_taken" | "api_error" | "build_failed" | "build_timeout",
    public detail?: unknown,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;
export interface Options {
  fetchImpl?: Fetch;
  pollMs?: number;
  maxWaitMs?: number;
  onProgress?: (msg: string) => void;
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);
const VERSION = "0.1";

/** Files that belong on Apify: the project itself, without tests or app bookkeeping. */
export function uploadableFiles(files: Record<string, string>): { name: string; format: "TEXT"; content: string }[] {
  return Object.entries(files)
    .filter(([name]) => !name.startsWith("test/") && !name.startsWith("tests/") && name !== "listing.json" && !name.startsWith("node_modules/"))
    .map(([name, content]) => ({ name, format: "TEXT" as const, content }));
}

async function call(token: string, f: Fetch, method: string, path: string, body?: unknown): Promise<any> {
  const res = await f(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90_000),
  });
  if (res.status === 401 || res.status === 403) throw new ApifyUploadError("Apify rejected the token. Check APIFY_TOKEN in Settings, API keys.", "token_rejected");
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const type = json?.error?.type as string | undefined;
    if (type === "actor-name-not-unique") throw new ApifyUploadError("That actor name is already taken on your account.", "name_taken");
    throw new ApifyUploadError(`Apify returned HTTP ${res.status}${json?.error?.message ? `: ${json.error.message}` : ""}.`, "api_error", { status: res.status, error: json?.error });
  }
  return json?.data ?? json;
}

async function buildAndWait(token: string, actorId: string, o: Required<Pick<Options, "pollMs" | "maxWaitMs">> & Options, f: Fetch) {
  o.onProgress?.("Building on Apify");
  let build = await call(token, f, "POST", `/actors/${actorId}/builds?version=${VERSION}&useCache=true&waitForFinish=60`);
  const t0 = Date.now();
  while (!TERMINAL.has(build.status)) {
    if (Date.now() - t0 > o.maxWaitMs) throw new ApifyUploadError("The Apify build did not finish in time. It may still be running in the Console.", "build_timeout", { buildId: build.id });
    await new Promise((r) => setTimeout(r, o.pollMs));
    build = await call(token, f, "GET", `/actors/${actorId}/builds/${build.id}`);
  }
  let logTail: string[] = [];
  if (build.status !== "SUCCEEDED") {
    try {
      const res = await f(`${API}/actor-builds/${build.id}/log`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      logTail = (await res.text()).split("\n").filter(Boolean).slice(-25);
    } catch { /* the log is a courtesy */ }
  }
  return { build, logTail };
}

/** Creates the actor (private) and builds it. If the name is taken it tries name-2, name-3. */
export async function createAndBuild(token: string, spec: UploadSpec, opts: Options = {}): Promise<UploadResult> {
  const f = opts.fetchImpl ?? fetch;
  const o = { ...opts, pollMs: opts.pollMs ?? 3000, maxWaitMs: opts.maxWaitMs ?? 300_000 };
  const sourceFiles = uploadableFiles(spec.files);
  let actor: any = null;
  for (const suffix of ["", "-2", "-3"]) {
    try {
      o.onProgress?.("Creating the actor (private)");
      actor = await call(token, f, "POST", "/actors", {
        name: `${spec.name}${suffix}`.slice(0, 63),
        title: spec.title,
        description: spec.description,
        isPublic: false,
        versions: [{ versionNumber: VERSION, sourceType: "SOURCE_FILES", buildTag: "latest", sourceFiles }],
      });
      break;
    } catch (e) {
      if (!(e instanceof ApifyUploadError) || e.code !== "name_taken" || suffix === "-3") throw e;
    }
  }
  const { build, logTail } = await buildAndWait(token, actor.id, o, f);
  const result: UploadResult = {
    actorId: actor.id,
    name: actor.name,
    consoleUrl: `https://console.apify.com/actors/${actor.id}`,
    buildId: build.id,
    buildNumber: build.buildNumber ?? null,
    buildStatus: build.status,
    logTail,
    created: true,
  };
  if (build.status !== "SUCCEEDED") throw new ApifyUploadError(`The actor was created, but its Apify build ${build.status.toLowerCase()}.`, "build_failed", result);
  return result;
}

/** Pushes new source to an actor this app created earlier, then rebuilds. */
export async function updateAndBuild(token: string, actorId: string, spec: UploadSpec, opts: Options = {}): Promise<UploadResult> {
  const f = opts.fetchImpl ?? fetch;
  const o = { ...opts, pollMs: opts.pollMs ?? 3000, maxWaitMs: opts.maxWaitMs ?? 300_000 };
  o.onProgress?.("Updating the actor's source");
  await call(token, f, "PUT", `/actors/${actorId}/versions/${VERSION}`, { sourceType: "SOURCE_FILES", buildTag: "latest", sourceFiles: uploadableFiles(spec.files) });
  const { build, logTail } = await buildAndWait(token, actorId, o, f);
  const result: UploadResult = { actorId, name: spec.name, consoleUrl: `https://console.apify.com/actors/${actorId}`, buildId: build.id, buildNumber: build.buildNumber ?? null, buildStatus: build.status, logTail, created: false };
  if (build.status !== "SUCCEEDED") throw new ApifyUploadError(`The update was uploaded, but its Apify build ${build.status.toLowerCase()}.`, "build_failed", result);
  return result;
}

/** Latest build status of an actor, for scheduled maintenance. */
export async function latestBuild(token: string, actorId: string, f: Fetch = fetch): Promise<{ status: string; finishedAt: string | null } | null> {
  const data = await call(token, f, "GET", `/actors/${actorId}/builds?limit=1&desc=true`);
  const b = data?.items?.[0];
  return b ? { status: b.status, finishedAt: b.finishedAt ?? null } : null;
}

export async function deleteActor(token: string, actorId: string, f: Fetch = fetch): Promise<void> {
  await call(token, f, "DELETE", `/actors/${actorId}`);
}
