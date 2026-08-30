import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	PIF_DEFAULT_PORT,
	assertSafeWidgetPath,
	childEnvironment,
	createEnvelope,
	dartFileUri,
	decodeEnvelope,
	generateWidgetRegistry,
	parseWidgetManifest,
	pifProbeProof,
	pifUpgradeAuthorized,
	TrackerSync,
	addAppPage,
	parseAppManifest,
	renderAppManifest,
	setAppHome,
	slugifyAppId,
	type PifAppManifest,
	type PifEnvelope,
	type PifWidgetManifest,
	type PifWidgetSource,
	type TrackerState,
	widgetClassName,
} from "./pif-shared.ts";

type SessionState = "idle" | "running" | "awaiting-input" | "ended";
interface PifSession {
	id: string; name: string; host: boolean; state: SessionState; model: string; thinking: string;
	cwd: string; transcript: unknown[]; sessionFile?: string; exit?: { code: number | null; signal: string | null };
}
interface WidgetRecord extends PifWidgetManifest { enabled: boolean; installed: boolean; source: PifWidgetSource; }
interface HubState {
	sessions: Record<string, PifSession>;
	widgets: Record<string, WidgetRecord>;
	catalog: Record<string, WidgetRecord>;
	layout: Record<string, unknown>;
	models: string[];
	modelProviders: Record<string, any>;
	tracker: TrackerState;
	app: PifAppManifest | null;
	appError: string | null;
	health: { hub: "running" | "stopped"; flutter: string; reload: string; workspace: string; port: number; origin: "standalone" | "terminal" };
}

const text = (value: unknown, details: unknown = value) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details });

function resolvePiInvocation(extensionPath: string) {
	if (process.env.PIF_PI_BIN) return { command: process.env.PIF_PI_BIN, args: [] as string[] };
	const resources = path.resolve(path.dirname(extensionPath), "..");
	const node = path.join(resources, "node"); const cli = path.join(resources, "cli", "dist", "cli.js");
	return fs.existsSync(node) && fs.existsSync(cli) ? { command: node, args: [cli] } : { command: "pi", args: [] as string[] };
}

/** Per-project session persistence. SQLite via node:sqlite when the
 * runtime provides it, JSON file fallback otherwise. Stores child
 * sessions as metadata only — transcripts live in the session `.jsonl`
 * files, which resume already reads, so the DB never duplicates or
 * lags behind them. */
class SessionStore {
	private db: any = null;
	private jsonPath: string = "";
	private json: { sessions: any[] } = { sessions: [] };
	private pifDir: string;
	constructor(pifDir: string) { this.pifDir = pifDir; }
	async init() {
		try {
			// Feature-detect node:sqlite separately from opening the file so a
			// corrupt DB file falls back to JSON instead of crashing init.
			const sqlite = await import("node:sqlite").catch(() => null);
			if (!sqlite || typeof sqlite.DatabaseSync !== "function") throw new Error("node:sqlite unavailable");
			const { DatabaseSync } = sqlite;
			this.db = new DatabaseSync(path.join(this.pifDir, "sessions.db"));
			// WAL keeps a hard kill mid-write from corrupting the DB (the
			// default journal_mode=memory does not); busy_timeout lets a
			// second writer wait instead of throwing SQLITE_BUSY immediately.
			this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA user_version = 1;");
			this.db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, model TEXT, thinking TEXT, cwd TEXT, session_file TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
			this.migrateTranscriptColumn();
		} catch {
			this.jsonPath = path.join(this.pifDir, "sessions.json");
			try { const parsed = JSON.parse(fs.readFileSync(this.jsonPath, "utf8")); if (parsed && Array.isArray(parsed.sessions)) this.json = parsed; } catch { /* absent */ }
		}
	}
	/** v1 stored full transcript blobs inline; v2 drops the column. */
	private migrateTranscriptColumn() {
		const columns: any[] = this.db.prepare("PRAGMA table_info(sessions)").all();
		if (!columns.some((column) => column.name === "transcript")) return;
		this.db.exec("ALTER TABLE sessions DROP COLUMN transcript");
	}
	/** Keep the newest `keep` sessions per workspace; older rows (and
	 * their session files) are deleted so history stops growing forever. */
	prune(keep: number, removeSessionFile: (file: string) => void) {
		const rows: any[] = this.db
			? this.db.prepare("SELECT id, session_file FROM sessions ORDER BY updated_at DESC").all()
			: [...this.json.sessions].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
		for (const row of rows.slice(keep)) {
			this.safe("remove", () => this.remove(String(row.id)));
			if (row.session_file) removeSessionFile(String(row.session_file));
		}
		return rows.length - Math.min(rows.length, keep);
	}
	/** Persistence is best-effort: the in-memory session always survives,
	 * so store failures are logged and swallowed rather than crashing an
	 * exit callback or aborting shutdown teardown mid-sequence. */
	safe(label: string, action: () => void) {
		try { action(); } catch (error) { console.error(`[pif] session store ${label} failed:`, (error as Error)?.message ?? error); }
	}
	upsert(session: PifSession) {
		const now = new Date().toISOString();
		if (this.db) {
			this.db.prepare("INSERT INTO sessions (id, name, model, thinking, cwd, session_file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, model = excluded.model, thinking = excluded.thinking, updated_at = excluded.updated_at")
				.run(session.id, session.name, session.model, session.thinking, session.cwd, session.sessionFile ?? null, now, now);
		} else {
			const record = { id: session.id, name: session.name, model: session.model, thinking: session.thinking, cwd: session.cwd, session_file: session.sessionFile ?? null, created_at: now, updated_at: now };
			const at = this.json.sessions.findIndex((row) => row.id === session.id);
			if (at >= 0) this.json.sessions[at] = { ...this.json.sessions[at], ...record, created_at: this.json.sessions[at].created_at ?? now }; else this.json.sessions.push(record);
			this.saveJson();
		}
	}
	rename(id: string, name: string) {
		if (this.db) this.db.prepare("UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?").run(name, new Date().toISOString(), id);
		else { const row = this.json.sessions.find((entry) => entry.id === id); if (row) { row.name = name; row.updated_at = new Date().toISOString(); this.saveJson(); } }
	}
	remove(id: string) {
		if (this.db) this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
		else { this.json.sessions = this.json.sessions.filter((entry) => entry.id !== id); this.saveJson(); }
	}
	list(): any[] {
		if (this.db) return this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all();
		return [...this.json.sessions].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
	}
	private saveJson() {
		fs.mkdirSync(this.pifDir, { recursive: true });
		const temp = `${this.jsonPath}.tmp`;
		fs.writeFileSync(temp, JSON.stringify(this.json, null, 2) + "\n");
		fs.renameSync(temp, this.jsonPath);
	}
}

class WsPeer {
	private buffer = Buffer.alloc(0);
	private socket: net.Socket; private onMessage: (raw: string) => void; private onClose: () => void;
	constructor(socket: net.Socket, onMessage: (raw: string) => void, onClose: () => void) {
		this.socket = socket; this.onMessage = onMessage; this.onClose = onClose;
		socket.on("data", (chunk) => this.read(chunk)); socket.on("close", onClose); socket.on("error", onClose);
	}
	send(value: unknown) {
		this.sendRaw(Buffer.from(JSON.stringify(value)));
	}
	/** Pre-serialized frame body (used to stringify once per broadcast). */
	sendRaw(payload: Buffer) {
		let header: Buffer;
		if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
		else if (payload.length <= 0xffff) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
		else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
		this.socket.write(Buffer.concat([header, payload]));
	}
	close() { try { this.socket.end(Buffer.from([0x88, 0x00])); } catch { /* closed */ } }
	private read(chunk: Buffer) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (this.buffer.length >= 2) {
			const first = this.buffer[0], second = this.buffer[1];
			const opcode = first & 0x0f; let length = second & 0x7f; let offset = 2;
			if (length === 126) { if (this.buffer.length < 4) return; length = this.buffer.readUInt16BE(2); offset = 4; }
			else if (length === 127) { if (this.buffer.length < 10) return; const n = this.buffer.readBigUInt64BE(2); if (n > BigInt(16 * 1024 * 1024)) return this.close(); length = Number(n); offset = 10; }
			const masked = Boolean(second & 0x80); const needed = offset + (masked ? 4 : 0) + length;
			if (this.buffer.length < needed) return;
			let payload: Buffer;
			if (masked) { const mask = this.buffer.subarray(offset, offset + 4); offset += 4; payload = Buffer.from(this.buffer.subarray(offset, offset + length)); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; }
			else payload = this.buffer.subarray(offset, offset + length);
			this.buffer = this.buffer.subarray(needed);
			if (opcode === 1) this.onMessage(payload.toString("utf8")); else if (opcode === 8) return this.close(); else if (opcode === 9) this.socket.write(Buffer.from([0x8a, 0x00]));
		}
	}
}

