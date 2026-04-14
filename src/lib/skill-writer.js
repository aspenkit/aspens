import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { findSkillFiles, parseKeywords } from './skill-reader.js';

/**
 * Write parsed skill files to the target repo.
 * Takes an array of { path, content } objects.
 */
export function writeSkillFiles(repoPath, files, options = {}) {
  const { dryRun = false, force = false } = options;
  const results = [];

  for (const file of files) {
    const fullPath = join(repoPath, file.path);
    const exists = existsSync(fullPath);

    if (dryRun) {
      const action = exists && !force ? 'would-skip' : exists ? 'would-overwrite' : 'would-create';
      results.push({ path: file.path, status: action, content: file.content });
      continue;
    }

    if (exists && !force) {
      results.push({ path: file.path, status: 'skipped', reason: 'already exists (use --force to overwrite)' });
      continue;
    }

    // Create directories
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf8');
    results.push({ path: file.path, status: exists ? 'overwritten' : 'created' });
  }

  return results;
}

/**
 * Write directory-scoped transformed files (e.g., AGENTS.md in source dirs).
 * Validates path safety before writing — rejects absolute paths, traversal, and unexpected filenames.
 * Warns and skips files that would overwrite existing hand-written files.
 *
 * @param {string} repoPath
 * @param {Array<{path: string, content: string}>} files
 * @param {object} [options]
 * @param {boolean} [options.force=false]
 * @returns {Array<{path: string, status: string}>}
 */
export function writeTransformedFiles(repoPath, files, options = {}) {
  const { force = false } = options;
  const results = [];
  const allowedExact = new Set(['CLAUDE.md', 'AGENTS.md']);
  const allowedPrefixes = ['.claude/', '.agents/', '.codex/'];

  for (const file of files) {
    // Safety: block absolute paths and traversal
    if (file.path.startsWith('/') || /^[a-zA-Z]:/.test(file.path) || file.path.includes('..')) {
      results.push({ path: file.path, status: 'skipped', reason: 'unsafe path' });
      continue;
    }
    if (!allowedExact.has(file.path) && !allowedPrefixes.some(prefix => file.path.startsWith(prefix))) {
      results.push({ path: file.path, status: 'skipped', reason: 'unsafe path' });
      continue;
    }

    const fullPath = join(repoPath, file.path);
    const exists = existsSync(fullPath);

    if (exists && !force) {
      results.push({ path: file.path, status: 'skipped', reason: 'already exists (warn and skip)' });
      continue;
    }

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf8');
    results.push({ path: file.path, status: exists ? 'overwritten' : 'created' });
  }

  return results;
}

/**
 * Generate skill-rules.json (v2.0) from existing skill files.
 * Uses skill-reader.js to parse skills.
 * Returns the rules object ready to write.
 */
export function extractRulesFromSkills(skillsDir) {
  const skillFiles = findSkillFiles(skillsDir);
  const skills = {};

  for (const skill of skillFiles) {
    const name = skill.frontmatter?.name || skill.name;
    const description = skill.frontmatter?.description || '';
    const patterns = skill.activationPatterns;
    const explicitKeywords = parseKeywords(skill.content);
    const isBase = name === 'base';

    const allKeywords = dedupeStrings(explicitKeywords);

    // Generate intent patterns from keyword pairs
    const intentPatterns = generateIntentPatterns(allKeywords, name);

    if (isBase) {
      skills[name] = {
        type: 'base',
        enforcement: 'suggest',
        priority: 'critical',
        scope: 'all',
        alwaysActivate: true,
        filePatterns: patterns,
        promptTriggers: {
          keywords: allKeywords,
          intentPatterns,
        },
      };
    } else {
      skills[name] = {
        type: 'domain',
        enforcement: 'suggest',
        priority: 'medium',
        scope: 'all',
        alwaysActivate: false,
        filePatterns: patterns,
        promptTriggers: {
          keywords: allKeywords,
          intentPatterns,
        },
      };
    }
  }

  return {
    version: '2.0',
    skills,
  };
}

/**
 * Generate bash code for detect_skill_domain() function.
 * Takes a rules object (from extractRulesFromSkills) and generates
 * hardcoded bash if/elif patterns from filePatterns.
 */
