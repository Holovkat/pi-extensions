/**
 * OKF — Open Knowledge Format extension for Pi
 *
 * Provides commands for interacting with a project's knowledge/ OKF bundle.
 * The bundle structure is defined in OKF-STANDARD.md (designs/templates/okf/).
 *
 * Commands:
 *   /okf-status              Show inbox count, concept counts, last curation
 *   /okf-query <search>      Search concepts by title, tags, or description
 *   /okf-capture             Write a session synthesis to knowledge/inbox/
 *   /okf-curate              Trigger curation of inbox items into permanent concepts
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { applyExtensionDefaults } from "./themeMap.ts";

const OKF_VERSION = "0.1";
const CONCEPT_DIRS = ["architecture", "components", "domain", "decisions", "process", "deprecation", "state"];
const CONCEPT_TYPES = ["Architecture", "Component", "Domain", "Decision", "Process", "Deprecation", "State", "Inbox"];

type Frontmatter = {
	type?: string;
	title?: string;
	description?: string;
	tags?: string[];
	status?: string;
	timestamp?: string;
	[key: string]: unknown;
};

type ConceptSummary = {
	filepath: string;
	filename: string;
	frontmatter: Frontmatter;
};

function resolveKnowledgeDir(ctx: ExtensionContext): string | null {
	const cwd = ctx.cwd || process.cwd();
	const knowledgeDir = join(cwd, "knowledge");
	return existsSync(knowledgeDir) ? knowledgeDir : null;
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: content };
	const yamlBlock = match[1];
	const body = match[2];
	const frontmatter: Frontmatter = {};
	for (const line of yamlBlock.split("\n")) {
		const fmMatch = line.match(/^(\w+):\s*(.*)$/);
		if (!fmMatch) continue;
	const key = fmMatch[1];
	const rawValue = fmMatch[2].trim();
	if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
		const inner = rawValue.slice(1, -1).trim();
		frontmatter[key] = inner ? inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")) : [];
	} else {
		frontmatter[key] = rawValue.replace(/^["']|["']$/g, "");
	}
	}
	return { frontmatter, body };
}

function readConceptFile(filepath: string): ConceptSummary | null {
	try {
		const content = readFileSync(filepath, "utf-8");
		const { frontmatter } = parseFrontmatter(content);
		return {
			filepath,
			filename: basename(filepath),
			frontmatter,
		};
	} catch {
		return null;
	}
}

function scanConceptDir(knowledgeDir: string, subdir: string): ConceptSummary[] {
	const dir = join(knowledgeDir, subdir);
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "index.md");
	return files
		.map((f) => readConceptFile(join(dir, f)))
		.filter((c): c is ConceptSummary => c !== null);
}

function scanInbox(knowledgeDir: string): ConceptSummary[] {
	const inboxDir = join(knowledgeDir, "inbox");
	if (!existsSync(inboxDir)) return [];
	const files = readdirSync(inboxDir).filter((f) => f.endsWith(".md") && f !== "index.md");
	return files
		.map((f) => readConceptFile(join(inboxDir, f)))
		.filter((c): c is ConceptSummary => c !== null);
}

function countAllConcepts(knowledgeDir: string): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const dir of CONCEPT_DIRS) {
		counts[dir] = scanConceptDir(knowledgeDir, dir).length;
	}
	counts["inbox"] = scanInbox(knowledgeDir).length;
	return counts;
}

function searchConcepts(knowledgeDir: string, query: string): ConceptSummary[] {
	const results: ConceptSummary[] = [];
	const lowerQuery = query.toLowerCase();
	const allDirs = [...CONCEPT_DIRS, "inbox"];
	for (const dir of allDirs) {
		const concepts = dir === "inbox" ? scanInbox(knowledgeDir) : scanConceptDir(knowledgeDir, dir);
		for (const concept of concepts) {
			const fm = concept.frontmatter;
			const searchable = [
				fm.title || "",
				fm.description || "",
				(fm.tags || []).join(" "),
				fm.type || "",
				concept.filename,
			].join(" ").toLowerCase();
			if (searchable.includes(lowerQuery)) {
				results.push(concept);
			}
		}
	}
	return results;
}

function getLastCurationTime(knowledgeDir: string): string | null {
	const logPath = join(knowledgeDir, "log.md");
	if (!existsSync(logPath)) return null;
	try {
		const content = readFileSync(logPath, "utf-8");
		const match = content.match(/## (\d{4}-\d{2}-\d{2}T[\d:]+Z)/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

function slugify(input: string): string {
	return String(input || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

function generateInboxFilename(title: string): string {
	const now = new Date();
	const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const slug = slugify(title) || "session";
	return `${timestamp}-${slug}.md`;
}

function writeInboxItem(knowledgeDir: string, title: string, body: string, extra: Record<string, string | string[]> = {}): string {
	const inboxDir = join(knowledgeDir, "inbox");
	if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });
	const filename = generateInboxFilename(title);
	const filepath = join(inboxDir, filename);
	const timestamp = new Date().toISOString();
	const fmLines: string[] = ["---", `type: Inbox`, `title: ${title}`, `timestamp: ${timestamp}`];
	if (extra.tags) {
		const tags = Array.isArray(extra.tags) ? extra.tags.join(", ") : extra.tags;
		fmLines.push(`tags: [${tags}]`);
	}
	for (const [key, value] of Object.entries(extra)) {
		if (key === "tags") continue;
		if (Array.isArray(value)) {
			fmLines.push(`${key}: [${value.join(", ")}]`);
		} else {
			fmLines.push(`${key}: ${value}`);
		}
	}
	fmLines.push("---", "");
	const content = fmLines.join("\n") + body;
	writeFileSync(filepath, content, "utf-8");
	return filepath;
}

function formatStatusLine(ctx: ExtensionContext, message: string): void {
	if (ctx.hasUI) ctx.ui.setStatus("okf", message);
}

function emitMessage(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}
	const output = level === "error" ? console.error : console.log;
	output(message);
}

function buildStatusReport(knowledgeDir: string): string {
	const counts = countAllConcepts(knowledgeDir);
	const lastCuration = getLastCurationTime(knowledgeDir);
	const totalConcepts = CONCEPT_DIRS.reduce((sum, dir) => sum + counts[dir], 0);
	const lines = [
		`OKF v${OKF_VERSION}`,
		`Bundle: ${knowledgeDir}`,
		`Total concepts: ${totalConcepts}`,
		`Inbox items: ${counts.inbox}`,
		`Last curation: ${lastCuration || "never"}`,
		"",
		"By type:",
		...CONCEPT_DIRS.map((dir) => `  ${dir}: ${counts[dir]}`),
	];
	return lines.join("\n");
}

function buildQueryResult(results: ConceptSummary[]): string {
	if (results.length === 0) return "No concepts found matching the query.";
	const lines = [`Found ${results.length} concept(s):`, ""];
	for (const r of results) {
		const fm = r.frontmatter;
		const typeTag = fm.type ? `[${fm.type}]` : "";
		const title = fm.title || r.filename;
		const desc = fm.description ? ` - ${fm.description}` : "";
		const tags = fm.tags && fm.tags.length ? ` {${fm.tags.join(", ")}}` : "";
		const relPath = r.filepath.replace(/.*knowledge\//, "knowledge/");
		lines.push(`${typeTag} ${title}${desc}${tags}`);
		lines.push(`  -> ${relPath}`);
	}
	return lines.join("\n");
}

function buildCapturePrompt(knowledgeDir: string): string {
	return [
		"Write a session synthesis to the OKF inbox.",
		"",
		`The inbox directory is: ${join(knowledgeDir, "inbox")}`,
		"",
		"Create a markdown file with the following structure:",
		"",
		"```yaml",
		"---",
		"type: Inbox",
		`title: <descriptive title for this session>`,
		`description: <one-line summary>`,
		`tags: [relevant, lowercase, tags]`,
		`timestamp: ${new Date().toISOString()}`,
		"---",
		"```",
		"",
		"Followed by these sections:",
		"## What Was Done",
		"## Decisions Made",
		"## What Was Deprecated",
		"## Lessons Learned",
		"## Current State",
		"",
		"Synthesize from the full session context: what you worked on, decisions and their rationale,",
		"patterns that were deprecated, insights gained, and the current state of the work.",
		"This is about the product, business logic, and application state, not just code diffs.",
		"",
		"Use the okf-write-inbox tool or write the file directly to the inbox directory.",
		"The filename should be: <ISO-timestamp>-<slugified-title>.md",
	].join("\n");
}

function buildCuratePrompt(knowledgeDir: string): string {
	const inboxItems = scanInbox(knowledgeDir);
	const counts = countAllConcepts(knowledgeDir);
	const allIssueRefs = new Set<string>();
	for (const item of inboxItems) {
		const refs = item.frontmatter.issue_refs;
		if (Array.isArray(refs)) {
			for (const ref of refs) allIssueRefs.add(String(ref));
		}
	}
	const issueRefList = [...allIssueRefs].sort((a, b) => Number(a) - Number(b));
	return [
		"Run OKF curation on the inbox.",
		"",
		`Knowledge bundle: ${knowledgeDir}`,
		`Unprocessed inbox items: ${inboxItems.length}`,
		`Existing concepts: ${CONCEPT_DIRS.reduce((s, d) => s + counts[d], 0)}`,
		"",
		"Curation process:",
		"1. Read all unprocessed inbox items in knowledge/inbox/",
		"2. Read existing concept files in each concept directory",
		"3. Read relevant code and git history for context",
		"4. Fetch and read any GitHub issues referenced by issue_refs in inbox items (use: gh issue view <number> --json body,title,labels)",
		"   - These issues contain rich context: pre-approved directives, acceptance criteria, linked epics, and full reasoning",
		"   - Use this context to enrich the curated concepts beyond what the commit message alone provides",
		"5. For each inbox item, determine which concept(s) to create or update",
		"6. Create new concept files with proper frontmatter (type, title, description, tags, etc.)",
		"7. Update existing concepts by merging new information",
		"8. Move superseded concepts to knowledge/deprecation/ with supersedes links",
		"9. Move processed inbox items to knowledge/inbox/processed/",
		"10. Update all index.md files with current listings",
		"11. Update knowledge/log.md with a summary of all changes",
		"",
		...(issueRefList.length > 0 ? [
			"GitHub issues to fetch for context:",
			...issueRefList.map((ref) => `  - #${ref}: gh issue view ${ref} --json body,title,labels`),
			"",
		] : []),
		"Inbox items to process:",
		...inboxItems.map((item) => {
			const refs = Array.isArray(item.frontmatter.issue_refs) ? ` (issues: #${(item.frontmatter.issue_refs as string[]).join(", #")})` : "";
			return `  - ${item.frontmatter.title || item.filename}${refs}`;
		}),
	].join("\n");
}

export default function okfExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		applyExtensionDefaults(import.meta.url, ctx);
		const knowledgeDir = resolveKnowledgeDir(ctx);
		const status = knowledgeDir
			? `OKF ready v${OKF_VERSION}`
			: "OKF inactive (no knowledge/ dir)";
		formatStatusLine(ctx, status);
	});

	pi.registerCommand("okf-status", {
		description: "Show OKF bundle status: inbox count, concept counts, last curation time",
		handler: async (_args, ctx) => {
			const knowledgeDir = resolveKnowledgeDir(ctx);
			if (!knowledgeDir) {
				emitMessage(ctx, "No knowledge/ directory found. Run /okf-init or create one manually.", "warning");
				return;
			}
			const report = buildStatusReport(knowledgeDir);
			emitMessage(ctx, report, "info");
			formatStatusLine(ctx, `OKF: ${scanInbox(knowledgeDir).length} inbox, ${CONCEPT_DIRS.reduce((s, d) => s + scanConceptDir(knowledgeDir, d).length, 0)} concepts`);
		},
	});

	pi.registerCommand("okf-query", {
		description: "Search OKF concepts by title, tags, or description: /okf-query <search>",
		handler: async (args, ctx) => {
			const knowledgeDir = resolveKnowledgeDir(ctx);
			if (!knowledgeDir) {
				emitMessage(ctx, "No knowledge/ directory found.", "warning");
				return;
			}
			const query = String(args || "").trim();
			if (!query) {
				emitMessage(ctx, "Usage: /okf-query <search terms>", "warning");
				return;
			}
			const results = searchConcepts(knowledgeDir, query);
			emitMessage(ctx, buildQueryResult(results), "info");
			formatStatusLine(ctx, `OKF query: ${results.length} results`);
		},
	});

	pi.registerCommand("okf-capture", {
		description: "Write a session synthesis to the OKF inbox for later curation",
		handler: async (_args, ctx) => {
			const knowledgeDir = resolveKnowledgeDir(ctx);
			if (!knowledgeDir) {
				emitMessage(ctx, "No knowledge/ directory found. Run /okf-init first.", "warning");
				return;
			}
			const prompt = buildCapturePrompt(knowledgeDir);
			pi.sendUserMessage(prompt);
			formatStatusLine(ctx, "OKF capture: generating session synthesis");
		},
	});

	pi.registerCommand("okf-curate", {
		description: "Trigger curation of inbox items into permanent OKF concept files",
		handler: async (_args, ctx) => {
			const knowledgeDir = resolveKnowledgeDir(ctx);
			if (!knowledgeDir) {
				emitMessage(ctx, "No knowledge/ directory found.", "warning");
				return;
			}
			const inboxCount = scanInbox(knowledgeDir).length;
			if (inboxCount === 0) {
				emitMessage(ctx, "Inbox is empty. Nothing to curate.", "info");
				return;
			}
			const prompt = buildCuratePrompt(knowledgeDir);
			pi.sendUserMessage(prompt);
			formatStatusLine(ctx, `OKF curate: processing ${inboxCount} inbox items`);
		},
	});

	pi.registerCommand("okf-init", {
		description: "Initialize a knowledge/ directory with the OKF v0.1 structure",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd || process.cwd();
			const knowledgeDir = join(cwd, "knowledge");
			if (existsSync(knowledgeDir)) {
				emitMessage(ctx, "knowledge/ directory already exists.", "warning");
				return;
			}
			const dirs = ["inbox", "inbox/processed", ...CONCEPT_DIRS];
			for (const dir of dirs) {
				mkdirSync(join(knowledgeDir, dir), { recursive: true });
			}
			const indexContent = `# ${basename(cwd)} Knowledge Index\n\n> Last updated: ${new Date().toISOString().slice(0, 10)}\n> OKF Version: ${OKF_VERSION}\n\n## Concept Groups\n\n| Group | Count | Description |\n|-------|-------|-------------|\n| [Architecture](./architecture/index.md) | 0 | How the system is structured |\n| [Components](./components/index.md) | 0 | UI components and behavior |\n| [Domain](./domain/index.md) | 0 | Business logic and domain knowledge |\n| [Decisions](./decisions/index.md) | 0 | Architectural decisions and rationale |\n| [Process](./process/index.md) | 0 | How workflows operate |\n| [Deprecation](./deprecation/index.md) | 0 | Superseded concepts |\n| [State](./state/index.md) | 0 | Current state of play |\n| [Inbox](./inbox/index.md) | 0 | Items awaiting curation |\n`;
			writeFileSync(join(knowledgeDir, "index.md"), indexContent, "utf-8");
			writeFileSync(join(knowledgeDir, "log.md"), "# Knowledge Update Log\n\n<!-- Entries added in reverse chronological order by the curation agent -->\n", "utf-8");
			for (const dir of [...CONCEPT_DIRS, "inbox"]) {
				const label = dir.charAt(0).toUpperCase() + dir.slice(1);
				writeFileSync(join(knowledgeDir, dir, "index.md"), `# ${label} Concepts\n\n| Title | Description | Tags | Status |\n|-------|-------------|------|--------|\n<!-- Rows added by curation agent -->\n`, "utf-8");
			}
			emitMessage(ctx, `OKF bundle initialized at ${knowledgeDir}`, "info");
			formatStatusLine(ctx, `OKF ready v${OKF_VERSION}`);
		},
	});
}
