import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAttention, describeUnchecked, isDown, isFailedRun } from "./attention.ts";

const everythingChecked = {
  projects: [],
  projectsFailed: false,
  github: { connected: true, data: { partial: false, ciNeedsPermission: false } },
  githubFailed: false,
  isAdmin: true,
  watchServers: true,
  servers: [{ reportedAt: "2026-11-06T00:00:00Z" }],
  serversFailed: false,
};

test("nothing is unknown once everything has been checked", () => {
  assert.equal(describeUnchecked(everythingChecked), "");
});

test("each thing that couldn't be checked is named", () => {
  const cases = [
    [{ projectsFailed: true }, "your projects"],
    [{ githubFailed: true }, "GitHub"],
    [{ github: { connected: false, data: { partial: false, ciNeedsPermission: false } } }, "review requests"],
    [{ github: { connected: true, data: { partial: true, ciNeedsPermission: false } } }, "part of GitHub"],
    [{ github: { connected: true, data: { partial: false, ciNeedsPermission: true } } }, "CI on your repositories"],
    [{ projects: [{ ciUnreadable: true }, { ciUnreadable: true }, { ciUnreadable: false }] }, "CI on 2 projects"],
    [{ serversFailed: true }, "your servers"],
    [{ servers: [] }, "server health"],
    [{ servers: [{ reportedAt: null }, { reportedAt: "2026-11-06T00:00:00Z" }] }, "1 server that hasn't reported yet"],
  ];
  for (const [change, expected] of cases) assert.equal(describeUnchecked({ ...everythingChecked, ...change }), expected);
});

test("several unknowns read as a list", () => {
  assert.equal(describeUnchecked({ ...everythingChecked, projectsFailed: true, githubFailed: true, serversFailed: true }), "your projects, GitHub and your servers");
});

test("servers only count for an admin who shows them", () => {
  assert.equal(describeUnchecked({ ...everythingChecked, isAdmin: false, servers: null, serversFailed: true }), "");
  assert.equal(describeUnchecked({ ...everythingChecked, watchServers: false, servers: [] }), "");
});

test("a repository with no runs isn't unknown", () => {
  assert.equal(describeUnchecked({ ...everythingChecked, projects: [{ repo: "a/b", ci: null, ciUnreadable: false }] }), "");
});

test("only a confirmed failure counts as down", () => {
  assert.equal(isDown({ up: true }), false);
  assert.equal(isDown({ up: false, unconfirmed: true }), false);
  assert.equal(isDown({ up: false }), true);
});

test("every kind of failed run counts, but a cancelled one doesn't", () => {
  for (const conclusion of ["failure", "timed_out", "startup_failure"]) assert.equal(isFailedRun({ conclusion }), true);
  for (const conclusion of ["success", "cancelled", "skipped", ""]) assert.equal(isFailedRun({ conclusion }), false);
  assert.equal(isFailedRun(null), false);
});

test("the attention list leaves out blips and names a timeout", () => {
  const project = (monitor, ci) => ({ id: "a", name: "Site", url: "https://example.com/", monitor, ci, certificateExpires: null, domainExpires: null });
  assert.deepEqual(buildAttention([project({ up: false, unconfirmed: true }, null)], null, null, 0), []);
  const [down] = buildAttention([project({ up: false }, null)], null, null, 0);
  assert.equal(down.title, "Site is down");
  const [late] = buildAttention([project({ up: true }, { id: 1, repo: "a/b", workflow: "Deploy", branch: "main", conclusion: "timed_out" })], null, null, 0);
  assert.equal(late.title, "Site: Deploy timed out on main");
  assert.deepEqual(late.rerun, { repo: "a/b", runId: 1 });
});