export function generateDomainPatterns(rules) {
  if (!rules || !rules.skills) {
    return generateEmptyDetectFunction();
  }

  const clauses = [];

  for (const [skillName, config] of Object.entries(rules.skills)) {
    // Skip base skill -- it's always active, no pattern matching needed
    if (config.type === 'base' || config.alwaysActivate) continue;

    const patterns = config.filePatterns || [];
    if (patterns.length === 0) continue;

    const bashPatterns = patterns
      .map(p => globToBashPattern(p))
      .filter(Boolean);

    if (bashPatterns.length === 0) continue;

    // Deduplicate and validate patterns per skill
    const SAFE_BASH_PATTERN = /^[A-Za-z0-9/_.\-]+$/;
    const uniquePatterns = [...new Set(bashPatterns)].filter(p => {
      if (!SAFE_BASH_PATTERN.test(p)) {
        console.warn(`[skill-writer] Skipping unsafe bash pattern "${p}" for skill "${skillName}"`);
        return false;
      }
      return true;
    });

    if (uniquePatterns.length === 0) continue;

    const conditions = uniquePatterns
      .map(p => `[[ "$file" =~ ${p} ]]`)
      .join(' || ');

    clauses.push({ skillName, conditions });
  }

  if (clauses.length === 0) {
    return generateEmptyDetectFunction();
  }

  // NOTE: if/elif = first-match-wins. If a file matches multiple skills,
  // only the first skill in insertion order is detected. This matches
  // the tutorkit orchestrator's behavior.
  let body = '';
  clauses.forEach((clause, i) => {
    const keyword = i === 0 ? 'if' : 'elif';
    body += `    ${keyword} ${clause.conditions}; then\n`;
    body += `        detected_skills="${clause.skillName}"\n`;
  });
  body += '    fi';

  return `# BEGIN detect_skill_domain
detect_skill_domain() {
    local file="$1"
    local detected_skills=""

    # Generated by aspens from skill-rules.json filePatterns
${body}

    echo "$detected_skills"
}
# END detect_skill_domain`;
}

/**
 * Merge aspens hook config into existing settings.json.
 *
 * 1. If no existing settings -> return template as-is
 * 2. If existing has no hooks -> add hooks from template
 * 3. If existing has hooks -> merge per event type:
 *    - Detect existing aspens hooks by command path substring
 *      (skill-activation-prompt or post-tool-use-tracker)
 *    - Replace if found, append if not
 *    - Preserve non-aspens hooks
 * 4. Preserve all non-hooks keys
 */
export function mergeSettings(existing, template) {
  if (!existing) return template;

  // Clone to avoid mutations
  const merged = JSON.parse(JSON.stringify(existing));

  if (template?.statusLine) {
    if (!merged.statusLine || isAspensHook(merged.statusLine.command || '')) {
      merged.statusLine = template.statusLine;
    }
  }

  if (!template || !template.hooks) return merged;

  // If existing has no hooks, add them wholesale
  if (!merged.hooks) {
    merged.hooks = template.hooks;
    return merged;
  }

  // Merge per event type
  for (const [eventType, templateEntries] of Object.entries(template.hooks)) {
    if (!Array.isArray(templateEntries)) continue;

    if (!merged.hooks[eventType] || !Array.isArray(merged.hooks[eventType])) {
      // Event type doesn't exist or is malformed -- replace with template
      merged.hooks[eventType] = templateEntries;
      continue;
    }

    // Merge entries for this event type
    for (const templateEntry of templateEntries) {
      const templateCommands = extractHookCommands(templateEntry);
      const aspensCommands = templateCommands.filter(cmd => isAspensHook(cmd));

      if (aspensCommands.length === 0) {
        // Not an aspens hook — check for duplicates before appending
        const isDuplicate = merged.hooks[eventType].some(e =>
          stableStringify(e) === stableStringify(templateEntry)
        );
        if (!isDuplicate) {
          merged.hooks[eventType].push(templateEntry);
        }
        continue;
      }

      // Find existing entry that has an aspens hook matching this one
      let replaced = false;
      for (let i = 0; i < merged.hooks[eventType].length; i++) {
        const existingEntry = merged.hooks[eventType][i];
        const existingCommands = extractHookCommands(existingEntry);

        const hasMatchingAspens = existingCommands.some(cmd =>
          aspensCommands.some(ac => hookCommandsMatch(cmd, ac))
        );

        if (hasMatchingAspens) {
          // Replace the existing entry with the template entry,
          // but preserve any non-aspens hooks from the existing entry
          const nonAspensHooks = (existingEntry.hooks || []).filter(
            h => !isAspensHook(h.command || '')
          );
          const aspensHooks = (templateEntry.hooks || []).filter(
            h => isAspensHook(h.command || '')
          );

          const mergedEntry = { ...templateEntry };
          mergedEntry.hooks = [...aspensHooks, ...nonAspensHooks];

          // Preserve matcher from template if present, existing otherwise
          if (templateEntry.matcher) {
            mergedEntry.matcher = templateEntry.matcher;
          } else if (existingEntry.matcher) {
            mergedEntry.matcher = existingEntry.matcher;
          }

          merged.hooks[eventType][i] = mergedEntry;
          replaced = true;
          break;
        }
      }

      if (!replaced) {
        // No matching aspens hook found, append
        merged.hooks[eventType].push(templateEntry);
      }
    }

    // Remove duplicate aspens-managed entries while preserving non-aspens hooks.
    merged.hooks[eventType] = dedupeAspensHookEntries(merged.hooks[eventType]);
  }

  return merged;
}