class FlutterSupervisor {
	process: ChildProcessWithoutNullStreams | null = null;
	appId: string | null = null;
	state = "stopped";
	private requestId = 0;
	private pending = new Map<number, (value: any) => void>();
	private appDir: string; private changed: (state: string, detail?: unknown) => void;
	constructor(appDir: string, changed: (state: string, detail?: unknown) => void) { this.appDir = appDir; this.changed = changed; }
	start(env: NodeJS.ProcessEnv) {
		if (this.process) return;
		this.state = "starting"; this.changed(this.state);
		const child = spawn("flutter", ["run", "--machine", "-d", "macos"], { cwd: this.appDir, env, stdio: ["pipe", "pipe", "pipe"] });
		this.process = child;
		let stdout = "";
		child.stdout.on("data", (chunk) => { stdout += chunk; let at; while ((at = stdout.indexOf("\n")) >= 0) { const line = stdout.slice(0, at).trim(); stdout = stdout.slice(at + 1); if (line) this.consume(line); } });
		child.stderr.on("data", (chunk) => this.changed("diagnostic", chunk.toString()));
		child.on("exit", (code, signal) => { this.process = null; this.appId = null; this.state = "stopped"; this.changed(this.state, { code, signal }); });
	}
	private consume(line: string) {
		try {
			const value = JSON.parse(line); const items = Array.isArray(value) ? value : [value];
			for (const item of items) {
				if (item.event === "app.start") { this.appId = item.params?.appId; this.state = "running"; this.changed(this.state, item.params); }
				if (item.event === "app.stop") { this.state = "stopped"; this.changed(this.state, item.params); }
				if (item.id && this.pending.has(item.id)) { this.pending.get(item.id)!(item); this.pending.delete(item.id); }
			}
		} catch { /* human flutter output */ }
	}
	request(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<any> {
		if (!this.process) return Promise.reject(new Error("Flutter shell is not running"));
		const id = ++this.requestId; const payload = { id, method, params: this.appId ? { appId: this.appId, ...params } : params };
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs); timer.unref?.();
			this.pending.set(id, (value) => { clearTimeout(timer); value?.error ? reject(new Error(JSON.stringify(value.error))) : resolve(value); });
			this.process!.stdin.write(JSON.stringify([payload]) + "\n");
		});
	}
	async reload(restart = false) { return this.request("app.restart", { fullRestart: restart }); }
	async relaunch(env: NodeJS.ProcessEnv) { if (!this.process) this.start(env); }
	async stop() { if (!this.process) return; try { await this.request("app.stop", {}, 5_000); } catch { this.process.kill("SIGTERM"); } }
}

