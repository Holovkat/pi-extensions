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
	createEnvelope,
	decodeEnvelope,
	generateWidgetRegistry,
	parseWidgetManifest,
	type PifEnvelope,
	type PifWidgetManifest,
	widgetClassName,
} from "./pif-shared.ts";

type SessionState = "idle" | "running" | "awaiting-input" | "ended";
interface PifSession {
	id: string; name: string; host: boolean; state: SessionState; model: string;
	cwd: string; transcript: unknown[]; sessionFile?: string; exit?: { code: number | null; signal: string | null };
}
interface WidgetRecord extends PifWidgetManifest { enabled: boolean; installed: boolean; }
interface HubState {
	sessions: Record<string, PifSession>;
	widgets: Record<string, WidgetRecord>;
	catalog: Record<string, WidgetRecord>;
	layout: Record<string, unknown>;
	models: string[];
	health: { hub: "running" | "stopped"; flutter: string; reload: string; workspace: string; port: number };
}

const text = (value: unknown, details: unknown = value) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details });

class WsPeer {
	private buffer = Buffer.alloc(0);
	constructor(private socket: net.Socket, private onMessage: (raw: string) => void, private onClose: () => void) {
		socket.on("data", (chunk) => this.read(chunk)); socket.on("close", onClose); socket.on("error", onClose);
	}
	send(value: unknown) {
		const payload = Buffer.from(JSON.stringify(value));
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
	constructor(private appDir: string, private changed: (state: string, detail?: unknown) => void) {}
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
	readonly appDir: string; readonly pifDir: string; readonly controlPath: string; readonly layoutPath: string; readonly registryStatePath: string;
	readonly state: HubState;
	private httpServer: http.Server | null = null; private controlServer: net.Server | null = null;
	private peers = new Set<WsPeer>(); private children = new Map<string, ChildProcessWithoutNullStreams>();
	private enabled = new Set<string>(); private installed = new Set<string>();
	private supervisor: FlutterSupervisor;
	constructor(readonly pi: ExtensionAPI, readonly ctx: ExtensionContext, readonly workspace: string, readonly port: number) {
		const globalApp = path.join(os.homedir(), ".pi", "pif", "app");
		const localApp = path.join(workspace, "pif");
		this.appDir = process.env.PIF_APP_DIR || (fs.existsSync(path.join(localApp, "pubspec.yaml")) ? localApp : globalApp);
		this.pifDir = path.join(workspace, ".pi", "pif");
		this.controlPath = path.join(this.pifDir, "control.sock"); this.layoutPath = path.join(this.pifDir, "layout.json"); this.registryStatePath = path.join(this.pifDir, "registry.json");
		this.state = { sessions: {}, widgets: {}, catalog: {}, layout: {}, models: [], health: { hub: "stopped", flutter: "stopped", reload: "idle", workspace, port } };
		this.supervisor = new FlutterSupervisor(this.appDir, (status, detail) => { this.state.health.flutter = status; this.broadcast("shell/health", "state", { ...this.state.health, detail }); });
	}
	async start(launchFlutter = true) {
		if (this.httpServer) return;
		fs.mkdirSync(this.pifDir, { recursive: true }); this.loadLayout();
		try { this.state.models = (this.ctx as any).modelRegistry?.getAvailable?.().map((m: any) => `${m.provider}/${m.id}`) ?? []; } catch { this.state.models = []; }
		const hasRegistryState = fs.existsSync(this.registryStatePath); this.loadRegistryState(); this.scanWidgets();
		if (!hasRegistryState) { for (const widget of Object.values(this.state.widgets)) { widget.enabled = true; this.enabled.add(widget.id); } this.saveRegistryState(); }
		this.createHostSession(); await this.startWebSocket(); await this.startControl();
		this.state.health.hub = "running"; this.setStatus(); this.broadcastSnapshot();
		if (launchFlutter) this.supervisor.start({ ...process.env, PIF_PORT: String(this.port), PIF_WORKSPACE: this.workspace });
	}
	async stop() {
		for (const child of this.children.values()) { child.kill("SIGTERM"); setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 1_000).unref(); }
		this.children.clear(); await this.supervisor.stop(); for (const peer of this.peers) peer.close(); this.peers.clear();
		await Promise.all([new Promise<void>((r) => this.httpServer?.close(() => r()) ?? r()), new Promise<void>((r) => this.controlServer?.close(() => r()) ?? r())]);
		this.httpServer = null; this.controlServer = null; try { fs.unlinkSync(this.controlPath); } catch { /* absent */ }
		this.state.health.hub = "stopped"; this.setStatus();
	}
	private setStatus() { try { this.ctx.ui.setStatus("pif", this.state.health.hub === "running" ? `pif ● :${this.port}` : undefined); } catch { /* non-interactive */ } }
	private createHostSession() {
		this.state.sessions.host = { id: "host", name: "Host session", host: true, state: "idle", model: (this.ctx as any).model?.id ?? "host", cwd: this.workspace, transcript: [] };
	}
	private startWebSocket() {
		return new Promise<void>((resolve, reject) => {
			const server = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ name: "pif", status: this.state.health })); });
			server.on("upgrade", (req, socket) => {
				if (req.url !== "/pif" || !req.headers["sec-websocket-key"]) return socket.destroy();
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
				let input = ""; socket.on("data", (chunk) => { input += chunk; const at = input.indexOf("\n"); if (at < 0) return; const raw = input.slice(0, at); input = input.slice(at + 1); Promise.resolve().then(async () => { const req = JSON.parse(raw); return this.control(req.method, req.params ?? {}); }).then((result) => socket.end(JSON.stringify({ ok: true, result }) + "\n"), (error) => socket.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }) + "\n")); });
			});
			server.once("error", reject); server.listen(this.controlPath, () => { server.off("error", reject); this.controlServer = server; resolve(); });
		});
	}
	private snapshotEnvelope() { return createEnvelope("shell/state", "snapshot", this.snapshot()); }
	snapshot() { return JSON.parse(JSON.stringify(this.state)); }
	private broadcastSnapshot() { this.send(this.snapshotEnvelope()); }
	broadcast(channel: PifEnvelope["channel"], type: string, payload: unknown) { this.send(createEnvelope(channel, type, payload)); }
	private send(env: PifEnvelope) { for (const peer of this.peers) peer.send(env); }
	private async receive(raw: string, peer: WsPeer) {
		let env: PifEnvelope; try { env = decodeEnvelope(raw); } catch (error) { peer.send(createEnvelope("shell/error", "invalid_envelope", { error: String(error) })); return; }
		try {
			if (env.channel === "shell/state" && env.type === "snapshot_request") return peer.send(this.snapshotEnvelope());
			if (env.channel.startsWith("session/")) await this.sessionAction(env.type, env.payload as any);
			else if (env.channel.startsWith("widget/")) await this.widgetAction(env.type, env.payload as any);
			else if (env.channel.startsWith("store/")) await this.storeAction(env.type, env.payload as any);
			else if (env.channel.startsWith("shell/")) await this.layoutAction(env.type, env.payload as any);
		} catch (error) { peer.send(createEnvelope("shell/error", "action_failed", { requestId: env.id, error: String((error as Error).message) })); }
	}
	hostEvent(type: string, payload: unknown) {
		const host = this.state.sessions.host; if (!host) return;
		if (type === "agent_start") host.state = "running"; if (type === "agent_end") host.state = "idle";
		const entry = this.normalizeEntry(type, payload); host.transcript.push(entry); if (host.transcript.length > 2_000) host.transcript.shift();
		this.broadcast("session/host", type, { sessionId: "host", state: host.state, event: entry });
	}
	private normalizeEntry(type: string, payload: any): Record<string, unknown> {
		const p = payload ?? {};
		if (type === "input") return { type: "input", content: String(p.content ?? p.prompt ?? "") };
		if (type === "message_update" || type === "message_start" || type === "message" || type === "message_end") {
			const delta = p.assistantMessageEvent?.delta ?? p.delta;
			if (delta) return { type: "message_update", delta: String(delta) };
			const content = p.message?.content;
			if (Array.isArray(content)) { const text = content.filter((c: any) => c?.type === "text").map((c: any) => c?.text ?? "").join(""); if (text) return { type: "message", text }; }
			if (typeof content === "string" && content) return { type: "message", text: content };
			return { type: "message_update", delta: "" };
		}
		if (type.includes("tool")) return { type, toolName: String(p.toolName ?? p.name ?? "tool"), toolCallId: String(p.toolCallId ?? p.id ?? ""), args: p.args ? JSON.stringify(p.args).slice(0, 300) : undefined, result: p.result ? String(p.result).slice(0, 300) : undefined };
		if (type === "agent_start" || type === "agent_end") return { type, state: type === "agent_start" ? "running" : "idle" };
		if (type === "stderr" || type === "output") return { type, data: String(p.data ?? p).slice(0, 500) };
		return { type, data: JSON.stringify(p).slice(0, 500) };
	}
	private async sessionAction(type: string, payload: any) {
		if (type === "spawn") return this.spawnSession(payload);
		const id = payload.sessionId ?? "host";
		if (type === "select") {
			if (!this.state.sessions[id]) throw new Error(`Unknown session ${id}`);
			this.broadcast("session/selection", "selected", { sessionId: id });
			return this.state.sessions[id];
		}
		if (id === "host") {
			if (type === "abort") return (this.ctx as any).abort?.();
			const content = String(payload.content ?? payload.prompt ?? ""); if (!content) throw new Error("Session content is required");
			const event = { type: "input", content, mode: type, ts: new Date().toISOString() }; this.state.sessions.host.transcript.push(event); this.broadcast("session/event", "input", { sessionId: "host", state: this.state.sessions.host.state, event });
			this.pi.sendMessage({ customType: "pif-input", content, display: true }, { deliverAs: type === "steer" ? "steer" : "followUp", triggerTurn: true }); return;
		}
		const child = this.children.get(id); if (!child) throw new Error(`Unknown child session ${id}`);
		const command = type === "input" ? (this.state.sessions[id].state === "running" ? "follow_up" : "prompt") : type;
		const content = String(payload.content ?? payload.prompt ?? "");
		if (type !== "abort") { const event = { type: "input", content, mode: command, ts: new Date().toISOString() }; this.state.sessions[id].transcript.push(event); this.broadcast("session/event", "input", { sessionId: id, state: this.state.sessions[id].state, event }); }
		child.stdin.write(JSON.stringify({ type: command, message: content }) + "\n");
	}
	private spawnSession(payload: any) {
		const id = `session_${crypto.randomUUID().slice(0, 8)}`; const sessionsDir = path.join(this.pifDir, "sessions"); fs.mkdirSync(sessionsDir, { recursive: true });
		const sessionFile = path.join(sessionsDir, `${id}.jsonl`); const cwd = path.resolve(payload.cwd || this.workspace);
		const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "pif.ts");
		const args = ["--mode", "rpc", "--no-extensions", "--no-skills", "--no-prompt-templates", "-e", extensionPath, "--session", sessionFile]; if (payload.model) args.push("--model", String(payload.model));
		const child = spawn(process.env.PIF_PI_BIN || "pi", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
		const session: PifSession = { id, name: payload.name || "Agent", host: false, state: "idle", model: payload.model || "default", cwd, transcript: [], sessionFile }; this.state.sessions[id] = session; this.children.set(id, child);
		let output = ""; child.stdout.on("data", (chunk) => { output += chunk; let at; while ((at = output.indexOf("\n")) >= 0) { const line = output.slice(0, at).trim(); output = output.slice(at + 1); if (line) this.childEvent(session, line); } });
		child.stderr.on("data", (chunk) => this.childEvent(session, JSON.stringify({ type: "stderr", data: chunk.toString() })));
		child.on("exit", (code, signal) => { this.children.delete(id); session.state = "ended"; session.exit = { code, signal }; this.broadcast("session/state", "ended", session); });
		this.broadcast("session/state", "created", session); if (payload.prompt) { session.state = "running"; child.stdin.write(JSON.stringify({ type: "prompt", message: String(payload.prompt) }) + "\n"); }
		return session;
	}
	private childEvent(session: PifSession, line: string) {
		let event: any; try { event = JSON.parse(line); } catch { event = { type: "output", data: line }; }
		const kind = String(event.type ?? event.event ?? "event"); if (/start|delta|tool/.test(kind)) session.state = "running"; if (/agent_end|turn_end|result/.test(kind)) session.state = "idle"; if (/input_required/.test(kind)) session.state = "awaiting-input";
		const entry = this.normalizeEntry(kind, event); session.transcript.push(entry); if (session.transcript.length > 2_000) session.transcript.shift(); this.broadcast("session/event", kind, { sessionId: session.id, state: session.state, event: entry });
	}
	private loadLayout() { try { this.state.layout = JSON.parse(fs.readFileSync(this.layoutPath, "utf8")); } catch { this.state.layout = { panels: {} }; } }
	private saveLayout() { fs.mkdirSync(path.dirname(this.layoutPath), { recursive: true }); fs.writeFileSync(this.layoutPath, JSON.stringify(this.state.layout, null, 2) + "\n"); }
	private loadRegistryState() { try { const saved = JSON.parse(fs.readFileSync(this.registryStatePath, "utf8")); this.enabled = new Set(Array.isArray(saved.enabled) ? saved.enabled : []); } catch { this.enabled = new Set(); } }
	private saveRegistryState() { fs.mkdirSync(path.dirname(this.registryStatePath), { recursive: true }); fs.writeFileSync(this.registryStatePath, JSON.stringify({ enabled: [...this.enabled].sort() }, null, 2) + "\n"); }
	private async layoutAction(type: string, payload: any) {
		const presetsDir = path.join(this.pifDir, "presets");
		if (type === "save") { if (!payload.preset) throw new Error("preset is required to save a layout"); fs.mkdirSync(presetsDir, { recursive: true }); fs.writeFileSync(path.join(presetsDir, `${String(payload.preset).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`), JSON.stringify(this.state.layout, null, 2) + "\n"); }
		else if (type === "load") { if (!payload.preset) throw new Error("preset is required to load a layout"); this.state.layout = JSON.parse(fs.readFileSync(path.join(presetsDir, `${String(payload.preset).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`), "utf8")); }
		else if (type === "layout_change") this.state.layout = payload;
		else { const panels = (this.state.layout.panels ??= {}) as Record<string, any>; panels[payload.widgetId] = { ...(panels[payload.widgetId] ?? {}), ...payload, open: type !== "close", action: type }; }
		this.saveLayout(); this.broadcast("shell/layout", "layout_state", this.state.layout); return this.state.layout;
	}
	private widgetRoots() { return { widgets: path.join(this.appDir, "lib", "widgets"), catalog: path.join(this.appDir, "catalog"), registry: path.join(this.appDir, "lib", "widget_registry.g.dart") }; }
	private scanDirectory(root: string, installed: boolean) {
		const records: Record<string, WidgetRecord> = {}; if (!fs.existsSync(root)) return records;
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) { if (!entry.isDirectory()) continue; const manifestPath = path.join(root, entry.name, "widget.yaml"); if (!fs.existsSync(manifestPath)) continue; try { const manifest = parseWidgetManifest(fs.readFileSync(manifestPath, "utf8")); records[manifest.id] = { ...manifest, installed, enabled: installed && (this.enabled.has(manifest.id) || manifest.core) }; } catch { /* invalid catalog entries surface during install */ } }
		return records;
	}
	scanWidgets() {
		const roots = this.widgetRoots(); const oldEnabled = new Set(Object.values(this.state.widgets).filter((w) => w.enabled).map((w) => w.id)); this.enabled = new Set([...this.enabled, ...oldEnabled]);
		this.state.widgets = this.scanDirectory(roots.widgets, true); this.state.catalog = this.scanDirectory(roots.catalog, false); this.installed = new Set(Object.keys(this.state.widgets));
		for (const id of Object.keys(this.state.widgets)) delete this.state.catalog[id];
		for (const record of Object.values(this.state.widgets)) if (record.core || this.enabled.has(record.id)) { record.enabled = true; this.enabled.add(record.id); }
	}
	private generateRegistry() { const manifests = Object.values(this.state.widgets).filter((record) => record.enabled); fs.writeFileSync(this.widgetRoots().registry, generateWidgetRegistry(manifests)); }
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
		const id = String(params.id ?? ""); const roots = this.widgetRoots(); let dir = path.join(roots.widgets, id); let copied = false;
		if (!fs.existsSync(dir)) { const source = assertSafeWidgetPath(roots.catalog, path.join(roots.catalog, id)); if (!fs.existsSync(source)) throw new Error(`Widget not found in widgets or catalog: ${id}`); fs.cpSync(source, dir, { recursive: true, errorOnExist: true }); copied = true; }
		const manifest = parseWidgetManifest(fs.readFileSync(path.join(dir, "widget.yaml"), "utf8")); if (manifest.id !== id) throw new Error("Manifest id does not match folder");
		const pubspecPath = path.join(this.appDir, "pubspec.yaml"), lockPath = path.join(this.appDir, "pubspec.lock");
		const pubspecBefore = fs.existsSync(pubspecPath) ? fs.readFileSync(pubspecPath) : null, lockBefore = fs.existsSync(lockPath) ? fs.readFileSync(lockPath) : null;
		const rejectInstall = (phase: string, diagnostics: string) => {
			if (manifest.dart_dependencies.length) { this.restoreFile(pubspecPath, pubspecBefore); this.restoreFile(lockPath, lockBefore); spawnSync("flutter", ["pub", "get"], { cwd: this.appDir, encoding: "utf8", timeout: 120_000 }); }
			if (copied) fs.rmSync(dir, { recursive: true, force: true });
			const result = { ok: false, id, phase, diagnostics }; this.broadcast("widget/reload", "reload_result", result); return result;
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
		this.scanWidgets(); this.broadcast("widget/registry", "registry_state", { widgets: this.state.widgets }); this.broadcast("store/catalog", "catalog_state", { catalog: this.state.catalog }); const result = { ok: !reload?.error, id, phase: "reload", diagnostics: analysis.diagnostics, reload }; this.broadcast("widget/reload", "reload_result", result); return result;
	}
	async toggleWidget(params: any) { const id = String(params.id); const widget = this.state.widgets[id]; if (!widget) throw new Error(`Unknown installed widget: ${id}`); widget.enabled = params.enabled ?? !widget.enabled; widget.enabled ? this.enabled.add(id) : this.enabled.delete(id); this.saveRegistryState(); this.generateRegistry(); this.broadcast("widget/registry", "registry_state", { widgets: this.state.widgets }); if (this.supervisor.process) await this.supervisor.reload(); return widget; }
	async uninstallWidget(params: any) { const id = String(params.id); const widget = this.state.widgets[id]; if (!widget) throw new Error(`Unknown installed widget: ${id}`); if (widget.core) throw new Error(`Core widget ${id} cannot be uninstalled`); const roots = this.widgetRoots(); const source = assertSafeWidgetPath(roots.widgets, path.join(roots.widgets, id)); const target = assertSafeWidgetPath(roots.catalog, path.join(roots.catalog, id)); if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true }); fs.renameSync(source, target); this.enabled.delete(id); this.saveRegistryState(); this.scanWidgets(); this.generateRegistry(); this.broadcastSnapshot(); if (this.supervisor.process) await this.supervisor.reload(); return { ok: true, id, archived: target }; }
	private async widgetAction(type: string, payload: any) { if (type === "toggle") return this.toggleWidget(payload); if (type === "uninstall") return this.uninstallWidget(payload); if (type === "action") return this.broadcast("widget/event", "widget_event", payload); }
	private async storeAction(type: string, payload: any) { if (type === "install") return this.installWidget(payload); if (type === "refresh") { this.scanWidgets(); this.broadcastSnapshot(); } }
	relaunchShell() { this.supervisor.relaunch({ ...process.env, PIF_PORT: String(this.port), PIF_WORKSPACE: this.workspace }); }
	async reload(restart = false) { this.state.health.reload = "running"; this.broadcast("shell/health", "health", this.state.health); try { const result = await this.supervisor.reload(restart); this.state.health.reload = "idle"; return result; } catch (error) { this.state.health.reload = "failed"; throw error; } finally { this.broadcast("shell/health", "health", this.state.health); } }
	async control(method: string, params: any): Promise<any> {
		switch (method) {
			case "widget.create": return this.createWidget(params); case "widget.install": return this.installWidget(params); case "widget.toggle": return this.toggleWidget(params); case "widget.uninstall": return this.uninstallWidget(params);
			case "widget.list": this.scanWidgets(); return { installed: this.state.widgets, catalog: this.state.catalog }; case "layout": return this.layoutAction(params.action || "open", params); case "shell.status": return this.snapshot(); case "shell.reload": return this.reload(Boolean(params.restart)); case "session.spawn": return this.spawnSession(params);
			default: throw new Error(`Unknown pif control method: ${method}`);
		}
	}
}

