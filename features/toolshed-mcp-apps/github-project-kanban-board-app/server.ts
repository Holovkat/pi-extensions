import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { html } from "./mcp-app.tsx";

const COLUMN_ORDER = ["Backlog", "In Progress", "Review", "Done"] as const;
type ColumnName = typeof COLUMN_ORDER[number];

type LabelInfo = { name: string; color?: string };
type AssigneeInfo = { login: string; name?: string; avatarUrl?: string; url?: string };
type IssueCardType = "task" | "epic" | "sprint" | "other";

type IssueCard = {
  id: string;
  itemId?: string;
  number: number;
  title: string;
  url: string;
  state: string;
  updatedAt?: string;
  body?: string;
  labels: LabelInfo[];
  assignees: AssigneeInfo[];
  type: IssueCardType;
  order: number;
  column: ColumnName;
  isClosed: boolean;
};

type ProjectFieldOption = { id: string; name: string };
type ProjectField = { id: string; name: string; options: ProjectFieldOption[] };
type ProjectInfo = {
  id: string;
  number: number;
  title: string;
  url: string;
  shortDescription?: string;
  field: ProjectField;
};

type RepoInfo = {
  owner: string;
  repo: string;
  nameWithOwner: string;
  description: string;
  url: string;
  ownerType: "User" | "Organization";
  ownerId: string;
};

type BoardSnapshot = {
  sessionId: string;
  repo: RepoInfo;
  project: ProjectInfo | null;
  columns: Array<{ id: ColumnName; title: ColumnName; cards: IssueCard[] }>;
  cards: IssueCard[];
  counts: Record<ColumnName, number>;
  updatedAt: string;
  renderInline: boolean;
  projectScopeReady: boolean;
  warnings: string[];
  error?: string;
};

type SessionState = {
  sessionId: string;
  repo: RepoInfo;
  project: ProjectInfo | null;
  projectScopeReady: boolean;
  updatedAt: string;
};

const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const resourceUri = "ui://widget/toolshed-github-project-kanban-board-v2.html";
const DEFAULT_WIDGET_DOMAIN = "https://advanced-petra-uncorrelatively.ngrok-free.dev";
const toolName = "open_github_project_kanban_board_app";
const PROJECT_TITLE = "pi-toolshed";
const STATUS_FIELD_NAME = "Kanban Status";
const sessions = new Map<string, SessionState>();

function getWidgetDomain() {
  return String(
    process.env.OPENAI_WIDGET_DOMAIN
      || process.env.TOOLSHED_PUBLIC_BASE_URL
      || process.env.PUBLIC_BASE_URL
      || DEFAULT_WIDGET_DOMAIN,
  ).trim().replace(/\/+$/, "") || DEFAULT_WIDGET_DOMAIN;
}

function buildWidgetMeta(description: string) {
  const widgetDomain = getWidgetDomain();
  return {
    ui: {
      prefersBorder: true,
    },
    "openai/widgetDescription": description,
    "openai/widgetPrefersBorder": true,
    "openai/widgetDomain": widgetDomain,
    "openai/widgetCSP": {
      connect_domains: [widgetDomain],
      resource_domains: [widgetDomain],
    },
  };
}

function nowIso() {
  return new Date().toISOString();
}

