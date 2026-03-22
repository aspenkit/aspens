#!/usr/bin/env node
/**
 * Skill Activation Prompt Hook — Matching Engine
 *
 * Standalone ESM module. Copied into target repo's .claude/hooks/ directory.
 * No imports from aspens — uses only Node.js builtins.
 *
 * Called by skill-activation-prompt.sh on every UserPromptSubmit.
 * Reads stdin JSON, matches prompt against skill-rules.json,
 * injects high-priority skill content into Claude's context (stdout),
 * lists medium/low skills as available.
 *
 * Exports functions for testability (vitest can import them).
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, basename, resolve, relative } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Exported functions (for testability)
// ---------------------------------------------------------------------------

/**
 * Read the skill.md content for a given skill name.
 * Skill names like "auth" → .claude/skills/auth/skill.md
 * Skill names like "backend/base" → .claude/skills/backend/base/skill.md
 *
 * @param {string} projectDir - Absolute path to the project root
 * @param {string} skillName - Skill identifier (e.g. "auth", "backend/base")
 * @returns {string|null} Skill markdown content, or null if not found
 */
export function readSkillContent(projectDir, skillName) {
  // Guard against path traversal
  if (!skillName || skillName.includes('..') || skillName.startsWith('/') || skillName.includes('\\')) {
    return null;
  }

  const skillsRoot = resolve(projectDir, '.claude', 'skills');
  const possiblePaths = [
    resolve(skillsRoot, skillName, 'skill.md'),
    resolve(skillsRoot, `${skillName}.md`),
  ];

  for (const candidate of possiblePaths) {
    // Verify resolved path stays within skills directory
    const rel = relative(skillsRoot, candidate);
    if (rel.startsWith('..') || resolve(rel) === rel) continue;
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, 'utf-8');
      } catch {
        // Continue to next path
      }
    }
  }

  return null;
}

/**
 * Detect which repository we're currently in.
 * Checks .claude/repo-config.json first, falls back to directory basename.
 *
 * @param {string} projectDir - Absolute path to the project root
 * @returns {string} Repository name
 */
export function detectCurrentRepo(projectDir) {
  // Try repo-config.json first (hub sets this per repo)
  const configPath = join(projectDir, '.claude', 'repo-config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.repoName && typeof config.repoName === 'string' && config.repoName.trim()) {
        return config.repoName.trim();
      }
    } catch {
      // Fall through to directory-based detection
    }
  }

  // Fallback: detect from directory name
  return basename(projectDir);
}

/**
 * Get session-sticky skills from the session state file in /tmp/.
 * Skills activated via file edits stay active for the session.
 *
 * @param {string} projectDir - Absolute path to the project root
 * @returns {string[]} Array of active skill names
 */
export function getSessionActiveSkills(projectDir, currentRepo) {
  try {
    const hash = createHash('md5').update(projectDir).digest('hex');
    const sessionFile = join(tmpdir(), `claude-skills-${hash}.json`);

    if (existsSync(sessionFile)) {
      const content = readFileSync(sessionFile, 'utf-8');
      const session = JSON.parse(content);
      // Only return skills if session repo matches current repo
      if (currentRepo && session.repo && session.repo !== currentRepo) {
        return [];
      }
      return session.active_skills || [];
    }
  } catch {
    // Session file doesn't exist or is invalid — that's fine
  }
  return [];
}

/**
 * Check if a skill's scope matches the current repository.
 *
 * @param {{ scope?: string }} config - Skill rule config
 * @param {string} currentRepo - Current repository name
 * @returns {boolean}
 */
function skillMatchesScope(config, currentRepo) {
  const scope = config.scope || 'all';

  if (scope === 'all') {
    return true;
  }

  if (scope === currentRepo) {
    return true;
  }

  return false;
}

/**
 * Match a user prompt against skill rules.
 * Returns an array of matched skills with their match type.
 *
 * @param {string} prompt - The user's prompt text
 * @param {{ version: string, skills: Object }} rules - Parsed skill-rules.json
 * @param {string} currentRepo - Current repository name
 * @param {string[]} sessionSkills - Session-sticky skill names
 * @returns {Array<{ name: string, matchType: string, config: Object }>}
 */
export function matchSkills(prompt, rules, currentRepo, sessionSkills) {
  const promptLower = prompt.toLowerCase();
  const matched = [];
  const addedSkills = new Set();

  // SESSION-STICKY: add skills from session state first
  for (const skillName of sessionSkills) {
    const config = rules.skills[skillName];
    if (config && !addedSkills.has(skillName)) {
      matched.push({ name: skillName, matchType: 'session', config });
      addedSkills.add(skillName);
    }
  }

  // Check each skill for matches
  for (const [skillName, config] of Object.entries(rules.skills)) {
    // Filter by scope first
    if (!skillMatchesScope(config, currentRepo)) {
      continue;
    }

    // Skip if already added via session-sticky
    if (addedSkills.has(skillName)) {
      continue;
    }

    // AUTO-ACTIVATE: alwaysActivate + scope matches (exact repo OR "all")
    if (config.alwaysActivate && (config.scope === currentRepo || config.scope === 'all')) {
      matched.push({ name: skillName, matchType: 'auto', config });
      addedSkills.add(skillName);
      continue;
    }

    const triggers = config.promptTriggers;
    if (!triggers) {
      continue;
    }

    // Keyword matching
    if (triggers.keywords) {
      const keywordMatch = triggers.keywords.some(kw =>
        promptLower.includes(kw.toLowerCase())
      );
      if (keywordMatch) {
        matched.push({ name: skillName, matchType: 'keyword', config });
        addedSkills.add(skillName);
        continue;
      }
    }

    // Intent pattern matching
    if (triggers.intentPatterns) {
      const intentMatch = triggers.intentPatterns.some(pattern => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(prompt);
        } catch {
          // Invalid regex — skip
          return false;
        }
      });
      if (intentMatch) {
        matched.push({ name: skillName, matchType: 'intent', config });
        addedSkills.add(skillName);
      }
    }
  }

  return matched;
}