let hub: PifHub | null = null;

async function callControl(workspace: string, method: string, params: unknown) {
	if (hub) return hub.control(method, params);
	const socketPath = path.join(workspace, ".pi", "pif", "control.sock");
	return new Promise<any>((resolve, reject) => { const socket = net.createConnection(socketPath); let raw = ""; socket.on("connect", () => socket.write(JSON.stringify({ method, params }) + "\n")); socket.on("data", (chunk) => raw += chunk); socket.on("end", () => { try { const result = JSON.parse(raw); result.ok ? resolve(result.result) : reject(new Error(result.error)); } catch (error) { reject(error); } }); socket.on("error", reject); });
}

export default function pifExtension(pi: ExtensionAPI) {
	let currentCtx: ExtensionContext | null = null; let workspace = process.cwd();
	const ensure = async (ctx: ExtensionContext, launch = true) => { currentCtx = ctx; workspace = (ctx as any).cwd || process.cwd(); if (!hub) { hub = new PifHub(pi, ctx, workspace, Number(process.env.PIF_PORT) || PIF_DEFAULT_PORT); await hub.start(launch); } else if (launch) hub.relaunchShell(); return hub; };
	pi.registerCommand("pif", { description: "Launch or focus the pif Flutter shell", handler: async (_args, ctx) => { try { await ensure(ctx, true); ctx.ui.notify(`pif running on ws://127.0.0.1:${hub!.port}/pif`, "info"); } catch (error) { ctx.ui.notify(`pif failed: ${String(error)}`, "error"); } } });
	pi.registerCommand("pif-stop", { description: "Stop pif and all child sessions", handler: async (_args, ctx) => { if (hub) await hub.stop(); hub = null; ctx.ui.notify("pif stopped", "info"); } });
	pi.registerCommand("pif-status", { description: "Show pif hub status", handler: async (_args, ctx) => { ctx.ui.notify(hub ? JSON.stringify(hub.snapshot().health) : "pif is stopped", "info"); } });
	const register = (name: string, label: string, description: string, parameters: any, method: string) => pi.registerTool({ name, label, description, parameters, async execute(_id, params) { const result = await callControl(workspace, method, params); return text(result); } });
	register("pif_widget_create", "pif widget create", "Scaffold a real Dart pif widget in lib/widgets.", Type.Object({ id: Type.String(), name: Type.String(), slot: Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right"), Type.Literal("bottom"), Type.Literal("status")]), spec: Type.Optional(Type.String()) }), "widget.create");
	register("pif_widget_install", "pif widget install", "Analyze, register, and reload an in-place or catalog widget. Returns compiler diagnostics.", Type.Object({ id: Type.String() }), "widget.install");
	register("pif_widget_toggle", "pif widget toggle", "Enable or disable an installed widget.", Type.Object({ id: Type.String(), enabled: Type.Optional(Type.Boolean()) }), "widget.toggle");
	register("pif_widget_uninstall", "pif widget uninstall", "Archive a non-core widget back into the local catalog.", Type.Object({ id: Type.String() }), "widget.uninstall");
	register("pif_widget_list", "pif widget list", "List installed and local catalog widgets.", Type.Object({}), "widget.list");
	register("pif_layout", "pif layout", "Open, focus, move, close, save, or load pif panels.", Type.Object({ action: Type.Union([Type.Literal("open"), Type.Literal("focus"), Type.Literal("move"), Type.Literal("close"), Type.Literal("save"), Type.Literal("load")]), widgetId: Type.Optional(Type.String()), slot: Type.Optional(Type.String()), preset: Type.Optional(Type.String()) }), "layout");
	register("pif_shell_status", "pif shell status", "Return pif hub, shell, sessions, widgets, and layout health.", Type.Object({}), "shell.status");
	register("pif_reload", "pif reload", "Hot reload or hot restart the pif Flutter shell.", Type.Object({ restart: Type.Optional(Type.Boolean()) }), "shell.reload");
	const events = ["agent_start", "agent_end", "message_start", "message_update", "message_end", "tool_execution_start", "tool_execution_update", "tool_execution_end"];
	for (const event of events) (pi.on as any)(event, async (payload: unknown, ctx: ExtensionContext) => { currentCtx = ctx; workspace = (ctx as any).cwd || workspace; hub?.hostEvent(event, payload); });
	(pi.on as any)("session_start", async (_event: unknown, ctx: ExtensionContext) => { currentCtx = ctx; workspace = (ctx as any).cwd || workspace; if (process.env.PIF_AUTOSTART === "1") await ensure(ctx, process.env.PIF_NO_FLUTTER !== "1"); });
	(pi.on as any)("session_shutdown", async () => { if (hub) await hub.stop(); hub = null; currentCtx = null; });
}

export const __test = { WsPeer, FlutterSupervisor, PifHub };