class PifHub {
	readonly appDir: string; readonly pifDir: string; readonly controlPath: string; readonly layoutPath: string; readonly registryStatePath: string; readonly prefsPath: string;
	readonly globalCatalogPath: string;
	readonly state: HubState;
	readonly modelsPath: string;
	readonly token: string;
	readonly pi: ExtensionAPI; readonly ctx: ExtensionContext; readonly workspace: string; readonly port: number;
	private controlSecret = "";
	private readonly allowedOrigins: string[];
	private httpServer: http.Server | null = null; private controlServer: net.Server | null = null;
	private peers = new Set<WsPeer>(); private children = new Map<string, ChildProcessWithoutNullStreams>();
	private enabled = new Set<string>(); private installed = new Set<string>();
	private supervisor: FlutterSupervisor;
	private tracker: TrackerSync;
	readonly store: SessionStore;
	constructor(pi: ExtensionAPI, ctx: ExtensionContext, workspace: string, port: number) {
		this.pi = pi; this.ctx = ctx; this.workspace = workspace; this.port = port;
		const globalApp = path.join(os.homedir(), ".pi", "pif", "app");
		const localApp = path.join(workspace, "pif");
		this.appDir = process.env.PIF_APP_DIR || (fs.existsSync(path.join(localApp, "pubspec.yaml")) ? localApp : globalApp);
		// Layered widget sources (#155): the global catalog is shared across
		// projects; the project overlay lives in the workspace regardless of
		// where the app itself runs from.
		this.globalCatalogPath = process.env.PIF_GLOBAL_CATALOG || path.join(os.homedir(), ".pi", "pif", "catalog");
		this.pifDir = path.join(workspace, ".pi", "pif");
		this.controlPath = path.join(this.pifDir, "control.sock"); this.layoutPath = path.join(this.pifDir, "layout.json"); this.registryStatePath = path.join(this.pifDir, "registry.json"); this.prefsPath = path.join(this.pifDir, "prefs.json");
		this.state = { sessions: {}, widgets: {}, catalog: {}, layout: {}, models: [], modelProviders: {}, tracker: { repo: null, columns: [], cards: [], stale: true, fetchedAt: null, error: null }, app: null, appError: null, health: { hub: "stopped", flutter: "stopped", reload: "idle", workspace, port, origin: process.env.PIF_AUTOSTART === "1" && process.env.PIF_NO_FLUTTER === "1" ? "standalone" : "terminal" } };
		this.modelsPath = process.env.PIF_MODELS_PATH || path.join(os.homedir(), ".pi", "agent", "models.json");
		this.token = process.env.PIF_TOKEN || crypto.randomBytes(32).toString("hex");
		this.allowedOrigins = (process.env.PIF_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
		this.supervisor = new FlutterSupervisor(this.appDir, (status, detail) => { this.state.health.flutter = status; this.broadcast("shell/health", "state", { ...this.state.health, detail }); });
		this.tracker = new TrackerSync(workspace, (state) => { this.state.tracker = state; this.broadcast("tracker/state", "state", state); });
		this.state.tracker = this.tracker.state;
		this.store = new SessionStore(this.pifDir);
	}
	async start(launchFlutter = true) {
		if (this.httpServer) return;
		fs.mkdirSync(this.pifDir, { recursive: true }); this.loadLayout();
		await this.store.init();
		await this.tracker.init(); this.tracker.start();
		// Ephemeral control-socket credential: same-user processes can read
		// any 0600 file, but requiring a per-launch secret in the handshake
		// stops accidental/unwitting tool calls from other local processes.
		this.controlSecret = crypto.randomBytes(32).toString("hex");
		const tokenPath = path.join(this.pifDir, "token");
		fs.writeFileSync(`${tokenPath}.tmp`, this.token, { mode: 0o600 }); fs.renameSync(`${tokenPath}.tmp`, tokenPath);
		try { fs.chmodSync(tokenPath, 0o600); fs.writeFileSync(path.join(this.pifDir, "control.secret"), this.controlSecret, { mode: 0o600 }); } catch { /* perms best-effort */ }
		this.state.models = this.readModelsList(); this.state.modelProviders = this.readModelsConfig();
		const hasRegistryState = fs.existsSync(this.registryStatePath); this.loadRegistryState(); this.syncRepoTemplates(); this.scanWidgets();
		if (!hasRegistryState) { for (const widget of Object.values(this.state.widgets)) { widget.enabled = true; this.enabled.add(widget.id); } this.saveRegistryState(); }
		this.createHostSession(); this.prunePersistedSessions(); this.loadPersistedSessions(); await this.startWebSocket(); await this.startControl();
		this.state.health.hub = "running"; this.setStatus(); this.broadcastSnapshot();
		if (launchFlutter) this.supervisor.start({ ...process.env, PIF_PORT: String(this.port), PIF_WORKSPACE: this.workspace, PIF_TOKEN: this.token });
	}
	async stop() {
		for (const child of this.children.values()) this.terminateChild(child);
		for (const session of Object.values(this.state.sessions)) if (!session.host) this.store.safe("upsert", () => this.store.upsert(session));
		this.children.clear(); this.tracker.stop(); await this.supervisor.stop(); for (const peer of this.peers) peer.close(); this.peers.clear();
		await Promise.all([new Promise<void>((r) => this.httpServer?.close(() => r()) ?? r()), new Promise<void>((r) => this.controlServer?.close(() => r()) ?? r())]);
		this.httpServer = null; this.controlServer = null; try { fs.unlinkSync(this.controlPath); } catch { /* absent */ }
		this.state.health.hub = "stopped"; this.setStatus();
	}
	private terminateChild(child: ChildProcessWithoutNullStreams) {
		let exited = false; child.once("exit", () => { exited = true; });
		child.kill("SIGTERM");
		setTimeout(() => { if (!exited) { try { child.kill("SIGKILL"); } catch { /* already gone */ } } }, 1_000).unref();
	}
	private setStatus() { try { this.ctx.ui.setStatus("pif", this.state.health.hub === "running" ? `pif ● :${this.port}` : undefined); } catch { /* non-interactive */ } }
	private createHostSession() {
		const prefs = this.loadPrefs();
		const sessionFile = process.env.PIF_HOST_SESSION_FILE || undefined;
		const host: PifSession = { id: "host", name: prefs.name || "Host session", host: true, state: "idle", model: this.canonicalModel(prefs.model) || (this.ctx as any).model?.id || "host", thinking: prefs.thinking || (this.ctx as any).thinkingLevel || "medium", cwd: this.workspace, transcript: [], ...(sessionFile ? { sessionFile } : {}) };
		this.state.sessions.host = host;
		if (sessionFile) { fs.mkdirSync(path.dirname(sessionFile), { recursive: true }); fs.writeFileSync(sessionFile, "", { flag: "a", mode: 0o600 }); this.hydrateTranscript(host); }
	}
	/** Session model ids sometimes lack the provider prefix; resolve to the
	 * full id from the available models when the suffix match is unique. */
	private canonicalModel(model: string | undefined): string {
		if (!model || this.state.models.includes(model)) return model ?? "";
		const matches = this.state.models.filter((candidate) => candidate.endsWith(`/${model}`));
		return matches.length === 1 ? matches[0] : model;
	}
	/** Retention: keep the newest sessions per workspace so the store and
	 * its session files stop growing forever. */
	private prunePersistedSessions() {
		const keep = Number(process.env.PIF_SESSION_RETENTION) || 50;
		this.store.safe("prune", () => this.store.prune(keep, (file) => { try { fs.rmSync(file, { force: true }); } catch { /* absent */ } }));
	}
	/** Restored child sessions from the store: read-only history — their
	 * processes are gone, so they load as ended. Only metadata rows are
	 * read; transcripts hydrate lazily from the session `.jsonl` (the
	 * source of truth) on first selection/resume. */
	private loadPersistedSessions() {
		for (const row of this.store.list()) {
			const id = String(row.id);
			if (id === "host" || this.state.sessions[id]) continue;
			this.state.sessions[id] = { id, name: String(row.name ?? "Agent"), host: false, state: "ended", model: String(row.model ?? "default"), thinking: String(row.thinking ?? "medium"), cwd: String(row.cwd ?? this.workspace), transcript: [], sessionFile: row.session_file ? String(row.session_file) : undefined, exit: { code: null, signal: null }, hydrated: false };
		}
	}
	/** Fill a session's transcript from its `.jsonl` file once. The file is
	 * authoritative: the DB never stored transcripts after v2, and resume
	 * already replays it. Falls back to an empty history when absent. */
	private hydrateTranscript(session: PifSession) {
		if ((session as any).hydrated) return;
		(session as any).hydrated = true;
		if (!session.sessionFile || session.transcript.length) return;
		try {
			const lines = fs.readFileSync(session.sessionFile, "utf8").split("\n").filter(Boolean);
			for (const line of lines) {
				let value: any; try { value = JSON.parse(line); } catch { continue; }
				session.transcript.push({ ...this.normalizeEntry(String(value.type ?? "event"), value), ts: this.eventTimestamp(value) });
			}
		} catch { /* absent or unreadable — keep empty */ }
	}
	private eventTimestamp(value: any): string {
		const raw = value?.ts ?? value?.timestamp ?? value?.message?.timestamp;
		if (typeof raw === "number" && Number.isFinite(raw)) return new Date(raw).toISOString();
		if (typeof raw === "string") {
			const numeric = Number(raw);
			if (Number.isFinite(numeric) && raw.trim() !== "") return new Date(numeric).toISOString();
			const parsed = Date.parse(raw);
			if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
		}
		return new Date().toISOString();
	}
	private isUserBoundaryEcho(type: string, payload: any) { return (type === "message_start" || type === "message_end") && payload?.message?.role === "user"; }
	private loadPrefs(): { model?: string; thinking?: string; name?: string } { try { const prefs = JSON.parse(fs.readFileSync(this.prefsPath, "utf8")); return prefs && typeof prefs === "object" ? prefs : {}; } catch { return {}; } }
	private savePrefs(patch: { model?: string; thinking?: string; name?: string }) {
		fs.mkdirSync(path.dirname(this.prefsPath), { recursive: true });
		fs.writeFileSync(this.prefsPath, JSON.stringify({ ...this.loadPrefs(), ...patch }, null, 2) + "\n");
	}
	private startWebSocket() {
		return new Promise<void>((resolve, reject) => {
			// Health discloses only identity + coarse state — never the
			// absolute workspace path. /probe proves hub identity: it echoes
			// an HMAC of the caller's nonce under the hub token, so a port
			// squatter cannot pass itself off as our hub.
			const server = http.createServer((req, res) => {
				const url = new URL(req.url ?? "/", "http://127.0.0.1");
				res.writeHead(200, { "content-type": "application/json" });
				if (url.pathname === "/probe") {
					const nonce = String(url.searchParams.get("nonce") ?? "");
					return res.end(JSON.stringify({ name: "pif", nonce, proof: nonce ? pifProbeProof(nonce, this.token) : null }));
				}
				res.end(JSON.stringify({ name: "pif", status: { hub: this.state.health.hub } }));
			});
			server.on("upgrade", (req, socket) => {
				const pathname = (req.url ?? "/").split("?")[0];
				if (pathname !== "/pif" || !req.headers["sec-websocket-key"]) return socket.destroy();
				const origin = req.headers.origin;
				if (!pifUpgradeAuthorized(req.url ?? "/", typeof origin === "string" ? origin : undefined, this.token, this.allowedOrigins)) {
					socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return socket.destroy();
				}
				const accept = crypto.createHash("sha1").update(String(req.headers["sec-websocket-key"]) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
				socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
				let peer!: WsPeer; peer = new WsPeer(socket, (raw) => this.receive(raw, peer), () => this.peers.delete(peer)); this.peers.add(peer); peer.send(this.snapshotEnvelope());
			});
			server.once("error", reject); server.listen(this.port, "127.0.0.1", () => { server.off("error", reject); this.httpServer = server; resolve(); });
		});
	}
	private startControl() {
		return new Promise<void>((resolve, reject) => {
			try { fs.unlinkSync(this.controlPath); } catch { /* absent */ }
			const server = net.createServer((socket) => {
				let input = ""; let authorized = false; socket.on("data", (chunk) => {
					input += chunk;
					if (!authorized) {
						// Handshake line must carry the per-launch control
						// secret; everything else is rejected and dropped.
						const at = input.indexOf("\n"); if (at < 0) return;
						const first = input.slice(0, at); input = input.slice(at + 1);
						let secret: unknown = null; try { secret = JSON.parse(first).secret; } catch { /* malformed */ }
						const expected = Buffer.from(this.controlSecret), provided = Buffer.from(String(secret ?? ""));
						if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
							socket.end(JSON.stringify({ ok: false, error: "control socket authorization failed" }) + "\n", () => socket.destroy());
							return;
						}
						authorized = true; if (!input.trim()) return;
					}
					const at = input.indexOf("\n"); if (at < 0) return; const raw = input.slice(0, at); input = input.slice(at + 1); Promise.resolve().then(async () => { const req = JSON.parse(raw); return this.control(req.method, req.params ?? {}); }).then((result) => socket.end(JSON.stringify({ ok: true, result }) + "\n"), (error) => socket.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }) + "\n"));
				});
			});
			server.once("error", reject); server.listen(this.controlPath, () => { server.off("error", reject); this.controlServer = server; try { fs.chmodSync(this.controlPath, 0o600); } catch { /* perms best-effort */ } resolve(); });
		});
	}
	private snapshotEnvelope() { return createEnvelope("shell/state", "snapshot", this.snapshot()); }
	/** Wire snapshot: rail metadata only. Transcripts ship separately via
	 * `session/transcript` so payload size stays independent of total
	 * history (deep-cloning every session's full transcript on every
	 * connect/broadcast froze the hub for seconds on long histories). */
	snapshot() {
		const state = JSON.parse(JSON.stringify({ ...this.state, sessions: {} })) as HubState;
		for (const [id, session] of Object.entries(this.state.sessions)) {
			const { transcript, ...meta } = session;
			state.sessions[id] = { ...meta, transcript: [] } as PifSession;
		}
		return state as unknown as Record<string, unknown>;
	}
	sessionTranscript(id: string) { const s = this.state.sessions[id]; if (!s) throw new Error(`Unknown session ${id}`); this.hydrateTranscript(s); return { sessionId: id, transcript: s.transcript }; }
	private broadcastSnapshot() { this.send(this.snapshotEnvelope()); }
	broadcast(channel: PifEnvelope["channel"], type: string, payload: unknown) { this.send(createEnvelope(channel, type, payload)); }
	private send(env: PifEnvelope) {
		if (!this.peers.size) return;
		const payload = Buffer.from(JSON.stringify(env));
		for (const peer of this.peers) peer.sendRaw(payload);
	}
	private async receive(raw: string, peer: WsPeer) {
		let env: PifEnvelope; try { env = decodeEnvelope(raw); } catch (error) { peer.send(createEnvelope("shell/error", "invalid_envelope", { requestId: null, error: String(error) })); return; }
		try {
			if (env.channel === "shell/state" && env.type === "snapshot_request") return peer.send(this.snapshotEnvelope());
			if (env.channel === "shell/state" && env.type === "shutdown_request") return void this.shutdown();
			if (env.channel === "session/control" && env.type === "transcript") return peer.send(createEnvelope("session/transcript", "history", this.sessionTranscript((env.payload as any)?.sessionId)));
			if (env.channel.startsWith("session/")) await this.sessionAction(env.type, env.payload as any);
			else if (env.channel.startsWith("widget/")) await this.widgetAction(env.type, env.payload as any);
			else if (env.channel.startsWith("store/")) await this.storeAction(env.type, env.payload as any);
			else if (env.channel.startsWith("models/")) await this.modelsAction(env.type, env.payload as any);
			else if (env.channel.startsWith("tracker/")) this.trackerAction(env.type, env.payload as any);
			else if (env.channel.startsWith("shell/")) await this.layoutAction(env.type, env.payload as any);
		} catch (error) { peer.send(createEnvelope("shell/error", "action_failed", { requestId: env.id, error: String((error as Error).message) })); }
	}
	hostEvent(type: string, payload: unknown) {
		const host = this.state.sessions.host; if (!host) return;
		if (this.isUserBoundaryEcho(type, payload)) return;
		if (type === "agent_start") host.state = "running"; if (type === "agent_end") host.state = "idle";
		const entry = { ...this.normalizeEntry(type, payload), ts: this.eventTimestamp(payload) }; host.transcript.push(entry); if (host.transcript.length > 2_000) host.transcript.shift();
		this.broadcast("session/host", type, { sessionId: "host", state: host.state, event: entry });
	}
	private normalizeEntry(type: string, payload: any): Record<string, unknown> {
		const p = payload ?? {};
		if (type === "input") return { type: "input", content: String(p.content ?? p.prompt ?? "") };
		if (type === "custom_message" && p.customType === "pif-input") return { type: "input", content: String(p.content ?? "") };
		if (type === "message_update" || type === "message_start" || type === "message" || type === "message_end") {
			const delta = p.assistantMessageEvent?.delta ?? p.delta;
			if (delta) return { type: "message_update", delta: String(delta), ...(p.command !== undefined ? { command: String(p.command) } : {}) };
			const content = p.message?.content;
			const messageText = Array.isArray(content) ? content.filter((c: any) => c?.type === "text").map((c: any) => c?.text ?? "").join("") : typeof content === "string" ? content : "";
			if (messageText) return p.message?.role === "user" ? { type: "input", content: messageText } : { type: "message", text: messageText };
			return { type: "message_update", delta: "" };
		}
		if (type.includes("tool")) return { type, toolName: String(p.toolName ?? p.name ?? "tool"), toolCallId: String(p.toolCallId ?? p.id ?? ""), args: p.args ? JSON.stringify(p.args).slice(0, 300) : undefined, result: p.result ? String(p.result).slice(0, 300) : undefined };
		if (type === "agent_start" || type === "agent_end") {
			// Surface the model id and cumulative token usage pi already
			// reports so the shell status bar shows real data.
			const usage = p.usage?.totalTokens ?? p.message?.usage?.totalTokens;
			return {
				type,
				state: type === "agent_start" ? "running" : "idle",
				...(p.aborted !== undefined ? { aborted: Boolean(p.aborted) } : {}),
				...(this.ctxModelId() ? { model: this.ctxModelId() } : {}),
				...(usage != null ? { usage: { totalTokens: Number(usage) } } : {}),
			};
		}
		if (type === "stderr" || type === "output") return { type, data: String(p.data ?? p).slice(0, 500) };
		return { type, data: JSON.stringify(p).slice(0, 500) };
	}
	private ctxModelId(): string | undefined {
		const model = (this.ctx as any)?.model;
		return typeof model?.id === "string" && model.id ? model.id : undefined;
	}
	/** Rail-level metadata for a session: everything except the transcript
	 * (which ships on demand via session/transcript). */
	private sessionPatch(session: PifSession) {
		const { transcript, ...meta } = session;
		return meta;
	}
	private async sessionAction(type: string, payload: any) {
		if (type === "spawn") return this.spawnSession(payload);
		if (type === "resume") return this.resumeSession(payload);
		const id = payload.sessionId ?? "host";
		if (type === "select") {
			if (!this.state.sessions[id]) throw new Error(`Unknown session ${id}`);
			this.broadcast("session/selection", "selected", { sessionId: id });
			return this.state.sessions[id];
		}
		if (type === "rename") {
			const session = this.state.sessions[id]; if (!session) throw new Error(`Unknown session ${id}`);
			const name = String(payload.name ?? "").trim().slice(0, 80); if (!name) throw new Error("Session name is required");
			session.name = name; if (id === "host") this.savePrefs({ name }); else this.store.safe("upsert", () => this.store.upsert(session)); this.broadcast("session/state", "updated", this.sessionPatch(session)); return session;
		}
		if (type === "delete") {
			const session = this.state.sessions[id]; if (!session) throw new Error(`Unknown session ${id}`);
			const child = this.children.get(id); if (child) { this.children.delete(id); this.terminateChild(child); }
			this.store.safe("remove", () => this.store.remove(id));
			// The host transcript belongs to the live parent pi process. Removing
			// its card must not unlink the file that process is still writing.
			if (!session.host && session.sessionFile) { try { fs.rmSync(session.sessionFile, { force: true }); } catch { /* absent */ } }
			delete this.state.sessions[id];
			this.broadcast("session/state", "removed", { sessionId: id });
			return { ok: true, id };
		}
		if (type === "setModel") {
			const session = this.state.sessions[id]; if (!session) throw new Error(`Unknown session ${id}`);
			session.model = String(payload.model ?? ""); if (id === "host") this.savePrefs({ model: session.model }); this.broadcast("session/state", "updated", this.sessionPatch(session)); return session;
		}
		if (type === "setThinking") {
			const session = this.state.sessions[id]; if (!session) throw new Error(`Unknown session ${id}`);
			session.thinking = String(payload.thinking ?? "medium"); if (id === "host") this.savePrefs({ thinking: session.thinking }); this.broadcast("session/state", "updated", this.sessionPatch(session)); return session;
		}
		if (id === "host") {
			const host = this.state.sessions.host;
			if (!host) throw new Error("Host session has been deleted — create a new session to continue");
			if (type === "abort") return (this.ctx as any).abort?.();
			const content = String(payload.content ?? payload.prompt ?? ""); if (!content) throw new Error("Session content is required");
			const event = { type: "input", content, mode: type, ts: new Date().toISOString() }; host.transcript.push(event); this.broadcast("session/event", "input", { sessionId: "host", state: host.state, event });
			this.pi.sendMessage({ customType: "pif-input", content, display: true }, { deliverAs: type === "steer" ? "steer" : "followUp", triggerTurn: true }); return;
		}
		let child = this.children.get(id);
		if (!child && (type === "input" || type === "steer") && this.state.sessions[id]?.state === "ended") {
			this.resumeSession({ sessionId: id });
			child = this.children.get(id);
		}
		if (!child) throw new Error(this.state.sessions[id] ? "Session has ended — resume it from the session panel first" : `Unknown child session ${id}`);
		const command = type === "input" ? (this.state.sessions[id].state === "running" ? "follow_up" : "prompt") : type;
		const content = String(payload.content ?? payload.prompt ?? "");
		if (type !== "abort") { const event = { type: "input", content, mode: command, ts: new Date().toISOString() }; this.state.sessions[id].transcript.push(event); this.broadcast("session/event", "input", { sessionId: id, state: this.state.sessions[id].state, event }); }
		child.stdin.write(JSON.stringify({ type: command, message: content }) + "\n");
	}
	private spawnSession(payload: any) {
		const id = `session_${crypto.randomUUID().slice(0, 8)}`; const sessionsDir = path.join(this.pifDir, "sessions"); fs.mkdirSync(sessionsDir, { recursive: true });
		const sessionFile = path.join(sessionsDir, `${id}.jsonl`); fs.writeFileSync(sessionFile, "", { flag: "a", mode: 0o600 }); const cwd = path.resolve(payload.cwd || this.workspace);
		const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "pif.ts");
		const pi = resolvePiInvocation(extensionPath);
		const prefs = this.loadPrefs();
		const model = String(payload.model || prefs.model || "");
		const thinking = String(payload.thinking || prefs.thinking || "medium");
		const args = [...pi.args, "--mode", "rpc", "--no-extensions", "--no-skills", "--no-prompt-templates", "-e", extensionPath, "--session", sessionFile]; if (model) args.push("--model", model); if (thinking && thinking !== "none") args.push("--thinking", thinking);
		const child = spawn(pi.command, args, { cwd, env: childEnvironment(process.env), stdio: ["pipe", "pipe", "pipe"] });
		const session: PifSession = { id, name: payload.name || "Agent", host: false, state: "idle", model: model || "default", thinking, cwd, transcript: [], sessionFile }; this.state.sessions[id] = session; this.children.set(id, child); this.store.safe("upsert", () => this.store.upsert(session));
		this.wireChild(session, child);
		this.broadcast("session/state", "created", this.sessionPatch(session)); if (payload.prompt) { session.state = "running"; child.stdin.write(JSON.stringify({ type: "prompt", message: String(payload.prompt) }) + "\n"); }
		return session;
	}
	/** (Re)attach event wiring for a live child process. */
	private wireChild(session: PifSession, child: ChildProcessWithoutNullStreams) {
		let output = ""; child.stdout.on("data", (chunk) => { output += chunk; let at; while ((at = output.indexOf("\n")) >= 0) { const line = output.slice(0, at).trim(); output = output.slice(at + 1); if (line) this.childEvent(session, line); } });
		child.stderr.on("data", (chunk) => this.childEvent(session, JSON.stringify({ type: "stderr", data: chunk.toString() })));
		child.on("error", (error) => {
			// Spawn failure (missing binary, bad args): 'exit' may never fire,
			// so without this the card shows idle forever and blocks re-resume.
			this.children.delete(session.id); session.state = "ended"; session.exit = { code: null, signal: null };
			this.store.safe("upsert", () => this.store.upsert(session));
			this.broadcast("session/state", "ended", { ...this.sessionPatch(session), error: String(error) });
		});
		child.on("exit", (code, signal) => {
			this.children.delete(session.id); session.state = "ended"; session.exit = { code, signal };
			// The session was deleted while the child was still dying
			// (SIGTERM is async) — upserting here would resurrect its row.
			if (this.state.sessions[session.id] !== session) return;
			this.store.safe("upsert", () => this.store.upsert(session));
			this.broadcast("session/state", "ended", this.sessionPatch(session));
		});
	}
	resumeSession(payload: any) {
		const id = String(payload.sessionId ?? ""); const session = this.state.sessions[id];
		if (!session) throw new Error(`Unknown session ${id}`);
		if (session.host) throw new Error("The host session is always live");
		if (this.children.has(id)) throw new Error("Session is already running");
		if (!session.sessionFile || !fs.existsSync(session.sessionFile)) throw new Error("Session transcript file is missing — cannot resume");
		const cwd = session.cwd && fs.existsSync(session.cwd) ? session.cwd : this.workspace;
		const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "pif.ts");
		const pi = resolvePiInvocation(extensionPath);
		const model = session.model !== "default" ? session.model : "";
		const args = [...pi.args, "--mode", "rpc", "--no-extensions", "--no-skills", "--no-prompt-templates", "-e", extensionPath, "--session", session.sessionFile, "--name", session.name];
		if (model) args.push("--model", model); if (session.thinking && session.thinking !== "none") args.push("--thinking", session.thinking);
		const child = spawn(pi.command, args, { cwd, env: childEnvironment(process.env), stdio: ["pipe", "pipe", "pipe"] });
		this.hydrateTranscript(session);
		session.state = "idle"; session.exit = undefined;
		this.children.set(id, child);
		this.wireChild(session, child);
		this.store.safe("upsert", () => this.store.upsert(session));
		this.broadcast("session/state", "updated", this.sessionPatch(session));
		return session;
	}
	private childEvent(session: PifSession, line: string) {
		let event: any; try { event = JSON.parse(line); } catch { event = { type: "output", data: line }; }
		const kind = String(event.type ?? event.event ?? "event"); if (/start|delta|tool/.test(kind)) session.state = "running"; if (/agent_end|turn_end|result/.test(kind)) session.state = "idle"; if (/input_required/.test(kind)) session.state = "awaiting-input";
		if (this.isUserBoundaryEcho(kind, event)) return;
		const entry = { ...this.normalizeEntry(kind, event), ts: this.eventTimestamp(event) }; session.transcript.push(entry); if (session.transcript.length > 2_000) session.transcript.shift(); this.broadcast("session/event", kind, { sessionId: session.id, state: session.state, event: entry });
	}
	private loadLayout() { try { this.state.layout = JSON.parse(fs.readFileSync(this.layoutPath, "utf8")); } catch { this.state.layout = { panels: {} }; } }
	private saveLayout() {
		// `action` (focus/open) is ephemeral — persisting it re-focuses the
		// same tab on every future launch. Strip it from the copy on disk.
		const panels = (this.state.layout as any).panels;
	 const persisted = panels && typeof panels === "object" ? { ...this.state.layout, panels: Object.fromEntries(Object.entries(panels).map(([id, record]) => [id, { ...(record as any), action: undefined }])) } : this.state.layout;
	 fs.mkdirSync(path.dirname(this.layoutPath), { recursive: true }); fs.writeFileSync(this.layoutPath, JSON.stringify(persisted, null, 2) + "\n");
	}
	private loadRegistryState() { try { const saved = JSON.parse(fs.readFileSync(this.registryStatePath, "utf8")); this.enabled = new Set(Array.isArray(saved.enabled) ? saved.enabled : []); } catch { this.enabled = new Set(); } }
	private saveRegistryState() { fs.mkdirSync(path.dirname(this.registryStatePath), { recursive: true }); fs.writeFileSync(this.registryStatePath, JSON.stringify({ enabled: [...this.enabled].sort() }, null, 2) + "\n"); }
	private async layoutAction(type: string, payload: any) {
		const presetsDir = path.join(this.pifDir, "presets");
		if (type === "save") { if (!payload.preset) throw new Error("preset is required to save a layout"); fs.mkdirSync(presetsDir, { recursive: true }); fs.writeFileSync(path.join(presetsDir, `${String(payload.preset).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`), JSON.stringify(this.state.layout, null, 2) + "\n"); }
		else if (type === "load") { if (!payload.preset) throw new Error("preset is required to load a layout"); this.state.layout = JSON.parse(fs.readFileSync(path.join(presetsDir, `${String(payload.preset).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`), "utf8")); }
		else if (type === "reset") this.state.layout = { panels: {} };
		else if (type === "pin") { if (!payload.widgetId) throw new Error("widgetId is required to pin"); const panels = (this.state.layout.panels ??= {}) as Record<string, any>; panels[payload.widgetId] = { ...(panels[payload.widgetId] ?? {}), widgetId: payload.widgetId, pinned: payload.pinned !== false }; }
		else if (type === "resize") { const sizes = ((this.state.layout as any).sizes ??= {}); for (const slot of ["left", "right", "bottom"]) { const value = payload?.sizes?.[slot]; if (typeof value === "number" && Number.isFinite(value)) sizes[slot] = Math.min(Math.max(value, 80), 2_000); } }
		else if (type === "layout_change") this.state.layout = payload;
		else { const panels = (this.state.layout.panels ??= {}) as Record<string, any>; panels[payload.widgetId] = { ...(panels[payload.widgetId] ?? {}), ...payload, open: type !== "close", action: type }; }
		this.saveLayout(); this.broadcast("shell/layout", "layout_state", this.state.layout); return this.state.layout;
	}
	/** Layered widget roots (settled app-builder spec, Task #154). Resolution
	 * order: base (`appDir/lib/widgets`, with the app's local archive catalog)
	 * → global catalog (`~/.pi/pif/catalog/`) → project overlay
	 * (`<workspace>/pif_app/widgets`). Every write stays inside one of these
	 * declared roots and is guarded by assertSafeWidgetPath. */
	private widgetRoots() {
		return {
			widgets: path.join(this.appDir, "lib", "widgets"),
			catalog: path.join(this.appDir, "catalog"),
			globalCatalog: this.globalCatalogPath,
			project: path.join(this.workspace, "pif_app", "widgets"),
			registry: path.join(this.appDir, "lib", "widget_registry.g.dart"),
		};
	}
	private scanDirectory(root: string, installed: boolean, source: PifWidgetSource) {
		const records: Record<string, WidgetRecord> = {}; if (!fs.existsSync(root)) return records;
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) { if (!entry.isDirectory()) continue; const manifestPath = path.join(root, entry.name, "widget.yaml"); if (!fs.existsSync(manifestPath)) continue; try { const manifest = parseWidgetManifest(fs.readFileSync(manifestPath, "utf8")); records[manifest.id] = { ...manifest, source, installed, enabled: installed && (this.enabled.has(manifest.id) || manifest.core) }; } catch { /* invalid catalog entries surface during install */ } }
		return records;
	}
	scanWidgets() {
		const roots = this.widgetRoots(); const oldEnabled = new Set(Object.values(this.state.widgets).filter((w) => w.enabled).map((w) => w.id)); this.enabled = new Set([...this.enabled, ...oldEnabled]);
		// Layered resolution: a later layer shadows an earlier id wholesale —
		// the project definition wins over a global-catalog entry, which wins
		// over the base app. Scan, widget.list, and the registry codegen all
		// consume this one resolved set.
		const base = this.scanDirectory(roots.widgets, true, "base");
		const project = this.scanDirectory(roots.project, true, "project");
		this.state.widgets = { ...base, ...project };
		const appCatalog = this.scanDirectory(roots.catalog, false, "base");
		const globalCatalog = this.scanDirectory(roots.globalCatalog, false, "catalog");
		this.state.catalog = { ...appCatalog, ...globalCatalog };
		this.installed = new Set(Object.keys(this.state.widgets));
		for (const id of Object.keys(this.state.widgets)) delete this.state.catalog[id];
		for (const record of Object.values(this.state.widgets)) if (record.core || this.enabled.has(record.id)) { record.enabled = true; this.enabled.add(record.id); }
		this.loadAppManifest();
	}
	private generateRegistry() {
		const roots = this.widgetRoots();
		const manifests = Object.values(this.state.widgets).filter((record) => record.enabled).map((record) => ({
			...record,
			...(record.source === "project" ? { importPath: dartFileUri(path.join(roots.project, record.id, `${record.id}.dart`)) } : {}),
		}));
		fs.writeFileSync(roots.registry, generateWidgetRegistry(manifests));
	}
	private readModelsConfig(): Record<string, any> { try { return JSON.parse(fs.readFileSync(this.modelsPath, "utf8")).providers ?? {}; } catch { return {}; } }
	private readModelsList(): string[] {
		const models = new Set<string>();
		try { for (const m of ((this.ctx as any).modelRegistry?.getAvailable?.() ?? [])) models.add(`${m.provider}/${m.id}`); } catch {}
		try { const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pi", "agent", "settings.json"), "utf8")); for (const m of (settings.enabledModels ?? [])) models.add(m); } catch {}
		try { const providers = this.readModelsConfig(); for (const [provider, config] of Object.entries(providers)) { for (const m of ((config as any).models ?? [])) models.add(`${provider}/${m.id}`); } } catch {}
		return [...models].sort();
	}
	private refreshModels() { this.state.models = this.readModelsList(); this.state.modelProviders = this.readModelsConfig(); this.broadcastSnapshot(); }
	private trackerAction(type: string, payload: any) {
		if (type === "refresh") return this.tracker.refresh();
		if (type === "move") { const result = this.tracker.move(payload); this.broadcast("tracker/move", "move_result", result); return result; }
		if (type === "create" || type === "update" || type === "delete") { const result = this.tracker[type](payload); this.broadcast("tracker/op", "op_result", { op: type, ...result }); return result; }
		throw new Error(`Unknown tracker action: ${type}`);
	}
	private async modelsAction(type: string, payload: any) {
		if (type === "save") {
			const providers = this.validateModelProviders(payload.providers);
			let existing: Record<string, unknown> = {};
			try { const parsed = JSON.parse(fs.readFileSync(this.modelsPath, "utf8")); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed; } catch { /* absent or unreadable */ }
			if (fs.existsSync(this.modelsPath)) this.backupModelsFile();
			fs.writeFileSync(this.modelsPath, JSON.stringify({ ...existing, providers }, null, 2) + "\n");
			this.refreshModels(); return { ok: true, models: this.state.models };
		}
		if (type === "refresh") { this.refreshModels(); return { models: this.state.models }; }
		throw new Error(`Unknown models action: ${type}`);
	}
	private validateModelProviders(providers: unknown): Record<string, any> {
		if (!providers || typeof providers !== "object" || Array.isArray(providers)) throw new Error("models/save requires a providers object");
		for (const [name, config] of Object.entries(providers)) {
			if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`Provider ${name} must be an object`);
			if (config.models !== undefined && !Array.isArray(config.models)) throw new Error(`Provider ${name} models must be an array`);
		}
		return providers as Record<string, any>;
	}
	private backupModelsFile() {
		const backup = `${this.modelsPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
		fs.copyFileSync(this.modelsPath, backup);
		const backups = fs.readdirSync(path.dirname(this.modelsPath)).filter((name) => name.startsWith(`${path.basename(this.modelsPath)}.bak-`)).sort();
		for (const stale of backups.slice(0, Math.max(0, backups.length - 4))) fs.rmSync(path.join(path.dirname(this.modelsPath), stale), { force: true });
	}
	createWidget(params: any) {
		const id = String(params.id ?? ""); if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error("id must be lowercase snake_case");
		const root = this.widgetRoots().widgets; const dir = assertSafeWidgetPath(root, path.join(root, id)); if (fs.existsSync(dir)) throw new Error(`Widget already exists: ${id}`); fs.mkdirSync(dir, { recursive: false });
		const name = String(params.name || id); const slot = String(params.slot || "center");
		fs.writeFileSync(path.join(dir, "widget.yaml"), `id: ${id}\nname: ${JSON.stringify(name)}\nversion: 0.1.0\ndescription: ${JSON.stringify(String(params.spec || "A pif widget"))}\nslot: ${slot}\ncore: false\ntags: [generated]\ndart_dependencies: []\n`);
		fs.writeFileSync(path.join(dir, `${id}.dart`), `import 'package:flutter/material.dart';\nimport '../../core/plugin.dart';\n\nclass ${widgetClassName(id)} implements PifWidgetPlugin {\n  @override\n  PifWidgetMeta get meta => const PifWidgetMeta(id: '${id}', name: ${JSON.stringify(name)}, slot: PifSlot.${slot});\n\n  @override\n  Widget build(BuildContext context, PifHost host) => const Center(child: Text(${JSON.stringify(String(params.spec || name))}));\n}\n`);
		return { id, directory: dir, manifest: path.join(dir, "widget.yaml"), source: path.join(dir, `${id}.dart`) };
	}
	private analyzeWidget(dir: string) { const result = spawnSync("dart", ["analyze", dir], { cwd: this.appDir, encoding: "utf8", timeout: 120_000 }); return { ok: result.status === 0, diagnostics: `${result.stdout || ""}${result.stderr || ""}`.trim() }; }
	private restoreFile(file: string, previous: Buffer | null) { if (previous) fs.writeFileSync(file, previous); else fs.rmSync(file, { force: true }); }
	async installWidget(params: any) {
		const id = String(params.id ?? "");
		if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error("Widget id must be lowercase snake_case");
		const roots = this.widgetRoots();
		// Layered install resolution mirrors scanWidgets so install can never
		// register a definition other than the one a scan would surface:
		// project overlay first (registered in place), then base app widgets,
		// then the app-local archive (copied into the base app), then the
		// global catalog (copied into the project overlay).
		let dir = "", source: PifWidgetSource, copied = false;
		const projectDir = assertSafeWidgetPath(roots.project, path.join(roots.project, id));
		const baseDir = assertSafeWidgetPath(roots.widgets, path.join(roots.widgets, id));
		if (fs.existsSync(projectDir)) { dir = projectDir; source = "project"; }
		else if (fs.existsSync(baseDir)) { dir = baseDir; source = "base"; }
		else {
			const appArchive = assertSafeWidgetPath(roots.catalog, path.join(roots.catalog, id));
			const globalEntry = assertSafeWidgetPath(roots.globalCatalog, path.join(roots.globalCatalog, id));
			if (fs.existsSync(appArchive)) { fs.cpSync(appArchive, baseDir, { recursive: true, errorOnExist: true }); dir = baseDir; source = "base"; copied = true; }
			else if (fs.existsSync(globalEntry)) { fs.mkdirSync(roots.project, { recursive: true }); fs.cpSync(globalEntry, projectDir, { recursive: true, errorOnExist: true }); dir = projectDir; source = "project"; copied = true; }
			else throw new Error(`Widget not found in widgets or catalog: ${id}`);
		}
		const manifest = parseWidgetManifest(fs.readFileSync(path.join(dir, "widget.yaml"), "utf8")); if (manifest.id !== id) throw new Error("Manifest id does not match folder");
		const pubspecPath = path.join(this.appDir, "pubspec.yaml"), lockPath = path.join(this.appDir, "pubspec.lock");
		const pubspecBefore = fs.existsSync(pubspecPath) ? fs.readFileSync(pubspecPath) : null, lockBefore = fs.existsSync(lockPath) ? fs.readFileSync(lockPath) : null;
		const rejectInstall = (phase: string, diagnostics: string) => {
			if (manifest.dart_dependencies.length) { this.restoreFile(pubspecPath, pubspecBefore); this.restoreFile(lockPath, lockBefore); spawnSync("flutter", ["pub", "get"], { cwd: this.appDir, encoding: "utf8", timeout: 120_000 }); }
			if (copied) fs.rmSync(dir, { recursive: true, force: true });
			const result = { ok: false, id, phase, diagnostics, source }; this.broadcast("widget/reload", "reload_result", result); return result;
		};
		if (manifest.dart_dependencies.length) {
			for (const dependency of manifest.dart_dependencies) if (!/^[a-zA-Z0-9_]+(?::[^\s]+)?$/.test(dependency)) throw new Error(`Invalid Dart dependency: ${dependency}`);
			const pubGet = spawnSync("flutter", ["pub", "add", ...manifest.dart_dependencies], { cwd: this.appDir, encoding: "utf8", timeout: 120_000 });
			if (pubGet.status !== 0) return rejectInstall("pub_get", `${pubGet.stdout}${pubGet.stderr}`);
		}
		const analysis = this.analyzeWidget(dir); if (!analysis.ok) return rejectInstall("analyze", analysis.diagnostics);
		const enabledBefore = new Set(this.enabled), registryBefore = fs.existsSync(roots.registry) ? fs.readFileSync(roots.registry) : null;
		this.enabled.add(id); this.scanWidgets(); this.state.widgets[id].enabled = true; this.generateRegistry();
		const projectAnalysis = this.analyzeWidget(roots.registry);
		if (!projectAnalysis.ok) { this.enabled = enabledBefore; this.restoreFile(roots.registry, registryBefore); this.scanWidgets(); return rejectInstall("registry_analyze", projectAnalysis.diagnostics); }
		this.saveRegistryState();
		let reload: any = "shell-not-running"; if (this.supervisor.process) { this.state.health.reload = "running"; try { reload = await this.supervisor.reload(Boolean(manifest.dart_dependencies.length)); } catch (first) { try { reload = await this.supervisor.reload(true); } catch (second) { reload = { error: String(second), first: String(first) }; } } this.state.health.reload = reload?.error ? "failed" : "idle"; }
		this.scanWidgets(); this.broadcast("widget/registry", "registry_state", { widgets: this.state.widgets }); this.broadcast("store/catalog", "catalog_state", { catalog: this.state.catalog }); const result = { ok: !reload?.error, id, phase: "reload", diagnostics: analysis.diagnostics, reload, source }; this.broadcast("widget/reload", "reload_result", result); return result;
	}
	async toggleWidget(params: any) { const id = String(params.id); const widget = this.state.widgets[id]; if (!widget) throw new Error(`Unknown installed widget: ${id}`); widget.enabled = params.enabled ?? !widget.enabled; widget.enabled ? this.enabled.add(id) : this.enabled.delete(id); this.saveRegistryState(); this.generateRegistry(); this.broadcast("widget/registry", "registry_state", { widgets: this.state.widgets }); if (this.supervisor.process) await this.supervisor.reload(); return widget; }
	async uninstallWidget(params: any) {
		const id = String(params.id); const widget = this.state.widgets[id]; if (!widget) throw new Error(`Unknown installed widget: ${id}`); if (widget.core) throw new Error(`Core widget ${id} cannot be uninstalled`);
		const roots = this.widgetRoots();
		if (widget.source === "project") {
			// Project widgets are versioned inside the project overlay: uninstall
			// deregisters only — the source never moves or disappears, and it
			// keeps shadowing the base id until the project deletes it. The
			// enabled flag is cleared on the record too, or the next scan would
			// re-harvest it back into the registry.
			widget.enabled = false; this.enabled.delete(id); this.saveRegistryState(); this.scanWidgets(); this.generateRegistry(); this.broadcastSnapshot();
			if (this.supervisor.process) await this.supervisor.reload();
			return { ok: true, id, source: "project", deregistered: true };
		}
		// Base widgets archive back into the app-local catalog (source is never destroyed).
		const source = assertSafeWidgetPath(roots.widgets, path.join(roots.widgets, id)); const target = assertSafeWidgetPath(roots.catalog, path.join(roots.catalog, id)); if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true }); fs.renameSync(source, target);
		this.enabled.delete(id); this.saveRegistryState(); this.scanWidgets(); this.generateRegistry(); this.broadcastSnapshot(); if (this.supervisor.process) await this.supervisor.reload(); return { ok: true, id, source: "base", archived: target };
	}
	// --- App model (#157): pif_app/app.yaml + pif_app_* tools ---

	private appManifestPath() { return path.join(this.state.health.workspace, "pif_app", "app.yaml"); }

	/// Template resolution (#157/#178): project pinned copy → global catalog →
	/// the templates shipped with the app source (repo fallback).
	private appTemplateSource(template: string) {
		const candidates = [
			path.join(this.state.health.workspace, "pif_app", "template"),
			path.join(this.globalCatalogPath, "templates", template),
			path.join(this.appDir, "templates", template),
		];
		return candidates.find((candidate) => fs.existsSync(path.join(candidate, "template.yaml")));
	}

	/// Mirror repo-shipped templates into the global catalog at hub start —
	/// same origin→store philosophy as widgets (#155).
	syncRepoTemplates() {
		const source = path.join(this.appDir, "templates");
		if (!fs.existsSync(source)) return;
		for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const from = path.join(source, entry.name);
			const to = path.join(this.globalCatalogPath, "templates", entry.name);
			fs.mkdirSync(path.dirname(to), { recursive: true });
			fs.rmSync(to, { recursive: true, force: true });
			fs.cpSync(from, to, { recursive: true });
		}
	}

	loadAppManifest() {
		const file = this.appManifestPath();
		if (!fs.existsSync(file)) { this.state.app = null; this.state.appError = null; return; }
		const parsed = parseAppManifest(fs.readFileSync(file, "utf8"));
		if (parsed.error) { this.state.appError = parsed.error; this.broadcastSnapshot(); return; }
		this.state.app = parsed.manifest ?? null;
		this.state.appError = null;
	}

	private writeAppManifest(manifest: PifAppManifest) {
		const file = this.appManifestPath();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, renderAppManifest(manifest));
		this.state.app = manifest;
		this.state.appError = null;
	}

	/// pif_app is a package per the layered-sources convention (#155): its
	/// pubspec (flutter + a path dep on the app) gives the analyzer a package
	/// config for project widgets. Scaffolded once; pub get runs here so the
	/// install gate sees resolved packages.
	private scaffoldAppPackage() {
		const root = path.join(this.state.health.workspace, "pif_app");
		const pubspec = path.join(root, "pubspec.yaml");
		if (!fs.existsSync(pubspec)) {
			const appRef = path.relative(root, this.appDir).split(path.sep).join("/");
			fs.writeFileSync(pubspec, `name: pif_app\npublish_to: none\nenvironment:\n  sdk: ^3.5.0\ndependencies:\n  flutter:\n    sdk: flutter\n  pif:\n    path: ${appRef}\n`);
		}
		const pubGet = spawnSync("flutter", ["pub", "get"], { cwd: root, encoding: "utf8", timeout: 180_000 });
		if (pubGet.status !== 0) throw new Error(`flutter pub get failed in pif_app: ${pubGet.stdout}${pubGet.stderr}`);
	}

	private assertNoApp() {
		if (fs.existsSync(this.appManifestPath())) throw new Error("This project already has pif_app/app.yaml — use the pif_app_* tools to change it");
	}

	/// Scaffold a widget inside the project overlay (pif_app/widgets): the
	/// only allowed write root for app scaffolding per the #157 contract.
	private async scaffoldWidget(id: string, name: string, slot: string) {
		const widgetsRoot = path.join(this.state.health.workspace, "pif_app", "widgets");
		const dir = assertSafeWidgetPath(widgetsRoot, path.join(widgetsRoot, id));
		fs.mkdirSync(dir, { recursive: true });
		const safeName = name.replace(/'/g, "\\'");
		fs.writeFileSync(path.join(dir, "widget.yaml"), `id: ${id}\nname: ${safeName}\nslot: ${slot}\nversion: 0.1.0\ncore: false\ndescription: ${slot === "page" ? "Page" : "Widget"} ${safeName} for the project app\n`);
		fs.writeFileSync(
			path.join(dir, `${id}.dart`),
			"import 'package:flutter/material.dart';\nimport 'package:pif/core/plugin.dart';\n\n" +
			`class ${widgetClassName(id)} implements PifWidgetPlugin {\n` +
			`  const ${widgetClassName(id)}();\n` +
			"  @override\n" +
			`  PifWidgetMeta get meta => const PifWidgetMeta(id: '${id}', name: '${safeName}', slot: PifSlot.${slot});\n` +
			"  @override\n" +
			"  Widget build(BuildContext context, PifHost host) => Scaffold(\n" +
			"    body: Center(\n" +
			"      child: Column(\n" +
			"        mainAxisAlignment: MainAxisAlignment.center,\n" +
			"        children: [\n" +
			`          Text('${safeName}', style: Theme.of(context).textTheme.headlineSmall),\n` +
			"          const SizedBox(height: 8),\n" +
			"          Text('Scaffolded by pif_app_init — ready for its content.', style: Theme.of(context).textTheme.bodySmall),\n" +
			"        ],\n" +
			"      ),\n" +
			"    ),\n" +
			"  );\n" +
			"}\n",
		);
	}

	private async installOrFail(id: string, what: string) {
		const install = await this.installWidget({ id });
		if (!install?.ok) {
			const detail = install?.reload?.error ?? JSON.stringify(install?.diagnostics ?? install ?? {});
			throw new Error(`${what} '${id}' failed the analyzer gate: ${detail}`);
		}
		return install;
	}

	async appInit(params: any) {
		this.assertNoApp();
		const name = (String(params.name ?? "My App").trim() || "My App").replace(/[\r\n]+/g, " ").slice(0, 120);
		const template = params.template ? String(params.template) : undefined;
		if (template && !/^[a-z0-9][a-z0-9-]*$/.test(template)) throw new Error(`Template id must be a kebab identifier — got '${template}'`);
		const manifest: PifAppManifest = { id: slugifyAppId(name), name, version: "0.1.0", home: "home", pages: ["home"], template, dependencies: [] };
		if (template) {
			const source = this.appTemplateSource(template);
			if (!source) throw new Error(`Template '${template}' not found (searched project pinned copy, ${this.globalCatalogPath}/templates, and the app's bundled templates)`);
			const to = path.join(this.state.health.workspace, "pif_app", "template");
			fs.mkdirSync(path.dirname(to), { recursive: true });
			fs.rmSync(to, { recursive: true, force: true });
			fs.cpSync(source, to, { recursive: true });
		}
		this.writeAppManifest(manifest);
		try {
			this.scaffoldAppPackage();
			await this.scaffoldWidget("home", "Home", "page");
			await this.installOrFail("home", "Home page");
		} catch (error) {
			// Roll back the attempt so a retry is possible: the manifest and
			// the scaffolded page go; the pinned template and design.md stay.
			fs.rmSync(path.join(this.state.health.workspace, "pif_app", "widgets", "home"), { recursive: true, force: true });
			fs.rmSync(this.appManifestPath(), { force: true });
			this.loadAppManifest();
			throw error;
		}
		this.loadAppManifest();
		return { ok: true, id: manifest.id, name: manifest.name, template: template ?? null, pages: manifest.pages, note: template ? "template layers pinned to pif_app/template/" : "minimal unstyled app" };
	}

	async appPageAdd(params: any) {
		if (!this.state.app) throw new Error("No app manifest — run pif_app_init first");
		const name = String(params.name ?? "").trim().replace(/[\r\n]+/g, " ").slice(0, 120);
		if (!name) throw new Error("Page name is required");
		const id = params.id ? String(params.id) : slugifyAppId(name).replace(/-/g, "_");
		const parsed = addAppPage(this.state.app, id);
		if (parsed.error) throw new Error(parsed.error);
		try {
			await this.scaffoldWidget(id, name, "page");
			await this.installOrFail(id, "Page");
		} catch (error) {
			fs.rmSync(path.join(this.state.health.workspace, "pif_app", "widgets", id), { recursive: true, force: true });
			this.scanWidgets();
			throw error;
		}
		this.writeAppManifest(parsed.manifest!);
		return { ok: true, page: id, pages: this.state.app!.pages };
	}

	async appWidgetAdd(params: any) {
		if (!this.state.app) throw new Error("No app manifest — run pif_app_init first");
		const name = String(params.name ?? "").trim().replace(/[\r\n]+/g, " ").slice(0, 120);
		if (!name) throw new Error("Widget name is required");
		const id = params.id ? String(params.id) : slugifyAppId(name).replace(/-/g, "_");
		if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`Widget id must be a lowercase identifier (snake_case) — got '${id}'`);
		const slot = String(params.slot ?? "center");
		if (!["left", "center", "right", "bottom", "status"].includes(slot)) throw new Error(`Slot must be one of left|center|right|bottom|status — got '${slot}'`);
		if (this.state.widgets[id]) throw new Error(`Widget id '${id}' is already installed`);
		await this.scaffoldWidget(id, name, slot);
		await this.installOrFail(id, "Widget");
		return { ok: true, widget: id, slot };
	}

	appHomeSet(params: any) {
		if (!this.state.app) throw new Error("No app manifest — run pif_app_init first");
		const parsed = setAppHome(this.state.app, String(params.id ?? ""));
		if (parsed.error) throw new Error(parsed.error);
		this.writeAppManifest(parsed.manifest!);
		return { ok: true, home: this.state.app!.home, pages: this.state.app!.pages };
	}

	appList() {
		if (!this.state.app) return { ok: false, error: this.state.appError ?? "No app manifest — run pif_app_init first" };
		const manifest = this.state.app;
		return {
			ok: true,
			manifest,
			widgets: manifest.pages.map((page) => ({ page, installed: !!this.state.widgets[page], enabled: !!this.state.widgets[page]?.enabled })),
		};
	}

	appBuild(params: any) {
		if (!this.state.app) throw new Error("No app manifest — run pif_app_init first");
		const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "build-pif-project-app.sh");
		if (!fs.existsSync(script)) throw new Error(`Export script not found at ${script} — exporting requires the pif dev checkout`);
		const name = (String(params?.name ?? this.state.app.name).trim() || this.state.app.name).replace(/[\r\n/]+/g, " ").slice(0, 80);
		const child = spawn(script, [this.state.health.workspace, name], {
			cwd: this.state.health.workspace,
			env: { ...process.env, PIF_APP_NAME: name },
			encoding: "utf8",
			timeout: 30 * 60_000,
		});
		let output = "";
		child.stdout?.on("data", (chunk) => { output += String(chunk); });
		child.stderr?.on("data", (chunk) => { output += String(chunk); });
		void new Promise<void>((resolve) => {
			child.on("exit", (code) => {
				const result = { ok: code === 0, name, code: code ?? -1, output: output.slice(-4000) };
				this.broadcast("app/build", "build_result", result);
				resolve();
			});
		});
		return { ok: true, started: true, name, note: "Export runs asynchronously; the result arrives on the app/build channel." };
	}

	private async widgetAction(type: string, payload: any) { if (type === "toggle") return this.toggleWidget(payload); if (type === "uninstall") return this.uninstallWidget(payload); if (type === "action") return this.broadcast("widget/event", "widget_event", payload); }
	private async storeAction(type: string, payload: any) { if (type === "install") return this.installWidget(payload); if (type === "refresh") { this.scanWidgets(); this.broadcastSnapshot(); } }
	relaunchShell() { this.supervisor.relaunch({ ...process.env, PIF_PORT: String(this.port), PIF_WORKSPACE: this.workspace, PIF_TOKEN: this.token }); }
	async reload(restart = false) { this.state.health.reload = "running"; this.broadcast("shell/health", "health", this.state.health); try { const result = await this.supervisor.reload(restart); this.state.health.reload = "idle"; return result; } catch (error) { this.state.health.reload = "failed"; throw error; } finally { this.broadcast("shell/health", "health", this.state.health); } }
	/** Stop the hub and exit the pi process — used by app clients adopting a
	 * standalone hub and by the shell.shutdown control method. */
	shutdown() { this.stop().catch(() => { /* partial startup */ }); setTimeout(() => process.exit(0), 250).unref(); return Promise.resolve({ ok: true, stopping: true }); }
	async control(method: string, params: any): Promise<any> {
		switch (method) {
			case "pif_app.init": return this.appInit(params); case "pif_app.page_add": return this.appPageAdd(params); case "pif_app.widget_add": return this.appWidgetAdd(params); case "pif_app.home_set": return this.appHomeSet(params); case "pif_app.list": return this.appList(); case "pif_app.build": return this.appBuild(params); case "widget.create": return this.createWidget(params); case "widget.install": return this.installWidget(params); case "widget.toggle": return this.toggleWidget(params); case "widget.uninstall": return this.uninstallWidget(params);
			case "widget.list": this.scanWidgets(); return { installed: this.state.widgets, catalog: this.state.catalog }; case "layout": return this.layoutAction(params.action || "open", params); case "shell.status": return this.snapshot(); case "shell.reload": return this.reload(Boolean(params.restart)); case "session.spawn": return this.spawnSession(params); case "models.save": return this.modelsAction("save", params); case "models.refresh": return this.modelsAction("refresh", params);
			case "tracker.refresh": return this.tracker.refresh(); case "tracker.move": return this.trackerAction("move", params); case "tracker.list": return this.tracker.list(); case "tracker.create": return this.trackerAction("create", params); case "tracker.update": return this.trackerAction("update", params); case "tracker.delete": return this.trackerAction("delete", params);
			case "shell.shutdown": return this.shutdown();
			default: throw new Error(`Unknown pif control method: ${method}`);
		}
	}
}

