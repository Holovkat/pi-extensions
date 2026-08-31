import * as crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { runEnvironmentGithub } from "./pif-github.ts";

export const PIF_PROTOCOL_VERSION = 1 as const;
export const PIF_DEFAULT_PORT = 31415;
export const PIF_CHANNELS = ["session", "widget", "store", "models", "tracker", "shell", "app"] as const;
export type PifChannel = (typeof PIF_CHANNELS)[number];

export interface PifEnvelope<T = unknown> {
	v: 1;
	id: string;
	ts: string;
	channel: `${PifChannel}/${string}`;
	type: string;
	payload: T;
}

export interface PifWidgetManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	slot: "left" | "center" | "right" | "bottom" | "status";
	core: boolean;
	tags: string[];
	dart_dependencies: string[];
}

/** Provenance of a widget under the layered source model (settled app-builder
 * spec, Task #154): `base` = the running app's own widgets and its local
 * archive catalog, `catalog` = the shared global catalog (`~/.pi/pif/catalog/`),
 * `project` = the workspace overlay (`pif_app/widgets/`). A later layer
 * shadows an earlier id wholesale: project > catalog > base. */
export type PifWidgetSource = "base" | "catalog" | "project";

const PIF_WIDGET_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export function isWidgetId(value: string): boolean {
	return PIF_WIDGET_ID_PATTERN.test(value);
}

export interface PifWidgetLookupRoots {
	base?: string | readonly string[];
	catalog?: string | readonly string[];
	project?: string | readonly string[];
}

export interface PifResolvedWidgetEntry extends PifRegistryEntry {
	root: string;
	directory: string;
	manifestPath: string;
}

export interface PifWidgetResolutionProblem {
	id: string;
	reason: "invalid" | "duplicate" | "missing" | "unavailable";
	message: string;
	index?: number;
	previousIndex?: number;
	source?: PifWidgetSource;
	root?: string;
}

export interface PifWidgetResolutionResult {
	ok: boolean;
	requested: string[];
	resolved: PifResolvedWidgetEntry[];
	problems: PifWidgetResolutionProblem[];
}

function asRootList(value: string | readonly string[] | undefined): string[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? [...value] : [value];
}

function problemMessage(id: string, reason: PifWidgetResolutionProblem["reason"], detail: string, index?: number, previousIndex?: number, source?: PifWidgetSource, root?: string): PifWidgetResolutionProblem {
	return { id, reason, message: detail, index, previousIndex, source, root };
}

function readResolvedWidgetEntry(root: string, source: PifWidgetSource, id: string): PifResolvedWidgetEntry | PifWidgetResolutionProblem | null {
	const resolvedRoot = path.resolve(root);
	const directory = assertSafeWidgetPath(resolvedRoot, path.join(resolvedRoot, id));
	if (!fs.existsSync(directory)) return null;
	let stat: fs.Stats;
	try {
		stat = fs.statSync(directory);
	} catch (error) {
		return problemMessage(id, "invalid", `required widget '${id}' in ${source} source could not be inspected at ${directory}: ${String((error as Error).message)}`, undefined, undefined, source, resolvedRoot);
	}
	if (!stat.isDirectory()) {
		return problemMessage(id, "invalid", `required widget '${id}' in ${source} source must be a directory at ${directory}`, undefined, undefined, source, resolvedRoot);
	}
	const manifestPath = path.join(directory, "widget.yaml");
	let raw = "";
	try {
		raw = fs.readFileSync(manifestPath, "utf8");
	} catch (error) {
		return problemMessage(id, "invalid", `required widget '${id}' in ${source} source is missing widget.yaml at ${manifestPath}: ${String((error as Error).message)}`, undefined, undefined, source, resolvedRoot);
	}
	try {
		const manifest = parseWidgetManifest(raw);
		if (manifest.id !== id) {
			return problemMessage(id, "invalid", `required widget '${id}' in ${source} source has manifest id '${manifest.id}' at ${manifestPath}`, undefined, undefined, source, resolvedRoot);
		}
		const dartPath = path.join(directory, `${id}.dart`);
		let dartStat: fs.Stats;
		try {
			dartStat = fs.statSync(dartPath);
		} catch (error) {
			return problemMessage(id, "unavailable", `required widget '${id}' in ${source} source is missing Dart source at ${dartPath}: ${String((error as Error).message)}`, undefined, undefined, source, resolvedRoot);
		}
		if (!dartStat.isFile()) {
			return problemMessage(id, "unavailable", `required widget '${id}' in ${source} source must provide a Dart source file at ${dartPath}`, undefined, undefined, source, resolvedRoot);
		}
		return {
			...manifest,
			source,
			root: resolvedRoot,
			directory,
			manifestPath,
			...(source === "project" ? { importPath: dartFileUri(dartPath) } : {}),
		};
	} catch (error) {
		return problemMessage(id, "invalid", `required widget '${id}' in ${source} source has an invalid widget.yaml at ${manifestPath}: ${String((error as Error).message)}`, undefined, undefined, source, resolvedRoot);
	}
}

function resolveWidgetFromRoots(id: string, roots: PifWidgetLookupRoots): PifResolvedWidgetEntry | PifWidgetResolutionProblem {
	for (const source of ["project", "catalog", "base"] as const) {
		for (const root of asRootList(roots[source])) {
			const result = readResolvedWidgetEntry(root, source, id);
			if (result === null) continue;
			return result;
		}
	}
	return problemMessage(id, "unavailable", `required widget '${id}' was not found in project overlay, global catalog, or base widgets`);
}

export function formatWidgetResolutionProblems(problems: readonly PifWidgetResolutionProblem[]): string {
	return problems.map((problem, index) => {
		const prefix = problem.index !== undefined ? `required widget[${problem.index}]` : `required widget`;
		const suffix = problem.previousIndex !== undefined ? ` (first seen at [${problem.previousIndex}])` : "";
		return `${index + 1}. ${prefix} '${problem.id}'${suffix}: ${problem.message}`;
	}).join("\n");
}

/** Validate and resolve the widget ids declared in an app manifest. The
 * dependency list is widget ids only; Dart package dependencies stay on the
 * widget manifests and are handled separately. */
export function resolveRequiredWidgetSet(requiredIds: readonly string[], roots: PifWidgetLookupRoots): PifWidgetResolutionResult {
	const requested: string[] = [];
	const problems: PifWidgetResolutionProblem[] = [];
	const resolved: PifResolvedWidgetEntry[] = [];
	const seen = new Map<string, number>();
	for (const [index, raw] of requiredIds.entries()) {
		const id = String(raw ?? "").trim();
		requested.push(id);
		const humanIndex = index + 1;
		if (!id) {
			problems.push(problemMessage(id, "missing", `required widget entry at position ${humanIndex} is empty` , humanIndex));
			continue;
		}
		if (!isWidgetId(id)) {
			problems.push(problemMessage(id, "invalid", `required widget '${id}' at position ${humanIndex} must use lowercase snake_case ids`, humanIndex));
			continue;
		}
		const previous = seen.get(id);
		if (previous !== undefined) {
			problems.push(problemMessage(id, "duplicate", `required widget '${id}' is duplicated at position ${humanIndex} (first seen at position ${previous + 1})`, humanIndex, previous + 1));
			continue;
		}
		seen.set(id, index);
		const resolvedEntry = resolveWidgetFromRoots(id, roots);
		if ("reason" in resolvedEntry) {
			problems.push({ ...resolvedEntry, index: humanIndex });
			continue;
		}
		resolved.push(resolvedEntry);
	}
	resolved.sort((left, right) => left.id.localeCompare(right.id));
	return { ok: problems.length === 0, requested, resolved, problems };
}