// --- Internal helpers ---

const ASPENS_HOOK_MARKERS = [
  'skill-activation-prompt',
  'graph-context-prompt',
  'post-tool-use-tracker',
  'save-tokens-statusline',
  'save-tokens-prompt-guard',
  'save-tokens-precompact',
];

/**
 * Check if a command string is an aspens-managed hook.
 */
function isAspensHook(command) {
  if (!command || typeof command !== 'string') return false;
  return ASPENS_HOOK_MARKERS.some(marker => command.includes(marker));
}

/**
 * Check if two hook commands refer to the same aspens hook.
 */
function hookCommandsMatch(cmd1, cmd2) {
  if (!cmd1 || !cmd2) return false;
  return ASPENS_HOOK_MARKERS.some(marker => cmd1.includes(marker) && cmd2.includes(marker));
}

/**
 * Extract command strings from a hook entry.
 */
function extractHookCommands(entry) {
  if (!entry || !entry.hooks || !Array.isArray(entry.hooks)) return [];
  return entry.hooks
    .map(h => h.command || '')
    .filter(Boolean);
}

function dedupeAspensHookEntries(entries) {
  if (!Array.isArray(entries)) return entries;

  const seen = new Set();
  const result = [];

  for (const entry of entries) {
    const commands = extractHookCommands(entry);
    const aspensMarkers = ASPENS_HOOK_MARKERS.filter(marker =>
      commands.some(command => command.includes(marker))
    );

    if (aspensMarkers.length === 0) {
      result.push(entry);
      continue;
    }

    const key = `${aspensMarkers.sort().join('|')}::${entry.matcher || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }

  return result;
}

/**
 * Generate intent patterns from keywords.
 * Produces regex patterns matching common action + keyword combinations.
 */
function generateIntentPatterns(keywords, skillName) {
  if (!keywords || keywords.length === 0) return [];

  const patterns = [];
  const actionVerbs = '(create|update|fix|add|modify|change|debug|refactor|implement|build)';

  // For multi-word keywords, create direct patterns
  const multiWord = keywords.filter(k => k.includes(' '));
  for (const kw of multiWord) {
    const escaped = escapeRegex(kw);
    patterns.push(`${actionVerbs}.*${escaped}`);
    patterns.push(`${escaped}.*${actionVerbs}`);
  }

  // For the skill name itself (if multi-word when split on -)
  if (skillName && skillName.includes('-') && skillName !== 'base') {
    const parts = skillName.split('-');
    const namePattern = parts.join('.*');
    patterns.push(`${actionVerbs}.*${namePattern}`);
  }

  // Dedupe and limit
  return dedupeStrings(patterns).slice(0, 6);
}

/**
 * Convert a glob file pattern to a bash regex pattern.
 * Extracts the most distinctive directory or filename part.
 */
function globToBashPattern(glob) {
  if (!glob || typeof glob !== 'string') return null;

  // Remove leading **/ or */ patterns
  let cleaned = glob.replace(/^\*\*\//, '').replace(/^\*\//, '');

  // Handle dir/**/*.ext patterns (e.g., tests/**/*.test.js → /tests/)
  // Strip the /**/*.ext suffix first, then fall through to directory extraction
  cleaned = cleaned.replace(/\/\*\*\/\*\.[a-z.]+$/, '');

  // Remove trailing /** or /* patterns
  cleaned = cleaned.replace(/\/\*\*\/?\*?$/, '').replace(/\/\*$/, '');

  // If it's a specific file (has extension, no wildcards), use the filename
  if (cleaned.includes('.') && !cleaned.includes('*')) {
    const name = basename(cleaned)
      .replace(/\.[a-z]{1,4}$/, '');  // Strip last extension only
    if (name.length > 2) {
      return `/${name}`;
    }
    return null;
  }

  // For directory patterns, extract the most distinctive directory
  const parts = cleaned.split('/').filter(p =>
    p.length > 2 && !p.includes('*') && !GENERIC_DIRS.has(p)
  );

  if (parts.length > 0) {
    return `/${parts[parts.length - 1]}/`;
  }

  return null;
}

function generateEmptyDetectFunction() {
  return `# BEGIN detect_skill_domain
detect_skill_domain() {
    local file="$1"
    local detected_skills=""

    # No domain patterns generated -- add skills with filePatterns first
    echo "$detected_skills"
}
# END detect_skill_domain`;
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupeStrings(arr) {
  const seen = new Set();
  const result = [];
  for (const s of arr) {
    const cleaned = s.trim().replace(/[,.:;!?]+$/, '');
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }
  return result;
}

// Path segments too generic for keyword derivation or bash patterns
const GENERIC_DIRS = new Set([
  'src', 'app', 'lib', 'api', 'v1', 'v2',
  'utils', 'helpers', 'common', 'core', 'config',
  'types', 'public', 'assets', 'styles', 'scripts',
]);