let hub: PifHub | null = null;

async function callControl(workspace: string, method: string, params: unknown) {
	if (hub) return hub.control(method, params);
	const socketPath = path.join(workspace, ".pi", "pif", "control.sock");
	let secret = "";
	try { secret = fs.readFileSync(path.join(workspace, ".pi", "pif", "control.secret"), "utf8").trim(); } catch { /* absent — handshake will fail */ }
	return new Promise<any>((resolve, reject) => { const socket = net.createConnection(socketPath); let raw = ""; socket.on("connect", () => socket.write(JSON.stringify({ secret }) + "\n" + JSON.stringify({ method, params }) + "\n")); socket.on("data", (chunk) => raw += chunk); socket.on("end", () => { try { const result = JSON.parse(raw); result.ok ? resolve(result.result) : reject(new Error(result.error)); } catch (error) { reject(error); } }); socket.on("error", reject); });
}

export default function pifExtension(pi: ExtensionAPI) {
	let currentCtx: ExtensionContext | null = null; let workspace = process.cwd();
	const ensure = async (ctx: ExtensionContext, launch = true) => { currentCtx = ctx; workspace = (ctx as any).cwd || process.cwd(); if (!hub) { const created = new PifHub(pi, ctx, workspace, Number(process.env.PIF_PORT) || PIF_DEFAULT_PORT); try { await created.start(launch); } catch (error) { await created.stop().catch(() => { /* partial startup */ }); throw error; } hub = created; } else if (launch) hub.relaunchShell(); return hub; };
	pi.registerCommand("pif", { description: "Launch or focus the pif Flutter shell", handler: async (_args, ctx) => { try { await ensure(ctx, true); ctx.ui.notify(`pif running on ws://127.0.0.1:${hub!.port}/pif`, "info"); } catch (error) { ctx.ui.notify(`pif failed: ${String(error)}`, "error"); } } });
	pi.registerCommand("pif-stop", { description: "Stop pif and all child sessions", handler: async (_args, ctx) => { if (hub) await hub.stop(); hub = null; ctx.ui.notify("pif stopped", "info"); } });
	pi.registerCommand("pif-status", { description: "Show pif hub status", handler: async (_args, ctx) => { ctx.ui.notify(hub ? JSON.stringify(hub.snapshot().health) : "pif is stopped", "info"); } });
	const register = (name: string, label: string, description: string, parameters: any, method: string) => pi.registerTool({ name, label, description, parameters, async execute(_id, params) { const result = await callControl(workspace, method, params); return text(result); } });
	register("pif_widget_create", "pif widget create", "Scaffold a real Dart pif widget in lib/widgets.", Type.Object({ id: Type.String(), name: Type.String(), slot: Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right"), Type.Literal("bottom"), Type.Literal("status")]), spec: Type.Optional(Type.String()) }), "widget.create");
	register("pif_widget_install", "pif widget install", "Analyze, register, and reload a widget resolved across the layered sources (project overlay in place, base app, app archive, or global catalog copied into the project overlay). Returns compiler diagnostics.", Type.Object({ id: Type.String() }), "widget.install");
	register("pif_widget_toggle", "pif widget toggle", "Enable or disable an installed widget.", Type.Object({ id: Type.String(), enabled: Type.Optional(Type.Boolean()) }), "widget.toggle");
	register("pif_widget_uninstall", "pif widget uninstall", "Deregister a non-core widget: base widgets archive back into the app-local catalog, project overlay widgets deregister in place.", Type.Object({ id: Type.String() }), "widget.uninstall");
	register("pif_widget_list", "pif widget list", "List installed and catalog widgets with per-layer provenance (base, catalog, project).", Type.Object({}), "widget.list");
	register("pif_tracker_list", "pif tracker list", "List the workspace repo's board cards (epics, sprints, tasks, issues) with their columns, without bodies.", Type.Object({}), "tracker.list");
	register("pif_app_init", "pif app init", "Scaffold this project's app: pif_app/app.yaml + a Home page, installed through the analyzer gate. Optional template (e.g. mercury) pins the template's layers into pif_app/template/.", Type.Object({ name: Type.Optional(Type.String()), template: Type.Optional(Type.String()) }), "pif_app.init");
	register("pif_app_page_add", "pif app page add", "Add a page to the project app: scaffolds a page widget in pif_app/widgets, installs it through the analyzer gate, and appends it to the manifest's page order.", Type.Object({ name: Type.String(), id: Type.Optional(Type.String()) }), "pif_app.page_add");
	register("pif_app_widget_add", "pif app widget add", "Add a widget-extension to the project app (dock or status slot).", Type.Object({ name: Type.String(), id: Type.Optional(Type.String()), slot: Type.Optional(Type.String()) }), "pif_app.widget_add");
	register("pif_app_home_set", "pif app home set", "Set the app's home page (must be a declared page).", Type.Object({ id: Type.String() }), "pif_app.home_set");
	register("pif_app_list", "pif app list", "List the project app manifest and its pages with install state.", Type.Object({}), "pif_app.list");
	register("pif_app_build", "pif app build", "Export the project app as a standalone macOS application (builds asynchronously; result on the app/build channel).", Type.Object({ name: Type.Optional(Type.String()) }), "pif_app.build");
	register("pif_tracker_create", "pif tracker create", "Create a ticket in the workspace repo. type epic|sprint|task|issue maps to labels; column applies the board's column label.", Type.Object({ title: Type.String(), body: Type.Optional(Type.String()), type: Type.Optional(Type.String()), column: Type.Optional(Type.String()) }), "tracker.create");
	register("pif_tracker_update", "pif tracker update", "Update a ticket's title, body, and/or tags by issue number. Tags sync as GitHub labels (status:* and type labels are preserved).", Type.Object({ number: Type.Number(), title: Type.Optional(Type.String()), body: Type.Optional(Type.String()), labels: Type.Optional(Type.Array(Type.String())) }), "tracker.update");
	register("pif_tracker_delete", "pif tracker delete", "Delete a ticket from the tracker by issue number. Irreversible on GitHub.", Type.Object({ number: Type.Number() }), "tracker.delete");
	register("pif_layout", "pif layout", "Open, focus, move, close, reset, pin, save, or load pif panels; reset restores the default docking design and pin controls slide-in overlay mode.", Type.Object({ action: Type.Union([Type.Literal("open"), Type.Literal("focus"), Type.Literal("move"), Type.Literal("close"), Type.Literal("reset"), Type.Literal("pin"), Type.Literal("save"), Type.Literal("load")]), widgetId: Type.Optional(Type.String()), slot: Type.Optional(Type.String()), preset: Type.Optional(Type.String()), pinned: Type.Optional(Type.Boolean()) }), "layout");
	register("pif_shell_status", "pif shell status", "Return pif hub, shell, sessions, widgets, and layout health.", Type.Object({}), "shell.status");
	register("pif_reload", "pif reload", "Hot reload or hot restart the pif Flutter shell.", Type.Object({ restart: Type.Optional(Type.Boolean()) }), "shell.reload");
	const events = ["agent_start", "agent_end", "message_start", "message_update", "message_end", "tool_execution_start", "tool_execution_update", "tool_execution_end"];
	for (const event of events) (pi.on as any)(event, async (payload: unknown, ctx: ExtensionContext) => { currentCtx = ctx; workspace = (ctx as any).cwd || workspace; hub?.hostEvent(event, payload); });
	(pi.on as any)("session_start", async (_event: unknown, ctx: ExtensionContext) => { currentCtx = ctx; workspace = (ctx as any).cwd || workspace; if (process.env.PIF_AUTOSTART === "1") await ensure(ctx, process.env.PIF_NO_FLUTTER !== "1"); });
	(pi.on as any)("session_shutdown", async () => { if (hub) await hub.stop(); hub = null; currentCtx = null; });
}

export const __test = { WsPeer, FlutterSupervisor, PifHub, resolvePiInvocation };
