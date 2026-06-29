#!/usr/bin/env node
/**
 * generate-viz.js — reads all .md files in a knowledge/ directory
 * and produces a self-contained viz.html with the data embedded.
 *
 * Usage: node generate-viz.js [knowledge-dir]
 *   Defaults to current directory if no argument given.
 *
 * Output: <knowledge-dir>/viz.html (auto-loads in any browser, no folder picker needed)
 */

const fs = require("fs");
const path = require("path");

function readDirRecursive(dir, prefix = "") {
	const results = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.name === "viewer.html" || entry.name === "viz.html") continue;
		const filepath = prefix ? `${prefix}/${entry.name}` : entry.name;
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...readDirRecursive(fullPath, filepath));
		} else if (entry.name.endsWith(".md") && entry.name !== "index.md" && entry.name !== "log.md") {
			results.push({ filepath, content: fs.readFileSync(fullPath, "utf-8") });
		}
	}
	return results;
}

function escapeForScript(str) {
	return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

const knowledgeDir = process.argv[2] || ".";
const viewerPath = path.join(knowledgeDir, "viewer.html");

if (!fs.existsSync(viewerPath)) {
	console.error("Error: viewer.html not found in", knowledgeDir);
	console.error("Run this script from inside a knowledge/ directory that has viewer.html");
	process.exit(1);
}

console.log("Reading knowledge bundle from:", path.resolve(knowledgeDir));
const files = readDirRecursive(knowledgeDir);
console.log(`Found ${files.length} concept files`);

const viewerHtml = fs.readFileSync(viewerPath, "utf-8");
const dataJson = JSON.stringify(files);
const injectedData = `const __OKF_DATA__ = ${dataJson};`;
const vizHtml = viewerHtml.replace(
	"let __OKF_DATA__ = null;",
	escapeForScript(injectedData).replace(/\\\\/g, "\\").replace(/\\`/g, "`").replace(/\\\$/g, "$")
);

// Use a function replacement to avoid $ being interpreted as special patterns
// (e.g. $' inserts everything after the match, which corrupts the output)
const cleanVizHtml = viewerHtml.replace(
	"let __OKF_DATA__ = null;",
	() => `__OKF_DATA__ = ${dataJson};`
);

const outputPath = path.join(knowledgeDir, "viz.html");
fs.writeFileSync(outputPath, cleanVizHtml, "utf-8");
console.log(`Generated: ${outputPath}`);
console.log(`Open in any browser to view the knowledge graph.`);