export function createEnvelope<T>(channel: PifEnvelope["channel"], type: string, payload: T, id = crypto.randomUUID()): PifEnvelope<T> {
	if (!PIF_CHANNELS.includes(channel.split("/")[0] as PifChannel)) throw new Error(`Unsupported pif channel: ${channel}`);
	if (!type.trim()) throw new Error("Envelope type is required");
	return { v: PIF_PROTOCOL_VERSION, id, ts: new Date().toISOString(), channel, type, payload };
}

export function decodeEnvelope(raw: string | Buffer): PifEnvelope {
	let value: unknown;
	try { value = JSON.parse(raw.toString()); } catch { throw new Error("Invalid pif JSON envelope"); }
	if (!value || typeof value !== "object") throw new Error("Invalid pif envelope");
	const env = value as Record<string, unknown>;
	if (env.v !== PIF_PROTOCOL_VERSION || typeof env.id !== "string" || typeof env.ts !== "string" || typeof env.channel !== "string" || typeof env.type !== "string" || !("payload" in env)) {
		throw new Error("Invalid pif envelope shape");
	}
	if (!PIF_CHANNELS.includes(env.channel.split("/")[0] as PifChannel)) throw new Error(`Unsupported pif channel: ${env.channel}`);
	return env as unknown as PifEnvelope;
}

function scalar(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
	return trimmed;
}

