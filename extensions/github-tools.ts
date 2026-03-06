/**
 * GitHub Tools — Octokit-powered GitHub integration for pi
 *
 * Registers pi tools for LLM-callable GitHub operations AND exports
 * typed functions for use by other extensions (e.g., dev-pipeline).
 *
 * Auth: pulls token from `gh auth token` (zero config).
 * Includes: Issues, PRs, Repos, Labels, Milestones.
 *
 * Usage: pi -e extensions/github-tools.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execSync } from "child_process";

// ── Types ────────────────────────────────────────

export interface GitHubIssue {
	number: number;
	title: string;
	body: string;
	state: string;
	labels: string[];
	url: string;
}

export interface GitHubComment {
	id: number;
	body: string;
	createdAt: string;
	user: string;
}

export interface GitHubPR {
	number: number;
	title: string;
	body: string;
	state: string;
	head: string;
	base: string;
	labels: string[];
	url: string;
	merged: boolean;
}

export interface GitHubLabel {
	name: string;
	color: string;
	description: string;
}

export interface GitHubMilestone {
	number: number;
	title: string;
	state: string;
	description: string;
	openIssues: number;
	closedIssues: number;
}

export interface GitHubRepo {
	owner: string;
	repo: string;
}

// ── Singleton Client ─────────────────────────────

let octokitInstance: any = null;
let detectedRepo: GitHubRepo | null = null;

function getToken(): string {
	try {
		return execSync("gh auth token", { encoding: "utf-8" }).trim();
	} catch {
		throw new Error("GitHub auth failed. Run `gh auth login` first.");
	}
}

async function getOctokit() {
	if (octokitInstance) return octokitInstance;
	const { Octokit } = await import("octokit");
	const token = getToken();
	octokitInstance = new Octokit({ auth: token });
	return octokitInstance;
}

function detectRepo(cwd?: string): GitHubRepo {
	if (detectedRepo) return detectedRepo;
	try {
		const remote = execSync("git remote get-url origin", {
			encoding: "utf-8",
			cwd: cwd || process.cwd(),
		}).trim();
		// Handle: https://github.com/owner/repo.git, git@github.com:owner/repo.git
		const match = remote.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
		if (match) {
			detectedRepo = { owner: match[1], repo: match[2] };
			return detectedRepo;
		}
	} catch {}
	throw new Error("Could not detect GitHub repo from git remote. Pass owner/repo explicitly.");
}

// Reset cached repo when cwd changes
export function setRepo(owner: string, repo: string) {
	detectedRepo = { owner, repo };
}

// ── Exported Functions (for other extensions) ────

// -- Issues --

export async function createIssue(
	title: string,
	body: string,
	options?: { labels?: string[]; milestone?: number; assignees?: string[] },
): Promise<GitHubIssue> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.issues.create({
		owner, repo, title, body,
		labels: options?.labels,
		milestone: options?.milestone,
		assignees: options?.assignees,
	});
	return {
		number: res.data.number,
		title: res.data.title,
		body: res.data.body || "",
		state: res.data.state,
		labels: res.data.labels.map((l: any) => typeof l === "string" ? l : l.name),
		url: res.data.html_url,
	};
}

export async function getIssue(issueNumber: number): Promise<GitHubIssue> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
	return {
		number: res.data.number,
		title: res.data.title,
		body: res.data.body || "",
		state: res.data.state,
		labels: res.data.labels.map((l: any) => typeof l === "string" ? l : l.name),
		url: res.data.html_url,
	};
}

export async function listIssues(
	options?: { state?: "open" | "closed" | "all"; labels?: string[]; limit?: number },
): Promise<GitHubIssue[]> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.issues.listForRepo({
		owner, repo,
		state: options?.state || "open",
		labels: options?.labels?.join(","),
		per_page: options?.limit || 30,
	});
	return res.data
		.filter((i: any) => !i.pull_request) // exclude PRs from issue list
		.map((i: any) => ({
			number: i.number,
			title: i.title,
			body: i.body || "",
			state: i.state,
			labels: i.labels.map((l: any) => typeof l === "string" ? l : l.name),
			url: i.html_url,
		}));
}

export async function commentOnIssue(issueNumber: number, body: string): Promise<GitHubComment> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.issues.createComment({
		owner, repo, issue_number: issueNumber, body,
	});
	return {
		id: res.data.id,
		body: res.data.body || "",
		createdAt: res.data.created_at,
		user: res.data.user?.login || "",
	};
}

export async function getIssueComments(issueNumber: number): Promise<GitHubComment[]> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.issues.listComments({
		owner, repo, issue_number: issueNumber, per_page: 100,
	});
	return res.data.map((c: any) => ({
		id: c.id,
		body: c.body || "",
		createdAt: c.created_at,
		user: c.user?.login || "",
	}));
}

export async function closeIssue(issueNumber: number, comment?: string): Promise<void> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	if (comment) {
		await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body: comment });
	}
	await octokit.rest.issues.update({ owner, repo, issue_number: issueNumber, state: "closed" });
}

export async function reopenIssue(issueNumber: number): Promise<void> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	await octokit.rest.issues.update({ owner, repo, issue_number: issueNumber, state: "open" });
}

export async function updateIssue(
	issueNumber: number,
	updates: { title?: string; body?: string; state?: "open" | "closed"; labels?: string[]; milestone?: number | null; assignees?: string[] },
): Promise<GitHubIssue> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.issues.update({
		owner, repo, issue_number: issueNumber, ...updates,
	});
	return {
		number: res.data.number,
		title: res.data.title,
		body: res.data.body || "",
		state: res.data.state,
		labels: res.data.labels.map((l: any) => typeof l === "string" ? l : l.name),
		url: res.data.html_url,
	};
}

export async function addLabelsToIssue(issueNumber: number, labels: string[]): Promise<void> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	await octokit.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels });
}

export async function removeLabelsFromIssue(issueNumber: number, labels: string[]): Promise<void> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	for (const label of labels) {
		try {
			await octokit.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: label });
		} catch {} // ignore if label doesn't exist
	}
}

// -- Pull Requests --

export async function createPR(
	title: string,
	body: string,
	head: string,
	base: string,
	options?: { labels?: string[]; draft?: boolean },
): Promise<GitHubPR> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.pulls.create({
		owner, repo, title, body, head, base, draft: options?.draft,
	});
	if (options?.labels && options.labels.length > 0) {
		await octokit.rest.issues.addLabels({ owner, repo, issue_number: res.data.number, labels: options.labels });
	}
	return {
		number: res.data.number,
		title: res.data.title,
		body: res.data.body || "",
		state: res.data.state,
		head: res.data.head.ref,
		base: res.data.base.ref,
		labels: res.data.labels.map((l: any) => l.name),
		url: res.data.html_url,
		merged: res.data.merged,
	};
}

export async function getPR(prNumber: number): Promise<GitHubPR> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
	return {
		number: res.data.number,
		title: res.data.title,
		body: res.data.body || "",
		state: res.data.state,
		head: res.data.head.ref,
		base: res.data.base.ref,
		labels: res.data.labels.map((l: any) => l.name),
		url: res.data.html_url,
		merged: res.data.merged,
	};
}

export async function listPRs(
	options?: { state?: "open" | "closed" | "all"; limit?: number },
): Promise<GitHubPR[]> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.pulls.list({
		owner, repo, state: options?.state || "open", per_page: options?.limit || 30,
	});
	return res.data.map((p: any) => ({
		number: p.number,
		title: p.title,
		body: p.body || "",
		state: p.state,
		head: p.head.ref,
		base: p.base.ref,
		labels: p.labels.map((l: any) => l.name),
		url: p.html_url,
		merged: p.merged,
	}));
}

export async function commentOnPR(prNumber: number, body: string): Promise<GitHubComment> {
	return commentOnIssue(prNumber, body); // GitHub API treats PR comments as issue comments
}

export async function mergePR(
	prNumber: number,
	options?: { method?: "merge" | "squash" | "rebase"; commitTitle?: string },
): Promise<{ merged: boolean; message: string }> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.pulls.merge({
		owner, repo, pull_number: prNumber,
		merge_method: options?.method || "squash",
		commit_title: options?.commitTitle,
	});
	return { merged: res.data.merged, message: res.data.message };
}

export async function getPRDiff(prNumber: number): Promise<string> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
		owner, repo, pull_number: prNumber,
		mediaType: { format: "diff" },
	});
	return res.data as unknown as string;
}

// -- Labels --

export async function listLabels(): Promise<GitHubLabel[]> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.issues.listLabelsForRepo({ owner, repo, per_page: 100 });
	return res.data.map((l: any) => ({
		name: l.name,
		color: l.color,
		description: l.description || "",
	}));
}

export async function createLabel(name: string, color: string, description?: string): Promise<GitHubLabel> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.issues.createLabel({
		owner, repo, name, color: color.replace(/^#/, ""), description,
	});
	return { name: res.data.name, color: res.data.color, description: res.data.description || "" };
}

export async function deleteLabel(name: string): Promise<void> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	await octokit.rest.issues.deleteLabel({ owner, repo, name });
}

// -- Milestones --

export async function listMilestones(
	options?: { state?: "open" | "closed" | "all" },
): Promise<GitHubMilestone[]> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.issues.listMilestones({
		owner, repo, state: options?.state || "open", per_page: 100,
	});
	return res.data.map((m: any) => ({
		number: m.number,
		title: m.title,
		state: m.state,
		description: m.description || "",
		openIssues: m.open_issues,
		closedIssues: m.closed_issues,
	}));
}

export async function createMilestone(title: string, description?: string, dueOn?: string): Promise<GitHubMilestone> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.issues.createMilestone({
		owner, repo, title, description, due_on: dueOn,
	});
	return {
		number: res.data.number,
		title: res.data.title,
		state: res.data.state,
		description: res.data.description || "",
		openIssues: res.data.open_issues,
		closedIssues: res.data.closed_issues,
	};
}

export async function closeMilestone(milestoneNumber: number): Promise<void> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	await octokit.rest.issues.updateMilestone({ owner, repo, milestone_number: milestoneNumber, state: "closed" });
}

// -- Repo --

export async function createRepo(
	name: string,
	options?: { description?: string; private?: boolean; autoInit?: boolean },
): Promise<{ url: string; fullName: string }> {
	const octokit = await getOctokit();
	const res = await octokit.rest.repos.createForAuthenticatedUser({
		name,
		description: options?.description,
		private: options?.private ?? false,
		auto_init: options?.autoInit ?? false,
	});
	return { url: res.data.html_url, fullName: res.data.full_name };
}

export async function getRepoInfo(): Promise<{ fullName: string; description: string; defaultBranch: string; private: boolean; url: string }> {
	const octokit = await getOctokit();
	const { owner, repo } = detectRepo();
	const res = await octokit.rest.repos.get({ owner, repo });
	return {
		fullName: res.data.full_name,
		description: res.data.description || "",
		defaultBranch: res.data.default_branch,
		private: res.data.private,
		url: res.data.html_url,
	};
}

// ── Pi Extension (registers tools) ──────────────

export default function (pi: ExtensionAPI) {
	// -- Issue Tools --

	pi.registerTool({
		name: "github_create_issue",
		label: "Create GitHub Issue",
		description: "Create a new GitHub issue in the current repository.",
		parameters: Type.Object({
			title: Type.String({ description: "Issue title" }),
			body: Type.String({ description: "Issue body (markdown)" }),
			labels: Type.Optional(Type.Array(Type.String(), { description: "Labels to add" })),
		}),
		execute: async (_callId, args) => {
			try {
				const issue = await createIssue(args.title, args.body, { labels: args.labels });
				return { content: [{ type: "text" as const, text: `Created issue #${issue.number}: ${issue.url}` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_get_issue",
		label: "Get GitHub Issue",
		description: "Get details of a specific GitHub issue by number.",
		parameters: Type.Object({
			issue_number: Type.Number({ description: "Issue number" }),
		}),
		execute: async (_callId, args) => {
			try {
				const issue = await getIssue(args.issue_number);
				const text = [
					`# #${issue.number}: ${issue.title}`,
					`State: ${issue.state} | Labels: ${issue.labels.join(", ") || "none"}`,
					`URL: ${issue.url}`,
					"",
					issue.body,
				].join("\n");
				return { content: [{ type: "text" as const, text }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_list_issues",
		label: "List GitHub Issues",
		description: "List issues in the current repository. Filters by state and labels.",
		parameters: Type.Object({
			state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")], { description: "Issue state filter (default: open)" })),
			labels: Type.Optional(Type.Array(Type.String(), { description: "Filter by labels" })),
			limit: Type.Optional(Type.Number({ description: "Max results (default: 30)" })),
		}),
		execute: async (_callId, args) => {
			try {
				const issues = await listIssues({ state: args.state, labels: args.labels, limit: args.limit });
				const text = issues.length === 0
					? "No issues found."
					: issues.map(i => `#${i.number} [${i.state}] ${i.title} (${i.labels.join(", ") || "no labels"})`).join("\n");
				return { content: [{ type: "text" as const, text }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_comment_issue",
		label: "Comment on GitHub Issue",
		description: "Add a comment to a GitHub issue.",
		parameters: Type.Object({
			issue_number: Type.Number({ description: "Issue number" }),
			body: Type.String({ description: "Comment body (markdown)" }),
		}),
		execute: async (_callId, args) => {
			try {
				const comment = await commentOnIssue(args.issue_number, args.body);
				return { content: [{ type: "text" as const, text: `Comment added (id: ${comment.id})` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_close_issue",
		label: "Close GitHub Issue",
		description: "Close a GitHub issue with optional closing comment.",
		parameters: Type.Object({
			issue_number: Type.Number({ description: "Issue number" }),
			comment: Type.Optional(Type.String({ description: "Optional closing comment" })),
		}),
		execute: async (_callId, args) => {
			try {
				await closeIssue(args.issue_number, args.comment);
				return { content: [{ type: "text" as const, text: `Issue #${args.issue_number} closed.` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_update_issue",
		label: "Update GitHub Issue",
		description: "Update an existing GitHub issue (title, body, state, labels, assignees).",
		parameters: Type.Object({
			issue_number: Type.Number({ description: "Issue number" }),
			title: Type.Optional(Type.String({ description: "New title" })),
			body: Type.Optional(Type.String({ description: "New body" })),
			state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed")])),
			labels: Type.Optional(Type.Array(Type.String(), { description: "Replace all labels" })),
		}),
		execute: async (_callId, args) => {
			try {
				const { issue_number, ...updates } = args;
				const issue = await updateIssue(issue_number, updates);
				return { content: [{ type: "text" as const, text: `Issue #${issue.number} updated. State: ${issue.state}, Labels: ${issue.labels.join(", ") || "none"}` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_add_labels",
		label: "Add Labels to Issue",
		description: "Add labels to a GitHub issue without removing existing ones.",
		parameters: Type.Object({
			issue_number: Type.Number({ description: "Issue number" }),
			labels: Type.Array(Type.String(), { description: "Labels to add" }),
		}),
		execute: async (_callId, args) => {
			try {
				await addLabelsToIssue(args.issue_number, args.labels);
				return { content: [{ type: "text" as const, text: `Labels added to #${args.issue_number}: ${args.labels.join(", ")}` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_remove_labels",
		label: "Remove Labels from Issue",
		description: "Remove specific labels from a GitHub issue.",
		parameters: Type.Object({
			issue_number: Type.Number({ description: "Issue number" }),
			labels: Type.Array(Type.String(), { description: "Labels to remove" }),
		}),
		execute: async (_callId, args) => {
			try {
				await removeLabelsFromIssue(args.issue_number, args.labels);
				return { content: [{ type: "text" as const, text: `Labels removed from #${args.issue_number}: ${args.labels.join(", ")}` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	// -- PR Tools --

	pi.registerTool({
		name: "github_create_pr",
		label: "Create Pull Request",
		description: "Create a new pull request.",
		parameters: Type.Object({
			title: Type.String({ description: "PR title" }),
			body: Type.String({ description: "PR body (markdown)" }),
			head: Type.String({ description: "Head branch (source)" }),
			base: Type.String({ description: "Base branch (target)" }),
			labels: Type.Optional(Type.Array(Type.String(), { description: "Labels to add" })),
			draft: Type.Optional(Type.Boolean({ description: "Create as draft PR" })),
		}),
		execute: async (_callId, args) => {
			try {
				const pr = await createPR(args.title, args.body, args.head, args.base, { labels: args.labels, draft: args.draft });
				return { content: [{ type: "text" as const, text: `Created PR #${pr.number}: ${pr.url}` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_list_prs",
		label: "List Pull Requests",
		description: "List pull requests in the current repository.",
		parameters: Type.Object({
			state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])),
			limit: Type.Optional(Type.Number({ description: "Max results (default: 30)" })),
		}),
		execute: async (_callId, args) => {
			try {
				const prs = await listPRs({ state: args.state, limit: args.limit });
				const text = prs.length === 0
					? "No pull requests found."
					: prs.map(p => `#${p.number} [${p.state}${p.merged ? "/merged" : ""}] ${p.title} (${p.head} → ${p.base})`).join("\n");
				return { content: [{ type: "text" as const, text }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_get_pr",
		label: "Get Pull Request",
		description: "Get details of a specific pull request.",
		parameters: Type.Object({
			pr_number: Type.Number({ description: "PR number" }),
		}),
		execute: async (_callId, args) => {
			try {
				const pr = await getPR(args.pr_number);
				const text = [
					`# #${pr.number}: ${pr.title}`,
					`State: ${pr.state}${pr.merged ? " (merged)" : ""} | ${pr.head} → ${pr.base}`,
					`Labels: ${pr.labels.join(", ") || "none"}`,
					`URL: ${pr.url}`,
					"",
					pr.body,
				].join("\n");
				return { content: [{ type: "text" as const, text }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_merge_pr",
		label: "Merge Pull Request",
		description: "Merge a pull request. Supports merge, squash, and rebase strategies.",
		parameters: Type.Object({
			pr_number: Type.Number({ description: "PR number" }),
			method: Type.Optional(Type.Union([Type.Literal("merge"), Type.Literal("squash"), Type.Literal("rebase")], { description: "Merge method (default: squash)" })),
			commit_title: Type.Optional(Type.String({ description: "Custom merge commit title" })),
		}),
		execute: async (_callId, args) => {
			try {
				const result = await mergePR(args.pr_number, { method: args.method, commitTitle: args.commit_title });
				return { content: [{ type: "text" as const, text: result.merged ? `PR #${args.pr_number} merged.` : `Merge failed: ${result.message}` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_pr_diff",
		label: "Get PR Diff",
		description: "Get the diff of a pull request as a unified diff string.",
		parameters: Type.Object({
			pr_number: Type.Number({ description: "PR number" }),
		}),
		execute: async (_callId, args) => {
			try {
				const diff = await getPRDiff(args.pr_number);
				return { content: [{ type: "text" as const, text: diff }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	// -- Label Tools --

	pi.registerTool({
		name: "github_list_labels",
		label: "List Repo Labels",
		description: "List all labels in the current repository.",
		parameters: Type.Object({}),
		execute: async () => {
			try {
				const labels = await listLabels();
				const text = labels.length === 0
					? "No labels found."
					: labels.map(l => `${l.name} (#${l.color})${l.description ? ` — ${l.description}` : ""}`).join("\n");
				return { content: [{ type: "text" as const, text }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_create_label",
		label: "Create Repo Label",
		description: "Create a new label in the repository.",
		parameters: Type.Object({
			name: Type.String({ description: "Label name" }),
			color: Type.String({ description: "Hex color (e.g., 'ff0000' or '#ff0000')" }),
			description: Type.Optional(Type.String({ description: "Label description" })),
		}),
		execute: async (_callId, args) => {
			try {
				const label = await createLabel(args.name, args.color, args.description);
				return { content: [{ type: "text" as const, text: `Label created: ${label.name} (#${label.color})` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	// -- Milestone Tools --

	pi.registerTool({
		name: "github_list_milestones",
		label: "List Milestones",
		description: "List milestones in the current repository.",
		parameters: Type.Object({
			state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])),
		}),
		execute: async (_callId, args) => {
			try {
				const milestones = await listMilestones({ state: args.state });
				const text = milestones.length === 0
					? "No milestones found."
					: milestones.map(m => `#${m.number} [${m.state}] ${m.title} (${m.openIssues} open, ${m.closedIssues} closed)${m.description ? ` — ${m.description}` : ""}`).join("\n");
				return { content: [{ type: "text" as const, text }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_create_milestone",
		label: "Create Milestone",
		description: "Create a new milestone in the repository.",
		parameters: Type.Object({
			title: Type.String({ description: "Milestone title" }),
			description: Type.Optional(Type.String({ description: "Milestone description" })),
			due_on: Type.Optional(Type.String({ description: "Due date (ISO 8601 format, e.g., 2026-04-01T00:00:00Z)" })),
		}),
		execute: async (_callId, args) => {
			try {
				const milestone = await createMilestone(args.title, args.description, args.due_on);
				return { content: [{ type: "text" as const, text: `Milestone created: #${milestone.number} "${milestone.title}"` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	// -- Repo Tools --

	pi.registerTool({
		name: "github_repo_info",
		label: "Get Repo Info",
		description: "Get information about the current GitHub repository.",
		parameters: Type.Object({}),
		execute: async () => {
			try {
				const info = await getRepoInfo();
				const text = [
					`Repository: ${info.fullName}`,
					`Description: ${info.description || "(none)"}`,
					`Default branch: ${info.defaultBranch}`,
					`Visibility: ${info.private ? "private" : "public"}`,
					`URL: ${info.url}`,
				].join("\n");
				return { content: [{ type: "text" as const, text }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});

	pi.registerTool({
		name: "github_create_repo",
		label: "Create GitHub Repo",
		description: "Create a new GitHub repository for the authenticated user.",
		parameters: Type.Object({
			name: Type.String({ description: "Repository name" }),
			description: Type.Optional(Type.String({ description: "Repository description" })),
			private: Type.Optional(Type.Boolean({ description: "Create as private repo (default: public)" })),
		}),
		execute: async (_callId, args) => {
			try {
				const repo = await createRepo(args.name, { description: args.description, private: args.private });
				return { content: [{ type: "text" as const, text: `Repository created: ${repo.fullName}\n${repo.url}` }], details: {} };
			} catch (e: any) {
				return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true, details: {} };
			}
		},
	});
}