function runGh(args: string[]): string {
  return execFileSync("gh", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runGhJson<T>(args: string[]): T {
  const output = runGh(args);
  return output ? JSON.parse(output) as T : ({} as T);
}

function graphql<T>(query: string, variables: Record<string, string | number | boolean>): T {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${String(value)}`);
  }
  const payload = runGhJson<{ data?: T } & T>(args);
  return payload && typeof payload === "object" && "data" in payload && payload.data
    ? payload.data
    : (payload as T);
}

function detectRepoFromGit(): { owner: string; repo: string } {
  const remote = runGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const [owner, repo] = remote.split("/");
  if (!owner || !repo) throw new Error(`Unable to detect current GitHub repo from gh repo view: ${remote}`);
  return { owner, repo };
}

function getRepoInfo(): RepoInfo {
  const { owner, repo } = detectRepoFromGit();
  const data = graphql<{
    repository: {
      nameWithOwner: string;
      description: string | null;
      url: string;
      owner: { __typename: "User" | "Organization"; id: string };
    };
  }>(
    `query($owner:String!,$repo:String!){
      repository(owner:$owner,name:$repo){
        nameWithOwner
        description
        url
        owner { __typename id }
      }
    }`,
    { owner, repo },
  );

  return {
    owner,
    repo,
    nameWithOwner: data.repository.nameWithOwner,
    description: data.repository.description || "GitHub project board for this repository.",
    url: data.repository.url,
    ownerType: data.repository.owner.__typename,
    ownerId: data.repository.owner.id,
  };
}

function summarizeBoardError(error: unknown): string {
  const message = String((error as any)?.message || error || "Unable to load GitHub project board.");
  if (/required scopes|read:project|project scopes?/i.test(message)) {
    return "GitHub project scopes are missing for `gh`. Showing repo issues fallback until `gh auth refresh -s read:project -s project` is run.";
  }
  return message;
}

function mapColumnFromLabels(labels: LabelInfo[] = []): ColumnName {
  const names = labels.map((label) => label.name.toLowerCase());
  if (names.some((name) => /\bdone\b|\bcomplete\b|\bcompleted\b/.test(name))) return "Done";
  if (names.some((name) => /\breview\b|qa|uat|approval/.test(name))) return "Review";
  if (names.some((name) => /in[ -]?progress|active|doing|working/.test(name))) return "In Progress";
  return "Backlog";
}

function inferIssueType(title: string, labels: LabelInfo[] = []): IssueCardType {
  const normalizedTitle = String(title || "").trim().toLowerCase();
  const names = labels.map((label) => String(label?.name || "").trim().toLowerCase());
  if (names.includes("task") || /^task\b/.test(normalizedTitle)) return "task";
  if (names.includes("epic") || /^epic\b/.test(normalizedTitle)) return "epic";
  if (names.includes("sprint") || /^sprint\b/.test(normalizedTitle)) return "sprint";
  return "other";
}

function normalizeIssueNode(node: any): IssueCard {
  const labels = Array.isArray(node?.labels?.nodes) ? node.labels.nodes.map((label: any) => ({ name: label.name, color: label.color })) : [];
  const assignees = Array.isArray(node?.assignees?.nodes)
    ? node.assignees.nodes.map((assignee: any) => ({ login: assignee.login, name: assignee.name, avatarUrl: assignee.avatarUrl, url: assignee.url }))
    : [];

  return {
    id: String(node.id),
    number: Number(node.number),
    title: String(node.title || `Issue #${node.number}`),
    url: String(node.url || ""),
    state: String(node.state || "OPEN"),
    updatedAt: String(node.updatedAt || ""),
    body: String(node.body || ""),
    labels,
    assignees,
    type: inferIssueType(String(node.title || ""), labels),
    order: 0,
    column: mapColumnFromLabels(labels),
    isClosed: String(node.state || "").toUpperCase() === "CLOSED",
  };
}

function getOpenIssues(repo: RepoInfo): IssueCard[] {
  const data = graphql<{
    repository: {
      issues: {
        nodes: any[];
      };
    };
  }>(
    `query($owner:String!,$repo:String!){
      repository(owner:$owner,name:$repo){
        issues(first:100, states:OPEN, orderBy:{field:UPDATED_AT,direction:DESC}){
          nodes{
            id
            number
            title
            url
            state
            updatedAt
            body
            labels(first:20){ nodes { name color } }
            assignees(first:10){ nodes { login name avatarUrl url } }
          }
        }
      }
    }`,
    { owner: repo.owner, repo: repo.repo },
  );

  return (data.repository.issues.nodes || []).map(normalizeIssueNode);
}

function getActiveProjectNode<T extends { user?: unknown | null; organization?: unknown | null }>(repo: RepoInfo, data: T): any {
  return repo.ownerType === "Organization" ? data.organization ?? null : data.user ?? null;
}

function findExistingProject(repo: RepoInfo): { id: string; number: number; title: string; url: string } | null {
  const data = repo.ownerType === "Organization"
    ? graphql<{
      organization: { projectsV2: { nodes: any[] } } | null;
    }>(
      `query($owner:String!,$title:String!){
        organization(login:$owner){
          projectsV2(first:20, query:$title, orderBy:{field:UPDATED_AT,direction:DESC}){
            nodes { id number title url closed }
          }
        }
      }`,
      { owner: repo.owner, title: PROJECT_TITLE },
    )
    : graphql<{
      user: { projectsV2: { nodes: any[] } } | null;
    }>(
      `query($owner:String!,$title:String!){
        user(login:$owner){
          projectsV2(first:20, query:$title, orderBy:{field:UPDATED_AT,direction:DESC}){
            nodes { id number title url closed }
          }
        }
      }`,
      { owner: repo.owner, title: PROJECT_TITLE },
    );

  const activeOwner = getActiveProjectNode(repo, data as { user?: { projectsV2?: { nodes?: any[] } } | null; organization?: { projectsV2?: { nodes?: any[] } } | null });
  const nodes = activeOwner && typeof activeOwner === "object" && "projectsV2" in activeOwner
    ? ((activeOwner as { projectsV2?: { nodes?: any[] } }).projectsV2?.nodes || [])
    : [];
  const match = nodes.find((node) => String(node.title).trim().toLowerCase() === PROJECT_TITLE.toLowerCase() && !node.closed);
  return match ? { id: String(match.id), number: Number(match.number), title: String(match.title), url: String(match.url) } : null;
}

function createProject(repo: RepoInfo): { id: string; number: number; title: string; url: string } {
  const data = graphql<{
    createProjectV2: { projectV2: { id: string; number: number; title: string; url: string } };
  }>(
    `mutation($ownerId:ID!,$title:String!){
      createProjectV2(input:{ownerId:$ownerId,title:$title}){
        projectV2 { id number title url }
      }
    }`,
    { ownerId: repo.ownerId, title: PROJECT_TITLE },
  );

  try {
    runGh(["project", "link", String(data.createProjectV2.projectV2.number), "--owner", repo.owner, "--repo", repo.nameWithOwner]);
  } catch {
    // Non-fatal. Project creation is still useful even if link metadata cannot be applied.
  }

  return data.createProjectV2.projectV2;
}

function getProjectDetails(repo: RepoInfo, projectNumber: number) {
  return repo.ownerType === "Organization"
    ? graphql<{
      organization: { projectV2: any } | null;
    }>(
      `query($owner:String!,$number:Int!){
        organization(login:$owner){
          projectV2(number:$number){
            id
            number
            title
            shortDescription
            url
            fields(first:50){
              nodes{
                ... on ProjectV2FieldCommon { id name dataType }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options { id name }
                }
              }
            }
            items(first:100){
              nodes{
                id
                content{
                  ... on Issue {
                    id
                    number
                    title
                    url
                    state
                    updatedAt
                    body
                    labels(first:20){ nodes { name color } }
                    assignees(first:10){ nodes { login name avatarUrl url } }
                  }
                }
                fieldValues(first:20){
                  nodes{
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      optionId
                      field { ... on ProjectV2SingleSelectField { id name } }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { owner: repo.owner, number: projectNumber },
    )
    : graphql<{
      user: { projectV2: any } | null;
    }>(
      `query($owner:String!,$number:Int!){
        user(login:$owner){
          projectV2(number:$number){
            id
            number
            title
            shortDescription
            url
            fields(first:50){
              nodes{
                ... on ProjectV2FieldCommon { id name dataType }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options { id name }
                }
              }
            }
            items(first:100){
              nodes{
                id
                content{
                  ... on Issue {
                    id
                    number
                    title
                    url
                    state
                    updatedAt
                    body
                    labels(first:20){ nodes { name color } }
                    assignees(first:10){ nodes { login name avatarUrl url } }
                  }
                }
                fieldValues(first:20){
                  nodes{
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      optionId
                      field { ... on ProjectV2SingleSelectField { id name } }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { owner: repo.owner, number: projectNumber },
    );
}

function ensureStatusField(repo: RepoInfo, projectNumber: number, details: any): ProjectField {
  const activeOwner = getActiveProjectNode(repo, details as { user?: { projectV2?: any } | null; organization?: { projectV2?: any } | null });
  const fields = activeOwner?.projectV2?.fields?.nodes || [];
  const existing = fields.find((field: any) => String(field?.name || "").toLowerCase() === STATUS_FIELD_NAME.toLowerCase() && Array.isArray(field?.options));
  if (existing) {
    return {
      id: String(existing.id),
      name: String(existing.name),
      options: (existing.options || []).map((option: any) => ({ id: String(option.id), name: String(option.name) })),
    };
  }

  runGhJson<any>([
    "project",
    "field-create",
    String(projectNumber),
    "--owner",
    repo.owner,
    "--name",
    STATUS_FIELD_NAME,
    "--data-type",
    "SINGLE_SELECT",
    "--single-select-options",
    COLUMN_ORDER.join(","),
    "--format",
    "json",
  ]);

  const refreshed = getProjectDetails(repo, projectNumber);
  const refreshedOwner = getActiveProjectNode(repo, refreshed as { user?: { projectV2?: any } | null; organization?: { projectV2?: any } | null });
  const refreshedFields = refreshedOwner?.projectV2?.fields?.nodes || [];
  const created = refreshedFields.find((field: any) => String(field?.name || "").toLowerCase() === STATUS_FIELD_NAME.toLowerCase() && Array.isArray(field?.options));
  if (!created) throw new Error(`Created ${STATUS_FIELD_NAME} field but could not load it.`);
  return {
    id: String(created.id),
    name: String(created.name),
    options: (created.options || []).map((option: any) => ({ id: String(option.id), name: String(option.name) })),
  };
}

function buildItemCard(node: any, statusFieldId: string): IssueCard | null {
  if (!node?.content?.number) return null;
  const card = normalizeIssueNode(node.content);
  card.itemId = String(node.id);
  const fieldValue = Array.isArray(node.fieldValues?.nodes)
    ? node.fieldValues.nodes.find((entry: any) => String(entry?.field?.id || "") === statusFieldId)
    : null;
  if (fieldValue?.name && COLUMN_ORDER.includes(fieldValue.name)) {
    card.column = fieldValue.name;
  }
  return card;
}

function setItemColumn(projectId: string, itemId: string, fieldId: string, optionId: string) {
  graphql(
    `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){
      updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){
        projectV2Item { id }
      }
    }`,
    { projectId, itemId, fieldId, optionId },
  );
}

function setItemPosition(projectId: string, itemId: string, afterId?: string | null) {
  if (afterId) {
    graphql(
      `mutation($projectId:ID!,$itemId:ID!,$afterId:ID!){
        updateProjectV2ItemPosition(input:{projectId:$projectId,itemId:$itemId,afterId:$afterId}){
          items(first:1) { nodes { id } }
        }
      }`,
      { projectId, itemId, afterId },
    );
    return;
  }
  graphql(
    `mutation($projectId:ID!,$itemId:ID!){
      updateProjectV2ItemPosition(input:{projectId:$projectId,itemId:$itemId}){
        items(first:1) { nodes { id } }
      }
    }`,
    { projectId, itemId },
  );
}

function addIssueToProject(projectId: string, issueId: string): string {
  const data = graphql<{
    addProjectV2ItemById: { item: { id: string } };
  }>(
    `mutation($projectId:ID!,$contentId:ID!){
      addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){
        item { id }
      }
    }`,
    { projectId, contentId: issueId },
  );
  return String(data.addProjectV2ItemById.item.id);
}

function closeIssueById(issueId: string) {
  graphql(
    `mutation($issueId:ID!){
      closeIssue(input:{issueId:$issueId}){
        issue { id state }
      }
    }`,
    { issueId },
  );
}

function ensureProjectAndSync(repo: RepoInfo): { project: ProjectInfo; cards: IssueCard[]; warnings: string[] } {
  let project = findExistingProject(repo);
  if (!project) project = createProject(repo);

  let details = getProjectDetails(repo, project.number);
  const activeProject = getActiveProjectNode(repo, details as { user?: { projectV2?: any } | null; organization?: { projectV2?: any } | null })?.projectV2;
  if (!activeProject) throw new Error(`Unable to load project ${PROJECT_TITLE}.`);

  const field = ensureStatusField(repo, project.number, details);
  details = getProjectDetails(repo, project.number);
  const fullProject = getActiveProjectNode(repo, details as { user?: { projectV2?: any } | null; organization?: { projectV2?: any } | null })?.projectV2;
  if (!fullProject) throw new Error(`Unable to refresh project ${PROJECT_TITLE}.`);

  const issueMap = new Map<number, IssueCard>();
  const projectCards = (fullProject.items?.nodes || [])
    .map((node: any) => buildItemCard(node, field.id))
    .filter(Boolean) as IssueCard[];
  for (const card of projectCards) issueMap.set(card.number, card);

  const openIssues = getOpenIssues(repo);
  const optionMap = new Map(field.options.map((option) => [option.name, option.id]));
  const warnings: string[] = [];

  for (const issue of openIssues) {
    if (issueMap.has(issue.number)) continue;
    const itemId = addIssueToProject(fullProject.id, issue.id);
    const defaultColumn = issue.column || "Backlog";
    const optionId = optionMap.get(defaultColumn);
    if (!optionId) {
      warnings.push(`Missing option for column ${defaultColumn}. Added issue #${issue.number} without a status value.`);
      issueMap.set(issue.number, { ...issue, itemId, column: defaultColumn });
      continue;
    }
    setItemColumn(fullProject.id, itemId, field.id, optionId);
    issueMap.set(issue.number, { ...issue, itemId, column: defaultColumn });
  }

  const orderedCards = Array.from(issueMap.values());
  const cards = COLUMN_ORDER.flatMap((column) => orderedCards.filter((card) => card.column === column));

  return {
    project: {
      id: String(fullProject.id),
      number: Number(fullProject.number),
      title: String(fullProject.title),
      url: String(fullProject.url),
      shortDescription: String(fullProject.shortDescription || ""),
      field,
    },
    cards,
    warnings,
  };
}

function buildProjectStateFromDetails(
  repo: RepoInfo,
  details: { user?: { projectV2?: any } | null; organization?: { projectV2?: any } | null },
  fallbackField?: ProjectField | null,
): { project: ProjectInfo; cards: IssueCard[] } {
  const fullProject = getActiveProjectNode(repo, details)?.projectV2;
  if (!fullProject) throw new Error(`Unable to refresh project ${PROJECT_TITLE}.`);

  const fields = Array.isArray(fullProject.fields?.nodes) ? fullProject.fields.nodes : [];
  const existing = fields.find((field: any) => String(field?.name || "").toLowerCase() === STATUS_FIELD_NAME.toLowerCase() && Array.isArray(field?.options));
  const field = existing
    ? {
        id: String(existing.id),
        name: String(existing.name),
        options: (existing.options || []).map((option: any) => ({ id: String(option.id), name: String(option.name) })),
      }
    : fallbackField || null;
  if (!field) throw new Error(`Project ${PROJECT_TITLE} is missing the ${STATUS_FIELD_NAME} field.`);

  const projectCards = (fullProject.items?.nodes || [])
    .map((node: any) => buildItemCard(node, field.id))
    .filter(Boolean) as IssueCard[];
  const cards = COLUMN_ORDER.flatMap((column) => projectCards.filter((card) => card.column === column));

  return {
    project: {
      id: String(fullProject.id),
      number: Number(fullProject.number),
      title: String(fullProject.title),
      url: String(fullProject.url),
      shortDescription: String(fullProject.shortDescription || ""),
      field,
    },
    cards,
  };
}

function columnize(cards: IssueCard[]) {
  return COLUMN_ORDER.map((column) => ({
    id: column,
    title: column,
    cards: cards.filter((card) => card.column === column).map((card, index) => ({
      ...card,
      column,
      order: index + 1,
    })),
  }));
}

function countsFromColumns(columns: Array<{ id: ColumnName; cards: IssueCard[] }>): Record<ColumnName, number> {
  return {
    Backlog: columns.find((column) => column.id === "Backlog")?.cards.length || 0,
    "In Progress": columns.find((column) => column.id === "In Progress")?.cards.length || 0,
    Review: columns.find((column) => column.id === "Review")?.cards.length || 0,
    Done: columns.find((column) => column.id === "Done")?.cards.length || 0,
  };
}

function buildSnapshot(session: SessionState, cards: IssueCard[], warnings: string[], renderInline: boolean, error?: string): BoardSnapshot {
  const columns = columnize(cards);
  const orderedCards = columns.flatMap((column) => column.cards);
  return {
    sessionId: session.sessionId,
    repo: session.repo,
    project: session.project,
    columns,
    cards: orderedCards,
    counts: countsFromColumns(columns),
    updatedAt: session.updatedAt,
    renderInline,
    projectScopeReady: session.projectScopeReady,
    warnings,
    error,
  };
}

function saveSession(session: SessionState) {
  session.updatedAt = nowIso();
  sessions.set(session.sessionId, session);
  return session;
}

function loadOrCreateSession(sessionId?: string) {
  const id = String(sessionId || "").trim() || randomUUID();
  const existing = sessions.get(id);
  if (existing) return existing;
  const created: SessionState = {
    sessionId: id,
    repo: getRepoInfo(),
    project: null,
    projectScopeReady: true,
    updatedAt: nowIso(),
  };
  sessions.set(id, created);
  return created;
}

function refreshBoard(sessionId?: string, renderInline: boolean = false): BoardSnapshot {
  const session = loadOrCreateSession(sessionId);
  const warnings: string[] = [];
  try {
    const synced = ensureProjectAndSync(session.repo);
    session.project = synced.project;
    session.projectScopeReady = true;
    saveSession(session);
    return buildSnapshot(session, synced.cards, warnings.concat(synced.warnings), renderInline);
  } catch (error: any) {
    session.projectScopeReady = false;
    saveSession(session);
    const message = summarizeBoardError(error);
    const scopeLimited = /gh auth refresh -s read:project -s project/i.test(message);
    const openIssues = (() => {
      try {
        return getOpenIssues(session.repo);
      } catch {
        return [] as IssueCard[];
      }
    })();
    if (!scopeLimited) {
      warnings.push("GitHub project access needs the `project` + `read:project` scopes for gh auth. Repo issues can still be previewed, but project sync is unavailable until scopes are refreshed.");
    }
    return buildSnapshot(session, openIssues, warnings, renderInline, message);
  }
}

function refreshProjectOnly(sessionId: string, renderInline: boolean = false): BoardSnapshot {
  const session = getSessionProject(sessionId);
  const details = getProjectDetails(session.repo, session.project!.number);
  const next = buildProjectStateFromDetails(session.repo, details as { user?: { projectV2?: any } | null; organization?: { projectV2?: any } | null }, session.project?.field || null);
  session.project = next.project;
  session.projectScopeReady = true;
  saveSession(session);
  return buildSnapshot(session, next.cards, [], renderInline);
}

function getSessionProject(sessionId: string) {
  const session = loadOrCreateSession(sessionId);
  if (!session.project) {
    const refreshed = refreshBoard(sessionId, false);
    if (!refreshed.project) throw new Error(refreshed.error || "Project is not ready yet.");
  }
  const updated = sessions.get(sessionId);
  if (!updated?.project) throw new Error("Project is not available for this session.");
  return updated;
}

function moveIssue(sessionId: string, issueNumber: number, toColumn: ColumnName, afterIssueNumber?: number | null): BoardSnapshot {
  const session = getSessionProject(sessionId);
  const project = session.project;
  if (!project) throw new Error("Project is not available.");
  const details = getProjectDetails(session.repo, project.number);
  const activeProject = getActiveProjectNode(session.repo, details as { user?: { projectV2?: any } | null; organization?: { projectV2?: any } | null })?.projectV2;
  if (!activeProject) throw new Error("Unable to reload project before move.");
  const item = (activeProject.items?.nodes || []).find((node: any) => Number(node?.content?.number) === issueNumber);
  if (!item?.id) throw new Error(`Issue #${issueNumber} is not on the project board yet.`);
  const option = (project.field.options || []).find((entry) => entry.name === toColumn);
  if (!option) throw new Error(`Column ${toColumn} is not configured on ${project.field.name}.`);
  setItemColumn(project.id, String(item.id), project.field.id, option.id);
  if (typeof afterIssueNumber === "number") {
    const afterItem = (activeProject.items?.nodes || []).find((node: any) => Number(node?.content?.number) === afterIssueNumber);
    if (!afterItem?.id) throw new Error(`Issue #${afterIssueNumber} is not on the project board yet.`);
    setItemPosition(project.id, String(item.id), String(afterItem.id));
  } else {
    setItemPosition(project.id, String(item.id), null);
  }
  return refreshProjectOnly(sessionId, false);
}

function closeIssue(sessionId: string, issueNumber: number): BoardSnapshot {
  const session = getSessionProject(sessionId);
  const details = getProjectDetails(session.repo, session.project!.number);
  const activeProject = getActiveProjectNode(session.repo, details as { user?: { projectV2?: any } | null; organization?: { projectV2?: any } | null })?.projectV2;
  const item = (activeProject?.items?.nodes || []).find((node: any) => Number(node?.content?.number) === issueNumber);
  const issueId = item?.content?.id;
  if (!issueId) throw new Error(`Unable to find issue #${issueNumber} to close.`);
  closeIssueById(String(issueId));
  return refreshProjectOnly(sessionId, false);
}

export function registerGithubProjectKanbanBoardFeatures(server: McpServer) {
  server.registerTool(
    toolName,
    {
      title: "Open GitHub Project Kanban Board",
      description: "Open an inline-first GitHub project kanban board for the current repo and sync open issues into Backlog, In Progress, Review, and Done.",
      inputSchema: z.object({
        sessionId: z.string().optional(),
        renderInline: z.boolean().optional(),
        prompt: z.string().optional(),
      }),
      securitySchemes: [{ type: "noauth" }],
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        ui: {
          resourceUri,
          inlinePreferred: true,
          toolbox: true,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": resourceUri,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Opening GitHub project board…",
        "openai/toolInvocation/invoked": "GitHub project board ready.",
      },
    },
    async ({ sessionId, renderInline }) => {
      const snapshot = refreshBoard(sessionId, Boolean(renderInline));
      return {
        content: [{ type: "text", text: `Opened GitHub Project Kanban Board for ${snapshot.repo.nameWithOwner}.` }],
        structuredContent: snapshot,
      };
    },
  );

  server.registerTool(
    "github_project_kanban_refresh",
    {
      title: "Refresh GitHub Project Kanban Board",
      description: "Reload the board state from GitHub and re-sync open repo issues into the project.",
      inputSchema: z.object({
        sessionId: z.string(),
      }),
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async ({ sessionId }) => {
      const snapshot = refreshBoard(sessionId, false);
      return {
        content: [{ type: "text", text: `Refreshed ${snapshot.project?.title || PROJECT_TITLE} for ${snapshot.repo.nameWithOwner}.` }],
        structuredContent: snapshot,
      };
    },
  );

  server.registerTool(
    "github_project_kanban_move_issue",
    {
      title: "Move GitHub Project Kanban Card",
      description: "Move a project card to another kanban column by updating the project's single-select status field.",
      inputSchema: z.object({
        sessionId: z.string(),
        issueNumber: z.number(),
        toColumn: z.enum(COLUMN_ORDER),
        afterIssueNumber: z.number().nullable().optional(),
      }),
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async ({ sessionId, issueNumber, toColumn, afterIssueNumber }) => {
      const snapshot = moveIssue(sessionId, issueNumber, toColumn, afterIssueNumber);
      return {
        content: [{ type: "text", text: `Moved #${issueNumber} to ${toColumn}${typeof afterIssueNumber === "number" ? ` after #${afterIssueNumber}` : " at the top"}.` }],
        structuredContent: snapshot,
      };
    },
  );

  server.registerTool(
    "github_project_kanban_close_issue",
    {
      title: "Close GitHub Issue From Kanban",
      description: "Close a GitHub issue after the user approves a move to Done.",
      inputSchema: z.object({
        sessionId: z.string(),
        issueNumber: z.number(),
      }),
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async ({ sessionId, issueNumber }) => {
      const snapshot = closeIssue(sessionId, issueNumber);
      return {
        content: [{ type: "text", text: `Closed issue #${issueNumber}.` }],
        structuredContent: snapshot,
      };
    },
  );

  server.registerResource(
    "github-project-kanban-board-ui",
    resourceUri,
    {
      title: "GitHub Project Kanban Board UI",
      description: "Inline-first board view with fullscreen expansion and drag-drop status updates.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [{
        uri: resourceUri,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        _meta: buildWidgetMeta("An interactive GitHub project kanban board for the current repository with drag-drop moves and refresh actions."),
      }],
    }),
  );

  return server;
}

export function createGithubProjectKanbanServer() {
  const server = new McpServer({
    name: "toolshed-github-project-kanban-board-app",
    version: "0.1.0",
  });
  registerGithubProjectKanbanBoardFeatures(server);
  return server;
}

function getStringArg(name: string): string | null {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

function isHttpMode() {
  const transportMode = String(process.env.MCP_TRANSPORT || "").trim().toLowerCase();
  return process.argv.includes("--http")
    || process.argv.includes("--streamable-http")
    || transportMode === "http"
    || transportMode === "streamable-http";
}

function getHttpHost() {
  return String(process.env.MCP_HOST || getStringArg("host") || "127.0.0.1").trim() || "127.0.0.1";
}

function getHttpPort() {
  const value = String(process.env.MCP_PORT || process.env.PORT || getStringArg("port") || "3000").trim();
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

function getHeaderValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}

async function readJsonBody(req: IncomingMessage) {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function writeJsonRpcError(res: ServerResponse, statusCode: number, message: string) {
  writeJson(res, statusCode, {
    jsonrpc: "2.0",
    error: {
      code: statusCode === 400 ? -32000 : -32603,
      message,
    },
    id: null,
  });
}

function writeText(res: ServerResponse, statusCode: number, content: string) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(content);
}

type ActiveTransport =
  | { kind: "streamable"; server: McpServer; transport: StreamableHTTPServerTransport }
  | { kind: "sse"; server: McpServer; transport: SSEServerTransport };

const activeTransports = new Map<string, ActiveTransport>();

async function closeActiveTransports() {
  const entries = [...activeTransports.entries()];
  activeTransports.clear();
  for (const [, entry] of entries) {
    try {
      await entry.transport.close();
    } catch {}
  }
}

function registerActiveTransport(sessionId: string, entry: ActiveTransport) {
  activeTransports.set(sessionId, entry);
}

async function createStreamableTransport() {
  const server = createGithubProjectKanbanServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      registerActiveTransport(sessionId, { kind: "streamable", server, transport });
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) activeTransports.delete(transport.sessionId);
  };
  await server.connect(transport);
  return transport;
}

async function handleStreamableRequest(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const sessionId = getHeaderValue(req, "mcp-session-id");
  const existing = sessionId ? activeTransports.get(sessionId) : null;
  if (existing) {
    if (existing.kind !== "streamable") {
      writeJsonRpcError(res, 400, "Bad Request: Session exists but uses a different transport protocol.");
      return;
    }
    await existing.transport.handleRequest(req, res, body);
    return;
  }
  if (req.method !== "POST" || !body || !isInitializeRequest(body)) {
    writeJsonRpcError(res, 400, "Bad Request: No valid session ID provided.");
    return;
  }
  const transport = await createStreamableTransport();
  await transport.handleRequest(req, res, body);
}

async function handleLegacySseStart(req: IncomingMessage, res: ServerResponse) {
  const server = createGithubProjectKanbanServer();
  const transport = new SSEServerTransport("/messages", res);
  registerActiveTransport(transport.sessionId, { kind: "sse", server, transport });
  res.on("close", () => {
    activeTransports.delete(transport.sessionId);
  });
  await server.connect(transport);
}

async function handleLegacySseMessage(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const requestUrl = new URL(req.url || "/", `http://${getHeaderValue(req, "host") || "localhost"}`);
  const sessionId = String(requestUrl.searchParams.get("sessionId") || "").trim();
  const existing = sessionId ? activeTransports.get(sessionId) : null;
  if (!existing || existing.kind !== "sse") {
    writeJsonRpcError(res, 400, "Bad Request: No SSE session found for that session ID.");
    return;
  }
  await existing.transport.handlePostMessage(req, res, body);
}

async function runHttpServer() {
  const host = getHttpHost();
  const port = getHttpPort();
  const httpServer = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", `http://${getHeaderValue(req, "host") || "localhost"}`);
      const body = await readJsonBody(req);
      if (requestUrl.pathname === "/mcp" && ["GET", "POST", "DELETE"].includes(req.method || "")) {
        await handleStreamableRequest(req, res, body);
        return;
      }
      if (requestUrl.pathname === "/sse" && req.method === "GET") {
        await handleLegacySseStart(req, res);
        return;
      }
      if (requestUrl.pathname === "/messages" && req.method === "POST") {
        await handleLegacySseMessage(req, res, body);
        return;
      }
      if (requestUrl.pathname === "/" && req.method === "GET") {
        writeJson(res, 200, {
          name: "toolshed-github-project-kanban-board-app",
          streamableHttpUrl: "/mcp",
          legacySseUrl: "/sse",
        });
        return;
      }
      writeText(res, 404, "Not found.");
    } catch (error) {
      console.error(error);
      writeJsonRpcError(res, 500, "Internal server error.");
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  console.log(`GitHub board MCP server listening on http://${host}:${port}/mcp`);
  console.log(`Legacy SSE compatibility is available at http://${host}:${port}/sse`);

  const shutdown = async () => {
    await closeActiveTransports();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

async function runStdioServer() {
  const server = createGithubProjectKanbanServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main() {
  if (isHttpMode()) {
    await runHttpServer();
    return;
  }
  await runStdioServer();
}

const isMainModule = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