export function parseWidgetManifest(raw: string): PifWidgetManifest {
	const values: Record<string, string> = {};
	for (const source of raw.split(/\r?\n/)) {
		const line = source.replace(/\s+#.*$/, "").trim();
		if (!line || line.startsWith("#")) continue;
		const at = line.indexOf(":");
		if (at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
	}
	const required = ["id", "name", "version", "description", "slot", "core"];
	for (const key of required) if (!values[key]) throw new Error(`widget.yaml missing ${key}`);
	const id = scalar(values.id);
	if (!isWidgetId(id)) throw new Error("Widget id must be lowercase snake_case");
	const slot = scalar(values.slot) as PifWidgetManifest["slot"];
	if (!["left", "center", "right", "bottom", "status", "page"].includes(slot)) throw new Error(`Invalid widget slot: ${slot}`);
	const list = (source = "") => {
		const text = source.trim();
		if (!text || text === "[]") return [];
		if (!text.startsWith("[") || !text.endsWith("]")) throw new Error(`Expected YAML inline list: ${source}`);
		return text.slice(1, -1).split(",").map((entry) => scalar(entry)).filter(Boolean);
	};
	return {
		id,
		name: scalar(values.name),
		version: scalar(values.version),
		description: scalar(values.description),
		slot,
		core: scalar(values.core) === "true",
		tags: list(values.tags),
		dart_dependencies: list(values.dart_dependencies),
	};
}

export function widgetClassName(id: string): string {
	return id.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("") + "Plugin";
}

export function generateWidgetRegistry(manifests: PifRegistryEntry[]): string {
	const sorted = [...manifests].sort((a, b) => a.id.localeCompare(b.id));
	const imports = sorted.map((m) => `import '${registryImportPath(m)}';`).join("\n");
	const factories = sorted.map((m) => `${m.source ? `    // source: ${m.source}\n` : ""}    '${m.id}': () => ${widgetClassName(m.id)}(),`).join("\n");
	return `// GENERATED BY pif. DO NOT EDIT.\nimport 'core/plugin.dart';\n${imports}\n\nMap<String, PifWidgetPlugin Function()> pifWidgetFactories() {\n  return {\n${factories}\n  };\n}\n`;
}

/** Registry codegen input: a manifest plus its resolved source layer. Base
 * widgets import through the app package convention; project overlay widgets
 * live outside the app package and carry an explicit `importPath` (a `file:`
 * URI) so the single generated registry reflects the shadowed winner. */
export interface PifRegistryEntry extends PifWidgetManifest { source?: PifWidgetSource; importPath?: string; }

function registryImportPath(entry: PifRegistryEntry): string {
	const value = entry.importPath ?? `widgets/${entry.id}/${entry.id}.dart`;
	if (value.startsWith("/") || !/^[^'"\\\s]+$/.test(value)) throw new Error(`Unsafe registry import path for ${entry.id}: ${value}`);
	return value;
}

/** Dart import URI for a file outside the app package (project overlay
 * widgets): a `file:` URI is the only form the analyzer resolves from inside
 * the app package, and it keeps the single registry contract intact. Throws
 * on paths that cannot be embedded safely in generated Dart. */
export function dartFileUri(filePath: string): string {
	const uri = pathToFileURL(path.resolve(filePath)).href;
	if (!/^[^'"\\\s]+$/.test(uri)) throw new Error(`Unsafe Dart import URI: ${filePath}`);
	return uri;
}

function hasAppContentsMarker(candidate: string): boolean {
	const parts = candidate.split(path.sep).filter(Boolean);
	for (let index = 0; index < parts.length - 1; index++) {
		if (parts[index].endsWith('.app') && parts[index + 1] === 'Contents') return true;
	}
	return false;
}

function resolveCanonicalPifPath(candidate: string): string {
	const raw = candidate.split(path.sep).filter((part) => part.length > 0);
	const absolute = path.isAbsolute(candidate);
	let current = absolute ? path.parse(candidate).root : fs.realpathSync(process.cwd());

	for (let index = 0; index < raw.length; index++) {
		const part = raw[index];
		if (part === '.') continue;
		if (part === '..') {
			const parent = path.dirname(current);
			current = parent === current ? current : parent;
			continue;
		}

		const next = path.join(current, part);
		let stat: fs.Stats;
		try {
			stat = fs.lstatSync(next);
		} catch (error: any) {
			if (error?.code !== 'ENOENT') throw error;
			current = next;
			continue;
		}

		if (stat.isSymbolicLink()) {
			let resolved: string;
			try {
				resolved = fs.realpathSync(next);
			} catch (error: any) {
				throw new Error(`Unable to resolve symlink for writable path ${candidate}: ${error.message}`);
			}
			let resolvedStat: fs.Stats;
			try {
				resolvedStat = fs.statSync(resolved);
			} catch (error: any) {
				throw new Error(`Unable to stat symlink target for writable path ${candidate}: ${error.message}`);
			}
			if (index < raw.length - 1 && !resolvedStat.isDirectory()) throw new Error(`Path component is not a directory: ${next}`);
			current = resolved;
			continue;
		}

		if (index < raw.length - 1 && !stat.isDirectory()) throw new Error(`Path component is not a directory: ${next}`);
		current = next;
	}

	return current;
}

/** Best-effort predicate for whether a path is inside an app bundle. Throws
 * on dangling or unresolvable links so callers can fail closed. */
export function isInsideAppBundle(candidate: string): boolean {
	const lexical = path.resolve(candidate);
	const canonical = resolveCanonicalPifPath(candidate);
	return hasAppContentsMarker(lexical) || hasAppContentsMarker(canonical);
}

/** Resolve a writable path and reject any lexical or effective location that
 * enters an .app/Contents bundle. Returns the effective canonical path for
 * safe filesystem writes. */
export function assertWritablePifPath(candidate: string): string {
	const lexical = path.resolve(candidate);
	const canonical = resolveCanonicalPifPath(candidate);
	if (hasAppContentsMarker(lexical) || hasAppContentsMarker(canonical)) {
		throw new Error(`Destination is inside a signed app bundle and cannot be written: ${candidate}`);
	}
	return canonical;
}

export function assertSafeWidgetPath(root: string, candidate: string): string {
	const resolvedRoot = path.resolve(root);
	const resolved = path.resolve(candidate);
	if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Path escapes pif widget boundary: ${candidate}`);
	return resolved;
}

export interface PifBoardColumn { id: string; name: string; state?: "open" | "closed"; label?: string; status?: "any" | "none"; }
export interface PifBoardConfig { columns: PifBoardColumn[]; }
export interface PifTrackerCard { number: number; title: string; type: "epic" | "sprint" | "task" | "issue"; state: "open" | "closed"; labels: string[]; body: string; updatedAt: string; url: string; column: string; parent: number | null; excerpt: string; }

/** Parent link for a card, parsed from its body Reference Index (`Epic: #12`,
 * `Sprint**: #34` — markdown bold tolerated). A task binds to its sprint when
 * exactly one is referenced, else its epic; a sprint binds to its epic.
 * Ambiguity (two different references at the same level) resolves to null —
 * never a guess (#188). */
export function trackerParentRef(body: string, type: string): number | null {
	if (type === "epic" || type === "issue") return null;
	const distinct = (pattern: RegExp): number[] => [...new Set([...body.matchAll(pattern)].map((m) => Number(m[1])))];
	const epics = distinct(/epic\*{0,2}\s*:\s*#?(\d+)/gi);
	const sprints = distinct(/sprint\*{0,2}\s*:\s*#?(\d+)/gi);
	if (type === "sprint") return sprints.length === 1 ? sprints[0] : epics.length === 1 ? epics[0] : null;
	if (sprints.length === 1) return sprints[0];
	if (sprints.length === 0 && epics.length === 1) return epics[0];
	return null;
}

// --- App manifest (#157): pif_app/app.yaml — the project's app model ---

export interface PifAppManifest {
  id: string;
  name: string;
  version: string;
  home: string;
  pages: string[];
  template?: string;
  dependencies: string[];
}

export function slugifyAppId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "my-app";
}

function parseYamlStringList(value: string): string[] {
  const inline = value.match(/^\[(.*)\]$/);
  if (inline) {
    return inline[1].split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  return [];
}

/** Parse + validate `pif_app/app.yaml` (settled schema, task #157): id,
 * name, version, home, pages (ordered), optional template + dependencies.
 * `dependencies` is a widget-id list, not Dart package dependencies. Every
 * rejection is an actionable diagnostic; nothing is guessed. */
export function parseAppManifest(text: string): { manifest?: PifAppManifest; error?: string } {
  const values = new Map<string, string>();
  const lists = new Map<string, string[]>();
  let currentList: string | null = null;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) { currentList = null; continue; }
    if (currentList && /^-\s+/.test(line)) {
      lists.get(currentList)!.push(line.replace(/^-\s+/, "").trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    const pair = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (!pair) return { error: `app.yaml line ${index + 1}: expected 'key: value' or a list item, got: ${raw.trim()}` };
    const [, key, value] = pair;
    currentList = null;
    if (value === "") { lists.set(key, []); currentList = key; } else { values.set(key, value.trim().replace(/^["']|["']$/g, "")); }
  }
  const id = values.get("id") ?? "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { error: `app.yaml: 'id' must be a kebab identifier (lowercase letters, digits, dashes) — got '${id || "(missing)"}'` };
  const name = values.get("name") ?? "";
  if (!name) return { error: "app.yaml: 'name' is required (display name for the app)" };
  const pages = lists.get("pages") ?? parseYamlStringList(values.get("pages") ?? "");
  if (!pages.length) return { error: "app.yaml: 'pages' must list at least one page widget id (ordered, first entry is not necessarily home)" };
  if (new Set(pages).size !== pages.length) return { error: "app.yaml: 'pages' contains duplicate widget ids" };
  const home = values.get("home") ?? "";
  if (!pages.includes(home)) return { error: `app.yaml: 'home' must be one of the declared pages — got '${home || "(missing)"}'; pages: ${pages.join(", ")}` };
  const dependencies = lists.get("dependencies") ?? parseYamlStringList(values.get("dependencies") ?? "");
  const manifest: PifAppManifest = { id, name, version: values.get("version") || "0.1.0", home, pages, template: values.get("template") || undefined, dependencies };
  if (manifest.template !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(manifest.template)) return { error: `app.yaml: 'template' must be a kebab identifier — got '${manifest.template}'` };
  return { manifest };
}

/** Render the manifest back to canonical app.yaml text (single key order,
 * block lists) so hub writes never churn the file. */
export function renderAppManifest(manifest: PifAppManifest): string {
  const lines = [
    `id: ${manifest.id}`,
    `name: ${manifest.name}`,
    `version: ${manifest.version}`,
    `home: ${manifest.home}`,
    "pages:",
    ...manifest.pages.map((page) => `  - ${page}`),
  ];
  if (manifest.template) lines.push(`template: ${manifest.template}`);
  if (manifest.dependencies.length) {
    lines.push("dependencies:", ...manifest.dependencies.map((dep) => `  - ${dep}`));
  }
  return `${lines.join("\n")}\n`;
}

/** Pure manifest updates used by the pif_app_* tools: adding a page keeps
 * order and rejects duplicates; setting home requires a declared page. */
export function addAppPage(manifest: PifAppManifest, page: string): { manifest?: PifAppManifest; error?: string } {
  if (!isWidgetId(page)) return { error: `Page id must be a lowercase widget identifier (snake_case) — got '${page}'` };
  if (manifest.pages.includes(page)) return { error: `Page '${page}' is already declared` };
  return { manifest: { ...manifest, pages: [...manifest.pages, page] } };
}

export function setAppHome(manifest: PifAppManifest, home: string): { manifest?: PifAppManifest; error?: string } {
  if (!manifest.pages.includes(home)) return { error: `Home must be one of the declared pages: ${manifest.pages.join(", ")} — got '${home}'` };
  return { manifest: { ...manifest, home } };
}

/** Tag→label diff for a ticket update (#189): `desired` is the full tag list
 * from the Attributes pane; `status:*` labels and the card's type label are
 * mechanical and always preserved. Returns the gh label add/remove plan. */
export function plannedLabelChange(current: string[], desired: string[], type?: string): { add: string[]; remove: string[] } {
	const keep = new Set([...current.filter((l) => l.startsWith("status:")), ...(type ? [type] : [])]);
	const want = new Set(desired.map((l) => l.trim()).filter(Boolean));
	const add = [...want].filter((l) => !current.includes(l) && !keep.has(l));
	const remove = current.filter((l) => !want.has(l) && !keep.has(l));
	return { add, remove };
}

/** Plain-text card excerpt for the board preview (#188): fenced code removed,
 * markdown stripped, the Reference Index section skipped, first meaningful
 * paragraph(s) kept up to `cap` characters with an ellipsis. */
export function trackerExcerpt(body: string, cap = 240): string {
	const lines = body.replace(/```[\s\S]*?```/g, " ").split(/\r?\n/);
	const paragraphs: string[] = [];
	let current = "";
	let inReference = false;
	for (const raw of lines) {
		const line = raw.trim();
		if (/^#{1,6}\s/.test(line)) {
			if (current) { paragraphs.push(current); current = ""; }
			inReference = /reference index/i.test(line);
			continue;
		}
		if (inReference) continue;
		if (!line) {
			if (current) { paragraphs.push(current); current = ""; }
			continue;
		}
		const text = line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>]+/g, "").trim();
		if (text) current = current ? `${current} ${text}` : text;
	}
	if (current) paragraphs.push(current);
	const text = paragraphs.join(" ").replace(/\s+/g, " ").trim();
	if (text.length <= cap) return text;
	const cut = text.slice(0, cap);
	return `${cut.slice(0, Math.min(cut.length, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length))}…`;
}

/** Repo-versioned board definition (`.pif/board.yaml`): a `column <id>:` block
 * per column with `name`, an optional `state` (open|closed), an optional exact
 * `label` to match and write back, and `status: any|none` for presence of any
 * `status:*` label. The first column whose rules all hold claims the card. */
export function parseBoardConfig(raw: string): PifBoardConfig {
	const columns: PifBoardColumn[] = [];
	let current: PifBoardColumn | null = null;
	for (const source of raw.split(/\r?\n/)) {
		const line = source.replace(/\s+#.*$/, "");
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const header = /^column\s+([a-z][a-z0-9_-]*)\s*:\s*$/.exec(line.trim());
		if (header) { current = { id: header[1], name: "" }; columns.push(current); continue; }
		const at = line.indexOf(":");
		const key = at > 0 ? line.slice(0, at).trim() : "";
		if (!/^[\w-]+$/.test(key)) throw new Error(`Unexpected board.yaml line: ${line.trim()}`);
		if (!current) throw new Error("board.yaml properties must follow a column header");
		const value = scalar(line.slice(at + 1));
		if (key === "name") current.name = value;
		else if (key === "state") { if (value !== "open" && value !== "closed") throw new Error(`Invalid column state: ${value}`); current.state = value; }
		else if (key === "label") current.label = value;
		else if (key === "status") { if (value !== "any" && value !== "none") throw new Error(`Invalid column status rule: ${value}`); current.status = value; }
		else throw new Error(`Unknown board.yaml column key: ${key}`);
	}
	if (!columns.length) throw new Error("board.yaml requires at least one column");
	for (const column of columns) {
		if (!column.name) throw new Error(`Column ${column.id} is missing a name`);
		if (columns.filter((candidate) => candidate.id === column.id).length > 1) throw new Error(`Duplicate column id: ${column.id}`);
	}
	return { columns };
}

/** Zero-config board for repos without `.pif/board.yaml`. */
export function defaultBoardConfig(): PifBoardConfig {
	return { columns: [
		{ id: "backlog", name: "Backlog", state: "open", status: "none" },
		{ id: "in_progress", name: "In Progress", state: "open", status: "any" },
		{ id: "done", name: "Done", state: "closed" },
	] };
}

export function columnForCard(labels: string[], state: string, config: PifBoardConfig): string {
	for (const column of config.columns) {
		if (column.state && column.state !== state) continue;
		if (column.label && !labels.includes(column.label)) continue;
		if (column.status === "any" && !labels.some((label) => label.startsWith("status:"))) continue;
		if (column.status === "none" && labels.some((label) => label.startsWith("status:"))) continue;
		return column.id;
	}
	return config.columns[0].id;
}

const TRACKER_TYPES = ["epic", "sprint", "task"] as const;

export function normalizeGhIssue(issue: any, config: PifBoardConfig): PifTrackerCard {
	const labels = Array.isArray(issue.labels) ? issue.labels.map((label: any) => String(label?.name ?? label)).filter(Boolean) : [];
	const type = TRACKER_TYPES.find((candidate) => labels.includes(candidate)) ?? "issue";
	const state = String(issue.state ?? "").toLowerCase() === "closed" ? "closed" : "open";
	return { number: Number(issue.number), title: String(issue.title ?? ""), type, state, labels, body: String(issue.body ?? "").slice(0, 20_000), updatedAt: String(issue.updatedAt ?? ""), url: String(issue.url ?? ""), column: columnForCard(labels, state, config), parent: trackerParentRef(String(issue.body ?? ""), type), excerpt: trackerExcerpt(String(issue.body ?? "")) };
}

/** Write-back plan for dropping a card on a column: ensure the column's exact
 * label, clear competing `status:*` labels, and land in the column's state. */
export function plannedTrackerMove(card: PifTrackerCard, column: PifBoardColumn): { add: string[]; remove: string[]; state: "open" | "closed" } {
	const remove = card.labels.filter((candidate) => candidate.startsWith("status:") && candidate !== column.label);
	const add = column.label && !card.labels.includes(column.label) ? [column.label] : [];
	return { add, remove, state: column.state === "closed" ? "closed" : "open" };
}

export interface TrackerState { repo: string | null; columns: { id: string; name: string }[]; cards: PifTrackerCard[]; stale: boolean; fetchedAt: string | null; error: string | null; connection: "disconnected" | "unverified" | "connected" | "error"; writable: boolean; message: string | null; }
export interface TrackerRunResult { status: number | null; stdout: string; stderr: string; code?: string; }
export type SpawnRunner = (command: string, args: string[], options: { cwd: string; timeout: number; input?: string }) => TrackerRunResult | Promise<TrackerRunResult>;
type TrackerTarget = { repo: string; version: number; writable: boolean; message: string | null };
type TrackerResult = { ok: boolean; repo?: string; number?: number; column?: string; error?: string; partial?: boolean; uncertain?: boolean };
type TrackerCreateIntent = { repo: string; fingerprint: string; number?: number };

/** Parse an origin, never a substring that merely contains github.com. */
function githubRepoFromOrigin(origin: string): string | null {
	const scp = /^git@github\.com:([^\s]+)$/i.exec(origin);
	let pathname: string;
	if (scp) pathname = `/${scp[1]}`;
	else {
		let url: URL; try { url = new URL(origin); } catch { return null; }
		if (url.hostname.toLowerCase() !== "github.com" || url.password || url.search || url.hash) return null;
		if (url.protocol === "https:") { if (url.username || url.port) return null; }
		else if (url.protocol === "ssh:") { if (url.username !== "git" || (url.port && url.port !== "22")) return null; }
		else if (url.protocol === "git:") { if (url.username || url.port) return null; }
		else return null;
		pathname = url.pathname;
	}
	const match = /^\/([a-z\d](?:[a-z\d-]*[a-z\d])?)\/([a-z\d._-]+?)(?:\.git)?\/?$/i.exec(pathname);
	if (!match || match[2] === "." || match[2] === "..") return null;
	return `${match[1]}/${match[2]}`.toLowerCase();
}

/** GitHub owns all tickets. The environment's native connection owns auth;
 * these per-repository caches are only offline read snapshots. */
export class TrackerSync {
	readonly state: TrackerState = { repo: null, columns: [], cards: [], stale: true, fetchedAt: null, error: null, connection: "disconnected", writable: false, message: "Connect GitHub in Settings to use this workspace's tracker." };
	private repoObserved: string | null | undefined;
	private repoVersion = 0;
	private originRead = 0;
	private refreshSequence = 0;
	private pendingMutations = 0;
	private mutationTail: Promise<unknown> = Promise.resolve();
	private stopped = false;
	private timer: NodeJS.Timeout | null = null;
	private kick: NodeJS.Timeout | null = null;
	private db: any = null;
	private cacheDir = "";
	private workspace: string;
	private changed: (state: TrackerState) => void;
	private runner?: SpawnRunner;
	private preferJsonCache: boolean;
	constructor(workspace: string, changed: (state: TrackerState) => void, runner?: SpawnRunner, preferJsonCache = false) {
		this.workspace = workspace; this.changed = changed; this.runner = runner; this.preferJsonCache = preferJsonCache;
	}
	async init() {
		this.cacheDir = assertWritablePifPath(path.join(this.workspace, ".pi", "pif", "cache"));
		this.legacyCacheFile();
		const dbPath = assertWritablePifPath(path.join(this.cacheDir, "tracker.db"));
		for (const suffix of ["-wal", "-shm", "-journal"]) assertWritablePifPath(`${dbPath}${suffix}`);
		if (!this.preferJsonCache) {
			try {
				const { DatabaseSync } = await import("node:sqlite");
				fs.mkdirSync(this.cacheDir, { recursive: true }); this.db = new DatabaseSync(dbPath);
				this.db.exec("CREATE TABLE IF NOT EXISTS tracker_repos (repo TEXT PRIMARY KEY, fetched_at TEXT, cards TEXT)");
			} catch { this.db = null; }
		}
		await this.resolveRepo();
	}
	start() { this.stop(); this.stopped = false; this.kick = setTimeout(() => void this.refresh(), 250); this.kick.unref?.(); this.timer = setInterval(() => void this.refresh(), 300_000); this.timer.unref?.(); }
	stop() { if (this.timer) clearInterval(this.timer); if (this.kick) clearTimeout(this.kick); this.timer = null; this.kick = null; this.stopped = true; ++this.refreshSequence; ++this.repoVersion; }
	private boardConfig(): PifBoardConfig { try { return parseBoardConfig(fs.readFileSync(path.join(this.workspace, ".pif", "board.yaml"), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultBoardConfig(); throw new Error(`Invalid board.yaml: ${String((error as Error).message)}`); } }
	private async git(args: string[]): Promise<TrackerRunResult> {
		const command = process.env.PIF_GIT_BIN || "git";
		return this.runner ? await this.runner(command, args, { cwd: this.workspace, timeout: 10_000 }) : spawnSync(command, args, { cwd: this.workspace, timeout: 10_000, encoding: "utf8" });
	}
	private async resolveRepo(): Promise<string | null> {
		const read = ++this.originRead;
		let result: TrackerRunResult = { status: 1, stdout: "", stderr: "" };
		try {
			const root = await this.git(["rev-parse", "--show-toplevel"]);
			// Git searches ancestor directories. A local-only child environment
			// must not inherit its creator's origin or ticket authority.
			if (root.status === 0 && fs.realpathSync(String(root.stdout ?? "").trim()) === fs.realpathSync(this.workspace)) {
				result = await this.git(["remote", "get-url", "origin"]);
			}
		} catch { /* no repository owned by this workspace: disconnected */ }
		if (read !== this.originRead) return this.state.repo;
		const repo = result.status === 0 ? githubRepoFromOrigin(String(result.stdout ?? "").trim()) : null;
		if (repo !== this.repoObserved) {
			this.repoObserved = repo; ++this.repoVersion; ++this.refreshSequence;
			Object.assign(this.state, { repo, cards: [], fetchedAt: null, stale: true, error: null, writable: false, connection: repo ? "unverified" : "disconnected", message: repo ? "Verify this repository through the environment's GitHub connection." : "Tracker disconnected. Connect GitHub in Settings after adding a GitHub origin." });
			this.state.columns = defaultBoardConfig().columns.map(({ id, name }) => ({ id, name }));
			if (repo) this.loadCache(repo);
			this.changed(this.state);
		}
		return repo;
	}
	private async assertTarget(target: TrackerTarget) {
		const repo = await this.resolveRepo();
		if (this.stopped || repo !== target.repo || this.repoVersion !== target.version) throw new Error("The workspace repository changed. Refresh the tracker before continuing; no further write was sent.");
	}
	private async github(target: TrackerTarget, args: string[], input?: string): Promise<TrackerRunResult> {
		await this.assertTarget(target);
		try { return this.runner ? await this.runner("gh", args, { cwd: this.workspace, timeout: 30_000, ...(input === undefined ? {} : { input }) }) : await runEnvironmentGithub(this.workspace, args, { timeout: 30_000, ...(input === undefined ? {} : { input }) }); }
		catch { return { status: 1, stdout: "", stderr: "GitHub did not complete the request. Check the environment connection before retrying a write.", code: "connection_lost" }; }
	}
	private failure(result: TrackerRunResult, fallback: string): Error { return new Error(result.stderr.trim() || fallback); }
	private parseObject(result: TrackerRunResult, fallback: string): any {
		if (result.status !== 0) throw this.failure(result, fallback);
		try { const value = JSON.parse(result.stdout); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch { /* malformed response */ }
		throw new Error(`${fallback}: GitHub returned an invalid response.`);
	}
	private async verifyTarget(forWrite = true): Promise<TrackerTarget> {
		const repo = await this.resolveRepo();
		if (!repo) throw new Error("Tracker disconnected. Add a GitHub origin and connect this environment in Settings.");
		const target: TrackerTarget = { repo, version: this.repoVersion, writable: false, message: null };
		const metadata = this.parseObject(await this.github(target, ["api", `repos/${repo}`]), "Could not verify the GitHub repository");
		await this.assertTarget(target);
		if (String(metadata.full_name ?? "").toLowerCase() !== repo || metadata.has_issues !== true) throw new Error("GitHub did not confirm the workspace repository with issues enabled. Tracker writes remain disabled.");
		const permissions = metadata.permissions;
		const permissionKeys = ["admin", "maintain", "push", "triage"];
		const reportedPermissions = permissionKeys.map((key) => permissions?.[key]).filter((value) => typeof value === "boolean");
		const knownReadOnly = reportedPermissions.length > 0 && !reportedPermissions.includes(true);
		target.writable = !knownReadOnly;
		target.message = knownReadOnly ? "This GitHub repository is read-only for the connected account." : !reportedPermissions.length ? "GitHub did not report repository write permissions; each requested write is checked by GitHub." : null;
		if (forWrite && knownReadOnly) throw new Error(target.message!);
		return target;
	}
	private async subIssues(target: TrackerTarget, parent: number): Promise<any[]> {
		const children: any[] = [];
		for (let page = 1; page <= 3; page++) {
			const result = await this.github(target, ["api", `repos/${target.repo}/issues/${parent}/sub_issues?per_page=100&page=${page}`]);
			if (result.status !== 0) throw this.failure(result, `Could not read sub-issues of #${parent}`);
			let values: any; try { values = JSON.parse(result.stdout); } catch { throw new Error(`Invalid sub-issue response for #${parent}`); }
			if (!Array.isArray(values)) throw new Error(`Invalid sub-issue response for #${parent}`);
			children.push(...values);
			if (values.length < 100) break;
		}
		return children;
	}
	private sameRepositoryIssue(issue: any, repo: string): boolean {
		if (issue.repository_url !== undefined) return String(issue.repository_url).toLowerCase() === `https://api.github.com/repos/${repo}`;
		return String(issue.html_url ?? "").toLowerCase().startsWith(`https://github.com/${repo}/issues/`);
	}
	async refresh(): Promise<TrackerResult> {
		await this.resolveRepo();
		if (!this.state.repo) return { ok: true };
		if (this.pendingMutations || this.stopped) return { ok: false, error: "Tracker update is already in progress." };
		const sequence = ++this.refreshSequence;
		const version = this.repoVersion;
		try {
			const config = this.boardConfig();
			const target = await this.verifyTarget(false);
			const result = await this.github(target, ["issue", "list", "-R", target.repo, "--state", "all", "--limit", "300", "--json", "number,title,state,labels,updatedAt,url,body"]);
			if (result.status !== 0) throw this.failure(result, "Could not read GitHub issues");
			let issues: any; try { issues = JSON.parse(result.stdout); } catch { throw new Error("GitHub returned invalid issue data."); }
			if (!Array.isArray(issues)) throw new Error("GitHub returned invalid issue data.");
			const cards: PifTrackerCard[] = issues.map((issue) => normalizeGhIssue(issue, config));
			const nativeParents = new Map<number, number>();
			for (const parent of cards.filter((card) => card.type === "epic" || card.type === "sprint")) {
				for (const child of await this.subIssues(target, parent.number)) {
					if (!this.sameRepositoryIssue(child, target.repo)) continue;
					const number = Number(child.number);
					if (nativeParents.has(number) && nativeParents.get(number) !== parent.number) throw new Error(`GitHub returned conflicting parents for #${number}.`);
					nativeParents.set(number, parent.number);
				}
			}
			await this.assertTarget(target);
			if (sequence !== this.refreshSequence || this.pendingMutations) return { ok: false, error: "A newer tracker operation superseded this refresh." };
			for (const card of cards) if (nativeParents.has(card.number)) card.parent = nativeParents.get(card.number)!;
			Object.assign(this.state, { cards: cards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), columns: config.columns.map(({ id, name }) => ({ id, name })), stale: false, fetchedAt: new Date().toISOString(), error: null, writable: target.writable, connection: "connected", message: target.message });
			this.writeCache(); this.changed(this.state); return { ok: true };
		} catch (error) {
			if (sequence !== this.refreshSequence || version !== this.repoVersion || this.stopped) return { ok: false, error: "A newer workspace or tracker operation superseded this refresh." };
			this.state.stale = true; this.state.writable = false; this.state.connection = "error"; this.state.error = String((error as Error).message); this.changed(this.state);
			return { ok: false, error: this.state.error };
		}
	}
	private mutate(params: any, operation: () => Promise<TrackerResult>): Promise<TrackerResult> {
		// Capture the board the user acted on, not whichever origin happens to
		// be current when a queued mutation eventually gets its turn.
		const requestedRepo = this.state.repo; const requestedVersion = this.repoVersion;
		++this.pendingMutations; ++this.refreshSequence;
		const run = async () => { try {
			await this.resolveRepo();
			if (requestedRepo !== this.state.repo || requestedVersion !== this.repoVersion || this.stopped) throw new Error("The workspace repository changed. Refresh the tracker before retrying this action.");
			if (params?.repo !== undefined && String(params.repo).toLowerCase() !== this.state.repo) throw new Error("This action belongs to a different repository. Reopen the ticket from the current tracker.");
			return { ...await operation(), ...(requestedRepo ? { repo: requestedRepo } : {}) };
		} catch (error) { return { ok: false, ...(requestedRepo ? { repo: requestedRepo } : {}), error: String((error as Error).message) }; } };
		const result = this.mutationTail.then(run, run);
		this.mutationTail = result;
		return result.finally(() => { --this.pendingMutations; ++this.refreshSequence; });
	}
	private async readCard(target: TrackerTarget, number: number, config: PifBoardConfig): Promise<PifTrackerCard> {
		const issue = this.parseObject(await this.github(target, ["issue", "view", String(number), "-R", target.repo, "--json", "number,title,state,labels,updatedAt,url,body"]), `Could not read issue #${number}`);
		if (Number(issue.number) !== number) throw new Error("GitHub returned a different issue. No write was sent.");
		const card = normalizeGhIssue(issue, config);
		card.parent = this.state.cards.find((candidate) => candidate.number === number)?.parent ?? card.parent;
		return card;
	}
	private publishCard(card: PifTrackerCard) { this.state.cards = [card, ...this.state.cards.filter((candidate) => candidate.number !== card.number)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); this.writeCache(); this.changed(this.state); }
	private async ensureLabels(target: TrackerTarget, labels: string[]) {
		for (const name of [...new Set(labels)]) {
			if (!name || Buffer.byteLength(name) > 100 || name.includes("/")) throw new Error("Tracker labels must be non-empty, at most 100 bytes, and contain no slash.");
			const args = ["api", `repos/${target.repo}/labels/${encodeURIComponent(name)}`];
			const found = await this.github(target, args);
			if (found.status === 0) continue;
			if (found.code !== "not_found") throw this.failure(found, `Could not check label ${name}`);
			const created = await this.github(target, ["api", "--method", "POST", `repos/${target.repo}/labels`, "--input", "-"], JSON.stringify({ name, color: "ededed", description: "pif tracker label" }));
			if (created.status !== 0) {
				// Labels are unique by name. Read back a concurrent/uncertain create;
				// never drop labels or retry issue creation as a fallback.
				const readback = await this.github(target, args);
				if (readback.status !== 0) throw this.failure(created, `Could not create label ${name}`);
			}
		}
	}
	move(params: any): Promise<TrackerResult> { return this.mutate(params, async () => {
		const target = await this.verifyTarget(); const number = Number(params.number);
		if (!Number.isSafeInteger(number) || number < 1 || !this.state.cards.some((card) => card.number === number)) return { ok: false, error: `Unknown card #${number}` };
		const config = this.boardConfig(); const columnId = String(params.column ?? ""); const column = config.columns.find((candidate) => candidate.id === columnId);
		if (!column) return { ok: false, error: `Unknown column: ${columnId}` };
		const card = await this.readCard(target, number, config); const plan = plannedTrackerMove(card, column);
		await this.ensureLabels(target, plan.add);
		if (plan.add.length || plan.remove.length) {
			const args = ["issue", "edit", String(number), "-R", target.repo];
			for (const label of plan.add) args.push("--add-label", label); for (const label of plan.remove) args.push("--remove-label", label);
			const result = await this.github(target, args); if (result.status !== 0) throw this.failure(result, "Could not update tracker labels");
		}
		if (plan.state !== card.state) { const result = await this.github(target, ["issue", plan.state === "closed" ? "close" : "reopen", String(number), "-R", target.repo]); if (result.status !== 0) throw this.failure(result, "Could not change issue state; refresh to see any completed label changes"); }
		const updated = await this.readCard(target, number, config); await this.assertTarget(target); this.publishCard(updated); return { ok: true, number, column: updated.column };
	}); }
	async list() { await this.resolveRepo(); return { ...this.state, cards: this.state.cards.map(({ body, ...card }) => card) }; }
	private intentFile(repo: string, fingerprint: string): string { return assertWritablePifPath(path.join(this.cacheDir || path.join(this.workspace, ".pi", "pif", "cache"), `tracker-create-${crypto.createHash("sha256").update(repo).digest("hex").slice(0, 16)}-${fingerprint}.json`)); }
	private readIntent(repo: string, fingerprint: string): TrackerCreateIntent | null { const file = this.intentFile(repo, fingerprint); if (!fs.existsSync(file)) return null; const value = JSON.parse(fs.readFileSync(file, "utf8")); if (value.repo !== repo || value.fingerprint !== fingerprint || (value.number !== undefined && (!Number.isSafeInteger(value.number) || value.number < 1))) throw new Error("The pending issue creation record is invalid. Inspect GitHub before retrying."); return value; }
	private writeIntent(value: TrackerCreateIntent) { const file = this.intentFile(value.repo, value.fingerprint); const temporary = assertWritablePifPath(`${file}.tmp`); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(temporary, JSON.stringify(value) + "\n", { mode: 0o600 }); fs.renameSync(temporary, file); }
	private async linkParent(target: TrackerTarget, parent: number, number: number) {
		if ((await this.subIssues(target, parent)).some((child) => Number(child.number) === number && this.sameRepositoryIssue(child, target.repo))) return;
		const child = this.parseObject(await this.github(target, ["api", `repos/${target.repo}/issues/${number}`]), `Could not resolve issue #${number}`);
		if (!Number.isSafeInteger(child.id) || Number(child.number) !== number || !this.sameRepositoryIssue(child, target.repo)) throw new Error("GitHub did not confirm the newly created issue identity.");
		const linked = await this.github(target, ["api", "--method", "POST", `repos/${target.repo}/issues/${parent}/sub_issues`, "--input", "-"], JSON.stringify({ sub_issue_id: child.id }));
		if (linked.status !== 0 && !(await this.subIssues(target, parent)).some((candidate) => Number(candidate.number) === number && this.sameRepositoryIssue(candidate, target.repo))) throw this.failure(linked, `Could not link #${number} under #${parent}`);
	}
	create(params: any): Promise<TrackerResult> { return this.mutate(params, async () => {
		const title = String(params.title ?? "").trim(); if (!title) return { ok: false, error: "Title is required" };
		const target = await this.verifyTarget(); const config = this.boardConfig(); const type = TRACKER_TYPES.find((candidate) => candidate === String(params.type ?? "")) ?? "issue"; const body = String(params.body ?? "");
		const column = params.column ? config.columns.find((candidate) => candidate.id === String(params.column)) : undefined;
		if (params.column && !column) return { ok: false, error: `Unknown column: ${params.column}` };
		const parent = params.parent === undefined || params.parent === null ? trackerParentRef(body, type) : Number(params.parent);
		if (parent !== null) {
			if (!Number.isSafeInteger(parent) || parent < 1 || type === "epic") return { ok: false, error: "A child ticket requires a valid parent epic or sprint number." };
			const parentIssue = this.parseObject(await this.github(target, ["api", `repos/${target.repo}/issues/${parent}`]), `Could not verify parent #${parent}`);
			const parentType = normalizeGhIssue(parentIssue, config).type;
			if (Number(parentIssue.number) !== parent || !this.sameRepositoryIssue(parentIssue, target.repo) || (parentType !== "epic" && parentType !== "sprint")) return { ok: false, error: "The parent must be an epic or sprint in this workspace's GitHub repository." };
		}
		const labels = [...(type === "issue" ? [] : [type]), ...(column?.label ? [column.label] : [])];
		const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ title, body, type, column: column?.id ?? null, parent })).digest("hex").slice(0, 24);
		let intent = this.readIntent(target.repo, fingerprint);
		if (intent && !intent.number) return { ok: false, uncertain: true, error: "A previous creation of this ticket may already exist on GitHub. It was not repeated. Refresh and inspect the repository before creating another ticket." };
		if (!intent) {
			await this.ensureLabels(target, labels);
			intent = { repo: target.repo, fingerprint }; this.writeIntent(intent);
			const args = ["issue", "create", "-R", target.repo, "--title", title, "--body", body]; for (const label of labels) args.push("--label", label);
			let created: TrackerRunResult;
			try { created = await this.github(target, args); }
			catch (error) {
				// github() throws only when its local target guard rejects before
				// dispatch. Transport/remote uncertainty is returned, never thrown.
				fs.rmSync(this.intentFile(target.repo, fingerprint), { force: true }); throw error;
			}
			if (created.status !== 0) {
				const definite = ["missing_token", "invalid_token", "insufficient_permissions", "not_found", "unsupported_operation", "environment_required"].includes(created.code ?? "");
				if (definite) fs.rmSync(this.intentFile(target.repo, fingerprint), { force: true });
				return { ok: false, uncertain: !definite, error: `${created.stderr.trim() || "GitHub did not confirm issue creation."}${definite ? "" : " This creation will not be automatically repeated; inspect GitHub before retrying."}` };
			}
			const url = created.stdout.trim().split(/\s+/).find((value) => /^https:\/\/github\.com\//.test(value));
			const parsed = url ? new URL(url) : null; const match = parsed ? /^\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)$/.exec(parsed.pathname) : null;
			if (!match || match[1].toLowerCase() !== target.repo) return { ok: false, uncertain: true, error: "GitHub accepted creation but did not return the expected issue URL. Inspect the repository; this creation will not be repeated." };
			intent.number = Number(match[2]);
			try { this.writeIntent(intent); } catch { return { ok: false, number: intent.number, partial: true, error: `GitHub created #${intent.number}, but its recovery record could not be saved. Inspect that issue before continuing; creation will not be repeated.` }; }
		}
		const number = intent.number!;
		try {
			if (parent !== null) await this.linkParent(target, parent, number);
			if (column?.state === "closed") { const result = await this.github(target, ["issue", "close", String(number), "-R", target.repo]); if (result.status !== 0) throw this.failure(result, "Could not close the created ticket"); }
			const card = await this.readCard(target, number, config); if (parent !== null) card.parent = parent;
			await this.assertTarget(target); this.publishCard(card); fs.rmSync(this.intentFile(target.repo, fingerprint), { force: true }); return { ok: true, number };
		} catch (error) { return { ok: false, number, partial: true, error: `Created #${number}, but completion is pending: ${String((error as Error).message)} Retry reuses this issue rather than creating another.` }; }
	}); }
	update(params: any): Promise<TrackerResult> { return this.mutate(params, async () => {
		const target = await this.verifyTarget(); const number = Number(params.number);
		if (!Number.isSafeInteger(number) || number < 1 || !this.state.cards.some((card) => card.number === number)) return { ok: false, error: `Unknown card #${number}` };
		const title = params.title !== undefined ? String(params.title).trim() : undefined; if (title !== undefined && !title) return { ok: false, error: "Title cannot be empty" };
		const body = params.body !== undefined ? String(params.body) : undefined; const config = this.boardConfig(); const card = await this.readCard(target, number, config);
		const labelPlan = Array.isArray(params.labels) ? plannedLabelChange(card.labels, params.labels.map(String), card.type) : { add: [], remove: [] };
		if (title === undefined && body === undefined && !labelPlan.add.length && !labelPlan.remove.length) return { ok: false, error: "Nothing to update" };
		await this.ensureLabels(target, labelPlan.add);
		const args = ["issue", "edit", String(number), "-R", target.repo]; if (title !== undefined) args.push("--title", title); if (body !== undefined) args.push("--body", body);
		for (const label of labelPlan.add) args.push("--add-label", label); for (const label of labelPlan.remove) args.push("--remove-label", label);
		const result = await this.github(target, args); if (result.status !== 0) throw this.failure(result, "Could not update GitHub issue");
		const updated = await this.readCard(target, number, config); await this.assertTarget(target); this.publishCard(updated); return { ok: true, number };
	}); }
	delete(params: any): Promise<TrackerResult> { return this.mutate(params, async () => {
		const target = await this.verifyTarget(); const number = Number(params.number);
		if (!Number.isSafeInteger(number) || number < 1 || !this.state.cards.some((card) => card.number === number)) return { ok: false, error: `Unknown card #${number}` };
		const result = await this.github(target, ["issue", "delete", String(number), "-R", target.repo, "--yes"]); if (result.status !== 0) throw this.failure(result, "Could not delete GitHub issue");
		await this.assertTarget(target); this.state.cards = this.state.cards.filter((card) => card.number !== number); this.writeCache(); this.changed(this.state); return { ok: true, number };
	}); }
	private cacheFile(repo: string): string { return assertWritablePifPath(path.join(this.cacheDir, `tracker-${crypto.createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`)); }
	private legacyCacheFile(): string { return assertWritablePifPath(path.join(this.cacheDir, "tracker-cache.json")); }
	private loadCache(repo: string) {
		let value: any;
		if (this.db) {
			try { value = this.db.prepare("SELECT repo, fetched_at AS fetchedAt, cards FROM tracker_repos WHERE repo = ?").get(repo); if (value) value.cards = JSON.parse(value.cards); } catch { /* no usable current cache */ }
			if (!value) try { const row = this.db.prepare("SELECT repo, fetched_at AS fetchedAt, cards FROM tracker WHERE id = 1 AND repo = ?").get(repo); if (row) value = { ...row, cards: JSON.parse(row.cards) }; } catch { /* no legacy table */ }
		}
		if (!value && this.cacheDir) for (const file of [this.cacheFile(repo), this.legacyCacheFile()]) {
			try { const candidate = JSON.parse(fs.readFileSync(file, "utf8")); if (candidate.repo?.toLowerCase() === repo) { value = candidate; break; } } catch { /* no matching cache */ }
		}
		if (value?.repo?.toLowerCase() !== repo || !Array.isArray(value.cards)) return;
		this.state.cards = value.cards; this.state.fetchedAt = value.fetchedAt ?? null; this.state.stale = true;
	}
	private writeCache() {
		if (!this.state.repo || !this.cacheDir) return;
		if (this.db) { this.db.prepare("INSERT INTO tracker_repos (repo, fetched_at, cards) VALUES (?, ?, ?) ON CONFLICT(repo) DO UPDATE SET fetched_at = excluded.fetched_at, cards = excluded.cards").run(this.state.repo, this.state.fetchedAt, JSON.stringify(this.state.cards)); return; }
		const file = this.cacheFile(this.state.repo); const temporary = assertWritablePifPath(`${file}.tmp`); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(temporary, JSON.stringify({ repo: this.state.repo, fetchedAt: this.state.fetchedAt, cards: this.state.cards }, null, 2) + "\n"); fs.renameSync(temporary, file);
	}
}

const CHILD_SCRUBBED_ENV_KEYS = ["PIF_AUTOSTART", "PIF_NO_FLUTTER", "PIF_PORT", "PIF_TOKEN", "PIF_ALLOWED_ORIGINS", "PIF_GH_BIN", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_CONFIG_DIR", "GH_HOST"] as const;

/** Environment for spawned child sessions: hub lifecycle vars must not
 * propagate, or every child tries to autostart a second hub on our port.
 * Credentials (PIF_TOKEN, PIF_ALLOWED_ORIGINS) are scrubbed so a
 * prompt-injected child cannot open an authenticated hub connection. */
export function childEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const child = { ...env };
	for (const key of CHILD_SCRUBBED_ENV_KEYS) delete child[key];
	for (const key of Object.keys(child)) if (key.startsWith("PIF_GITHUB_BRIDGE_")) delete child[key];
	return child;
}

export function extractPifToken(requestUrl: string): string | null {
	const query = requestUrl.split("?")[1] ?? "";
	for (const pair of query.split("&")) {
		const at = pair.indexOf("=");
		if (at <= 0) continue;
		let key: string, value: string;
		try { key = decodeURIComponent(pair.slice(0, at)); value = decodeURIComponent(pair.slice(at + 1)); } catch { return null; }
		if (key === "token") return value;
	}
	return null;
}

/** Hub upgrade authorization: a per-launch token is always required, and a
 * browser-supplied Origin (the Dart WebSocket client sends none) must be
 * explicitly allowlisted via PIF_ALLOWED_ORIGINS. */
export function pifUpgradeAuthorized(requestUrl: string, origin: string | undefined, token: string, allowedOrigins: readonly string[] = []): boolean {
	if (origin !== undefined && !allowedOrigins.includes(origin)) return false;
	const provided = extractPifToken(requestUrl);
	if (!provided || provided.length !== token.length) return false;
	return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(token));
}

/** Identity proof for the HTTP health probe: the hub answers a caller
 * nonce with an HMAC-SHA256 under the hub token, so the app only treats a
 * listener as *its* hub when it proves token possession — a port squatter
 * that merely echoes `"name":"pif"` cannot harvest the real token or the
 * user's first typed prompt. */
export function pifProbeProof(nonce: string, token: string): string {
	return crypto.createHmac("sha256", token).update(nonce).digest("hex");
}

export function pifProbeValid(nonce: string, token: string, proof: unknown): boolean {
	if (typeof proof !== "string" || proof.length !== 64) return false;
	const expected = Buffer.from(pifProbeProof(nonce, token));
	const provided = Buffer.from(proof);
	return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

export const __test = { scalar };
