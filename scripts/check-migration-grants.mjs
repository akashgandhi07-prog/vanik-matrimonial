#!/usr/bin/env node
/**
 * Every migration that creates a table in `public` must GRANT access to it in the
 * same file.
 *
 * From 30 Oct 2026 Supabase stops auto-granting Data API access to new public tables.
 * A table created without grants is unreachable through supabase-js/PostgREST, and
 * that includes service_role, so server code and crons fail with "permission denied"
 * too. Existing tables keep the grants they already have, so only NEW migrations are
 * checked; files that already existed are listed in migration-grants-baseline.json.
 *
 * The minimum is `grant ... on public.<table> to service_role`. Add `authenticated`
 * only where the browser reads/writes the table under RLS, and `anon` only for a
 * public page that needs it (a bare anon grant is how the _backup_* tables leaked).
 *
 * Run:  node scripts/check-migration-grants.mjs
 *       node scripts/check-migration-grants.mjs --write-baseline   (one-off, at setup)
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const BASELINE = path.join(HERE, "migration-grants-baseline.json");

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const IDENT = String.raw`(?:"[^"]+"|[a-zA-Z_][\w$]*)`;

/** Names of tables this SQL creates in public (unqualified counts as public). */
export function createdPublicTables(sql) {
  const re = new RegExp(
    String.raw`\bcreate\s+(?:(?:global|local)\s+)?(temp|temporary|unlogged\s+)?\s*table\s+(?:if\s+not\s+exists\s+)?(?:(${IDENT})\s*\.\s*)?(${IDENT})`,
    "gi",
  );
  const out = new Set();
  for (const m of stripComments(sql).matchAll(re)) {
    if (m[1] && /^temp/i.test(m[1].trim())) continue;
    const schema = (m[2] ?? "public").replace(/"/g, "").toLowerCase();
    if (schema !== "public") continue;
    out.add(m[3].replace(/"/g, "").toLowerCase());
  }
  return [...out];
}

/** Does this SQL grant service_role access to public.<table>? */
export function grantsServiceRole(sql, table) {
  const clean = stripComments(sql).toLowerCase();
  const grants = clean.match(/\bgrant\b[^;]*;/g) ?? [];
  return grants.some((g) => {
    if (!/\bto\b[^;]*\bservice_role\b/.test(g)) return false;
    if (/\bon\s+all\s+tables\s+in\s+schema\s+public\b/.test(g)) return true;
    const on = g.match(/\bon\s+(?:table\s+)?([\s\S]*?)\bto\b/);
    if (!on) return false;
    return on[1]
      .split(",")
      .map((t) => t.trim().replace(/"/g, "").replace(/^public\./, ""))
      .includes(table);
  });
}

/** Files and the public tables in them that have no service_role grant. */
export function findUngranted(dir = MIGRATIONS) {
  const problems = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    const missing = createdPublicTables(sql).filter((t) => !grantsServiceRole(sql, t));
    if (missing.length) problems.push({ file, missing });
  }
  return problems;
}

export function loadBaseline() {
  return existsSync(BASELINE) ? new Set(JSON.parse(readFileSync(BASELINE, "utf8"))) : new Set();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = findUngranted();
  if (process.argv.includes("--write-baseline")) {
    writeFileSync(BASELINE, JSON.stringify(problems.map((p) => p.file), null, 2) + "\n");
    console.log(`Baseline written: ${problems.length} existing file(s) grandfathered.`);
    process.exit(0);
  }
  const baseline = loadBaseline();
  const fresh = problems.filter((p) => !baseline.has(p.file));
  if (fresh.length === 0) {
    console.log("ok  - every new public table has a service_role grant in its migration");
    process.exit(0);
  }
  for (const p of fresh) {
    console.error(`FAIL- ${p.file}: no service_role grant for ${p.missing.join(", ")}`);
  }
  console.error(
    "\nAdd to the same migration, e.g.:\n" +
      "  grant select, insert, update, delete on public.<table> to service_role;\n" +
      "  -- plus authenticated / anon only if the browser really needs it",
  );
  process.exit(1);
}