/**
 * Format the output for Claude's context injection.
 * High-priority skills get full content in <!-- skill --> blocks.
 * Medium/low skills are listed as available.
 *
 * @param {Array<{ name: string, matchType: string, config: Object, content?: string }>} matched
 * @param {string} currentRepo - Current repository name
 * @param {string} projectDir - Absolute path to the project root
 * @returns {string} Formatted output for stdout
 */
export function formatOutput(matched, currentRepo, projectDir) {
  if (matched.length === 0) {
    return '';
  }

  // Content should already be set by main(); this is a no-op guard
  const skillsWithContent = matched.filter(s => s.content);
  const skillsWithoutContent = matched.filter(s => !s.content);

  // High priority: base type OR critical/high priority — inject full content
  const highPrioritySkills = skillsWithContent.filter(
    s => s.config.type === 'base' || s.config.priority === 'critical' || s.config.priority === 'high'
  );

  // Medium/low priority (excluding those already in high priority) — list as available
  const highSet = new Set(highPrioritySkills);
  const optionalSkills = skillsWithContent.filter(
    s => !highSet.has(s)
  );

  let output = '';

  if (highPrioritySkills.length > 0) {
    output += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n';
    output += `\uD83D\uDCCD ACTIVE SKILLS (${currentRepo})\n`;
    output += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n';

    for (const skill of highPrioritySkills) {
      output += `<!-- skill: ${skill.name} -->\n`;
      output += skill.content + '\n';
      output += `<!-- /skill: ${skill.name} -->\n\n`;
    }
  }

  if (optionalSkills.length > 0 || skillsWithoutContent.length > 0) {
    const availableNames = [
      ...optionalSkills.map(s => s.name),
      ...skillsWithoutContent.map(s => s.name),
    ];
    output += '\uD83D\uDCCC Available skills (ask to activate): ' + availableNames.join(', ') + '\n';
  }

  if (highPrioritySkills.length > 0 || optionalSkills.length > 0 || skillsWithoutContent.length > 0) {
    output += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n';
  }

  return output;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  try {
    // Read input from stdin
    const input = readFileSync(0, 'utf-8');

    let data;
    try {
      data = JSON.parse(input);
    } catch {
      // Invalid JSON — exit silently
      process.exit(0);
    }

    const prompt = data.prompt || '';
    if (!prompt) {
      process.exit(0);
    }

    // Determine project directory
    const projectDir = process.env.CLAUDE_PROJECT_DIR;
    if (!projectDir) {
      process.exit(0);
    }

    // Load skill rules
    const rulesPath = join(projectDir, '.claude', 'skills', 'skill-rules.json');
    if (!existsSync(rulesPath)) {
      // No skill rules file — exit silently
      process.exit(0);
    }

    let rules;
    try {
      rules = JSON.parse(readFileSync(rulesPath, 'utf-8'));
    } catch {
      // Invalid rules file — exit silently
      process.exit(0);
    }

    if (!rules.skills || typeof rules.skills !== 'object') {
      process.exit(0);
    }

    // Detect current repository
    const currentRepo = detectCurrentRepo(projectDir);

    // Get session-sticky skills
    const sessionSkills = getSessionActiveSkills(projectDir, currentRepo);

    // Match skills against the prompt
    const matched = matchSkills(prompt, rules, currentRepo, sessionSkills);

    // Load content for matched skills
    for (const skill of matched) {
      const content = readSkillContent(projectDir, skill.name);
      if (content) {
        skill.content = content;
      }
    }

    // Debug output
    if (process.env.ASPENS_DEBUG === '1') {
      const debugTrace = {
        timestamp: new Date().toISOString(),
        projectDir,
        currentRepo,
        prompt: prompt.substring(0, 500),
        sessionSkills,
        rulesLoaded: Object.keys(rules.skills),
        matched: matched.map(s => ({
          name: s.name,
          matchType: s.matchType,
          priority: s.config.priority,
          type: s.config.type,
          hasContent: !!s.content,
        })),
      };
      try {
        writeFileSync('/tmp/aspens-debug-activation.json', JSON.stringify(debugTrace, null, 2));
      } catch {
        // Debug write failed — ignore
      }
    }

    // Format and emit output
    if (matched.length > 0) {
      const output = formatOutput(matched, currentRepo, projectDir);

      // stderr: terminal status line
      const highPriority = matched.filter(
        s => s.config.type === 'base' || s.config.priority === 'critical' || s.config.priority === 'high'
      );
      const activatedNames = highPriority.map(s => s.name).join(', ') || 'none';
      process.stderr.write(`[Skills] Activated: ${activatedNames}\n`);

      // stdout: injected into Claude's context
      if (output) {
        process.stdout.write(output);
      }
    }

    process.exit(0);
  } catch (err) {
    // NEVER block the user's prompt — log and exit cleanly
    process.stderr.write(`[Skills] Error: ${err.message}\n`);
    process.exit(0);
  }
}

// CLI entry point guard — only run main() when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
