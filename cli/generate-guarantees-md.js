#!/usr/bin/env node
/**
 * Generates reports/guarantees.md deterministically from:
 *   - reports/guarantees.json (claim-to-spec mapping)
 *   - lemmafit/.vibe/claimcheck.json (claimcheck results, optional)
 *   - SPEC.yaml (for trusted entries and group info)
 *
 * Usage: node cli/generate-guarantees-md.js [projectDir]
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function run(projectDir) {
  const absDir = path.resolve(projectDir || '.');
  const vibePath = path.join(absDir, 'lemmafit', '.vibe');

  // --- Load guarantees.json ---
  const guaranteesPath = path.join(vibePath, 'guarantees.json');
  if (!fs.existsSync(guaranteesPath)) {
    console.error('Error: guarantees.json not found. Run /guarantees first.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(guaranteesPath, 'utf8'));

  // --- Load claimcheck results (optional) ---
  let claimcheckResults = [];
  const claimcheckPath = path.join(vibePath, 'claimcheck.json');
  if (fs.existsSync(claimcheckPath)) {
    try {
      const raw = fs.readFileSync(claimcheckPath, 'utf8').trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        // Handle both array and object formats
        if (Array.isArray(parsed)) {
          claimcheckResults = parsed;
        } else if (parsed && typeof parsed === 'object') {
          claimcheckResults = parsed.results || parsed.claims || [parsed];
        }
      }
    } catch {}
  }

  // --- Load SPEC.yaml for trusted entries and groups ---
  const specPath = path.join(absDir, 'SPEC.yaml');
  let specEntries = [];
  if (fs.existsSync(specPath)) {
    try {
      const parsed = yaml.load(fs.readFileSync(specPath, 'utf8'));
      specEntries = (parsed && parsed.entries) || [];
    } catch (e) {
      console.error(`Warning: Failed to parse SPEC.yaml: ${e.reason || e.message}`);
      console.error('Hint: property values with special characters (::, ==>, !in) must be quoted in YAML.');
      console.error('Continuing without SPEC.yaml data (trusted entries and groups will be missing).');
    }
  }

  const trustedEntries = specEntries.filter(e => !e.verifiable || e.status === 'trusted');
  const verifiableEntries = specEntries.filter(e => e.verifiable);

  // --- Build spec lookup ---
  const specById = {};
  for (const e of specEntries) specById[e.id] = e;

  // --- Compute coverage ---
  const guarantees = data.guarantees || [];
  const gaps = data.gaps || [];
  const coveredIds = new Set(guarantees.map(g => g.specId));
  const verifiedCount = coveredIds.size;
  const verifiableTotal = verifiableEntries.length;

  // --- Collect axioms from guarantees ---
  const axioms = [];
  for (const g of guarantees) {
    for (const c of (g.coveredBy || [])) {
      if (c.type === 'axiom') axioms.push(c);
    }
  }

  // --- Build claimcheck lookup ---
  const claimcheckByLemma = {};
  for (const r of claimcheckResults) {
    claimcheckByLemma[r.lemmaName] = r;
  }

  // --- Group guarantees by SPEC.yaml group ---
  const groups = {};
  for (const g of guarantees) {
    const spec = specById[g.specId];
    const groupName = (spec && spec.group) || 'Other';
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push({ ...g, spec });
  }

  // Sort groups by first spec ID in each group
  const sortedGroupNames = Object.keys(groups).sort((a, b) => {
    const aFirst = groups[a][0].specId || '';
    const bFirst = groups[b][0].specId || '';
    return aFirst.localeCompare(bFirst);
  });

  // Sort entries within each group by spec ID
  for (const name of sortedGroupNames) {
    groups[name].sort((a, b) => (a.specId || '').localeCompare(b.specId || ''));
  }

  // --- Build claimcheck table rows (only entries with lemma mappings) ---
  const claimcheckRows = [];
  for (const g of guarantees) {
    for (const c of (g.coveredBy || [])) {
      if (!c.lemmaName) continue;
      const result = claimcheckByLemma[c.lemmaName];
      const status = result ? (result.status || result.result || 'Unknown') : 'Not checked';
      if (!claimcheckRows.find(r => r.lemmaName === c.lemmaName)) {
        claimcheckRows.push({
          requirement: g.requirement,
          lemmaName: c.lemmaName,
          status: capitalize(status)
        });
      }
    }
  }

  // --- Generate markdown ---
  const lines = [];
  const date = new Date().toISOString().split('T')[0];

  lines.push('# Guarantees Report');
  lines.push('');
  lines.push(`Generated: ${date}`);
  lines.push('');

  // Coverage
  lines.push('## Coverage');
  lines.push('');
  lines.push(`- **${verifiedCount}/${verifiableTotal}** verifiable spec entries covered`);
  lines.push(`- **${gaps.length} gaps**`);
  lines.push(`- **${axioms.length} axioms** (${axioms.length === 0 ? 'zero trust surface' : 'trust surface below'})`);
  lines.push(`- **${trustedEntries.length} trusted entries** (presentation/runtime, not verifiable in Dafny)`);
  lines.push('');

  // Claimcheck results table
  if (claimcheckRows.length > 0) {
    lines.push('## Claimcheck Results');
    lines.push('');
    lines.push('| Requirement | Lemma | Status |');
    lines.push('|------------|-------|--------|');
    for (const row of claimcheckRows) {
      lines.push(`| ${row.requirement} | \`${row.lemmaName}\` | ${row.status} |`);
    }
    lines.push('');
  }

  // Proven guarantees grouped
  lines.push('## Proven Guarantees');
  lines.push('');
  for (const groupName of sortedGroupNames) {
    const items = groups[groupName];
    const firstId = items[0].specId;
    const lastId = items[items.length - 1].specId;
    const range = firstId === lastId ? firstId : `${firstId} to ${lastId}`;
    lines.push(`### ${groupName} (${range})`);

    for (const item of items) {
      const lemmaNames = (item.coveredBy || [])
        .filter(c => c.lemmaName)
        .map(c => c.lemmaName);
      const suffix = lemmaNames.length > 0 ? ` — \`${lemmaNames.join('`, `')}\`` : '';
      lines.push(`- ${item.requirement}${suffix}`);
    }
    lines.push('');
  }

  // Gaps
  if (gaps.length > 0) {
    lines.push('## Gaps');
    lines.push('');
    for (const gap of gaps) {
      lines.push(`- **${gap.specId}**: ${gap.requirement} — ${gap.reason}`);
    }
    lines.push('');
  }

  // Trust surface
  lines.push('## Trust Surface');
  lines.push('');
  if (axioms.length === 0) {
    lines.push('**Axioms: 0** — All properties are fully proven.');
  } else {
    lines.push(`**Axioms: ${axioms.length}**`);
    lines.push('');
    for (const a of axioms) {
      lines.push(`- \`${a.file || ''}:${a.line || ''}\`: ${a.content || a.expression || ''}`);
    }
  }
  lines.push('');
  if (trustedEntries.length > 0) {
    lines.push('**Trusted entries** (not verifiable in Dafny):');
    for (const e of trustedEntries) {
      lines.push(`- ${e.id}: ${e.title}`);
    }
    lines.push('');
  }

  // --- Write output ---
  const output = lines.join('\n');
  const reportsDir = path.join(absDir, 'lemmafit', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, 'guarantees.md');
  fs.writeFileSync(outPath, output);
  console.log(`Wrote ${outPath}`);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = { run };

if (require.main === module) {
  run(process.argv[2]);
}
