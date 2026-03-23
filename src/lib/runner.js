import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, normalize, resolve, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'prompts');
const PARTIALS_DIR = join(PROMPTS_DIR, 'partials');

// Paths that parseFileOutput is allowed to write to
const ALLOWED_DIR_PREFIXES = ['.claude/'];
const ALLOWED_EXACT_FILES = ['CLAUDE.md'];

/**
 * Check if claude CLI is available.
 */
function checkClaude() {
  try {
    execSync(process.platform === 'win32' ? 'where claude' : 'which claude', { stdio: 'pipe', timeout: 5000 });
  } catch {
    throw new Error(
      'Claude Code CLI not found. Install it first:\n' +
      '  npm install -g @anthropic-ai/claude-code\n\n' +
      'Or use --runner api (coming soon) to use the API directly.'
    );
  }
}

/**
 * Execute a prompt via Claude Code CLI (claude -p).
 * Always uses stream-json for token tracking.
 * Returns { text, usage } where usage has output_tokens, tool_uses, tool_result_chars.
 */
export function runClaude(prompt, options = {}) {
  const { timeout = 300000, allowedTools = null, disableTools = false, verbose = false, onActivity = null, model = null } = options;

  checkClaude();

  let toolFlags = [];
  if (disableTools) {
    toolFlags = ['--disallowedTools', 'Bash,Read,Write,Edit,Glob,Grep,Agent,WebSearch,WebFetch,NotebookEdit'];
  } else if (allowedTools && allowedTools.length > 0) {
    toolFlags = ['--allowedTools', allowedTools.join(',')];
  }

  const modelFlags = model ? ['--model', model] : [];

  // Always use stream-json so we can extract token usage
  // Claude CLI requires --verbose when using stream-json with -p
  const args = ['-p', '--verbose', ...toolFlags, ...modelFlags, '--output-format', 'stream-json'];

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    const chunks = [];
    const errChunks = [];
    let lineBuffer = '';

    child.stdout.on('data', (data) => {
      chunks.push(data);

      // Parse stream events for verbose activity display
      if (verbose && onActivity) {
        lineBuffer += data.toString('utf8');
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleStreamEvent(JSON.parse(line), onActivity);
          } catch { /* not JSON */ }
        }
      }
    });

    child.stderr.on('data', (data) => errChunks.push(data));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        try { execSync(`taskkill /pid ${child.pid} /t /f`, { stdio: 'ignore' }); } catch { /* ignore */ }
      } else {
        child.kill('SIGTERM');
      }
    }, timeout);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks).toString('utf8');
      const stderr = Buffer.concat(errChunks).toString('utf8');

      if (timedOut || signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new Error(`Claude timed out after ${timeout / 1000}s. Try a smaller repo or increase --timeout.`));
      } else if (code === 0) {
        const { text, usage } = extractResultFromStream(stdout);
        resolve({ text, usage });
      } else if (stderr.includes('rate limit')) {
        reject(new Error('Claude rate limit hit. Wait a moment and try again.'));
      } else {
        reject(new Error(`Claude exited with code ${code}${stderr ? ': ' + stderr.slice(0, 500) : ''}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Claude failed to start: ${err.message}`));
    });

    // Write prompt to stdin with backpressure handling
    const ok = child.stdin.write(prompt);
    if (!ok) {
      child.stdin.once('drain', () => child.stdin.end());
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Load a prompt template from src/prompts/ and substitute variables.
 */
export function loadPrompt(name, vars = {}) {
  const promptPath = join(PROMPTS_DIR, `${name}.md`);
  let content = readFileSync(promptPath, 'utf8');

  // Resolve partials: {{partial-name}} → contents of partials/partial-name.md
  content = content.replace(/\{\{([a-z0-9-]+)\}\}/g, (match, partialName) => {
    const partialPath = join(PARTIALS_DIR, `${partialName}.md`);
    if (existsSync(partialPath)) {
      return readFileSync(partialPath, 'utf8');
    }
    return match;
  });

  // Warn about unresolved partials (not files, not variables)
  const remaining = content.match(/\{\{([a-z0-9-]+)\}\}/g) || [];
  const varKeys = new Set(Object.keys(vars));
  for (const token of remaining) {
    const partialName = token.slice(2, -2);
    if (!varKeys.has(partialName)) {
      console.error(`Warning: unresolved partial {{${partialName}}} in prompt ${name}.md`);
    }
  }

  // Resolve variables: {{varName}} → vars[varName]
  for (const [key, value] of Object.entries(vars)) {
    const replacement = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    content = content.replaceAll(`{{${key}}}`, replacement);
  }

  return content;
}

/**
 * Parse Claude's output into discrete files.
 * Primary format: <file path="...">content</file> (XML tags)
 * Fallback: <!-- file: path --> markers (legacy)
 * Validates paths to prevent traversal.
 */
export function parseFileOutput(output) {
  let files = [];

  // Primary: Split on <file path="..."> tags and match to next </file> outside code fences.
  // Strategy: find all </file> positions that are NOT inside ``` fenced code blocks,
  // then match each <file> open tag to the nearest valid </file>.
  const openTagPattern = /<file\s+path=["'](.+?)["']>/g;

  // Pre-compute which character positions are inside fenced code blocks
  const fenceRanges = [];
  const fenceRegex = /(^|\n)```[^\n]*\n([\s\S]*?)(?:\n```|$)/g;
  let fm;
  while ((fm = fenceRegex.exec(output)) !== null) {
    const start = fm.index + fm[1].length; // skip leading newline if present
    fenceRanges.push([start, fm.index + fm[0].length]);
  }
  function isInsideFence(pos) {
    for (const [start, end] of fenceRanges) {
      if (pos >= start && pos < end) return true;
    }
    return false;
  }

  // Find all valid </file> positions (at line start, outside code fences)
  const closePositions = [];
  const closeRegex = /(^|\n)<\/file>/g;
  let cm;
  while ((cm = closeRegex.exec(output)) !== null) {
    const tagStart = cm.index + cm[1].length;
    if (!isInsideFence(tagStart)) {
      closePositions.push(cm.index);
    }
  }

  let openMatch;
  while ((openMatch = openTagPattern.exec(output)) !== null) {
    if (isInsideFence(openMatch.index)) continue;
    const filePath = sanitizePath(openMatch[1].trim());
    if (!filePath) continue;

    const contentStart = openMatch.index + openMatch[0].length;

    // Find the first valid </file> AFTER this open tag
    const closePos = closePositions.find(p => p >= contentStart);

    let content;
    if (closePos !== undefined) {
      content = output.slice(contentStart, closePos).trim() + '\n';
      // Advance past this </file> tag
      openTagPattern.lastIndex = closePos + '\n</file>'.length;
    } else {
      // No valid closing tag — take up to next <file or end (don't eat next file)
      const remaining = output.slice(contentStart);
      const nextOpen = remaining.match(/<file\s+path=/);
      content = (nextOpen ? remaining.slice(0, nextOpen.index) : remaining).trim() + '\n';
    }

    files.push({ path: filePath, content });
  }

  // Fallback: HTML comment markers with content between them
  if (files.length === 0) {
    const commentPattern = /<!--\s*file:\s*(.+?)\s*-->\s*\n([\s\S]*?)(?=<!--\s*file:|<file\s|$)/g;
    let match;
    while ((match = commentPattern.exec(output)) !== null) {
      const filePath = sanitizePath(match[1].trim());
      const content = match[2].trim() + '\n';
      if (filePath && content.length > 10) {
        files.push({ path: filePath, content });
      }
    }
  }

  return files;
}

/**
 * Validate generated skill files for common issues.
 * Returns { valid: true } or { valid: false, issues: [...] }
 */
export function validateSkillFiles(files, repoPath) {
  const issues = [];

  for (const file of files) {
    const { path: filePath, content } = file;

    // Check for truncated content (likely XML parser collision)
    // Only flag <file path="..."> as a raw tag — ignore mentions inside backticks/code blocks
    const hasRawFileTag = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').match(/<file\s+path=/);
    if (content.endsWith('<\n') || content.endsWith('`<\n') || hasRawFileTag) {
      issues.push({ file: filePath, issue: 'truncated', detail: 'Content appears truncated — likely XML tag collision' });
    }

    // Check skills have required sections
    if (filePath.includes('/skills/') && filePath.endsWith('.md')) {
      const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!frontmatterMatch || !frontmatterMatch[1].includes('name:')) {
        issues.push({ file: filePath, issue: 'missing-frontmatter', detail: 'Missing YAML frontmatter (name, description)' });
      }

      // Check for at least some content beyond frontmatter
      const fmEnd = content.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/);
      const contentAfterFrontmatter = fmEnd ? content.slice(fmEnd[0].length).trim() : content.trim();
      if (contentAfterFrontmatter.length < 50) {
        issues.push({ file: filePath, issue: 'too-short', detail: 'Skill content is too short (< 50 chars after frontmatter)' });
      }

      // Validate required sections for domain skills (not base)
      const isBase = contentAfterFrontmatter.includes('**base skill**');
      if (!isBase) {
        const requiredSections = ['Activation', 'Key Files', 'Key Concepts', 'Critical Rules'];
        const missing = requiredSections.filter(s => !new RegExp(`^#+\\s*${s}\\b`, 'm').test(contentAfterFrontmatter));
        if (missing.length > 0) {
          issues.push({ file: filePath, issue: 'missing-sections', detail: `Missing sections: ${missing.join(', ')}` });
        }
      }
    }

    // Validate referenced file paths exist (check paths in backticks)
    if (repoPath && filePath.includes('/skills/')) {
      const referencedPaths = [...content.matchAll(/`([^`]+\.[a-z]{1,8})`/g)]
        .map(m => m[1])
        .filter(p => p.startsWith('src/') || p.startsWith('bin/') || p.startsWith('tests/') || p.startsWith('app/'));

      for (const refPath of referencedPaths) {
        // Skip glob patterns and path traversal
        if (refPath.includes('*') || refPath.includes('?') || refPath.includes('..')) continue;
        const resolved = resolve(repoPath, refPath);
        const rel = relative(repoPath, resolved);
        if (rel.startsWith('..') || rel.startsWith(sep)) continue;
        if (!existsSync(resolved)) {
          issues.push({ file: filePath, issue: 'bad-path', detail: `Referenced path \`${refPath}\` does not exist` });
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Handle a stream-json event — call onActivity for tool use events.
 */
function handleStreamEvent(event, onActivity) {
  if (!onActivity) return;

  // Tool use events
  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'tool_use') {
        const tool = block.name;
        const input = block.input || {};
        if (tool === 'Read' && input.file_path) {
          onActivity(`Reading ${input.file_path.split('/').slice(-2).join('/')}`);
        } else if (tool === 'Glob' && input.pattern) {
          onActivity(`Searching for ${input.pattern}`);
        } else if (tool === 'Grep' && input.pattern) {
          onActivity(`Searching code for "${input.pattern}"`);
        } else {
          onActivity(`Using ${tool}`);
        }
      }
    }
  }
}

/**
 * Extract text and token usage from stream-json output.
 * Returns { text, usage }
 */
export function extractResultFromStream(rawOutput) {
  const lines = rawOutput.split('\n').filter(l => l.trim());
  const textParts = [];
  let usage = { output_tokens: 0, tool_uses: 0, tool_result_chars: 0 };

  // Write raw events to debug file if ASPENS_DEBUG is set
  if (process.env.ASPENS_DEBUG) {
    try {
      writeFileSync('/tmp/aspens-debug-stream.json', rawOutput);
    } catch {}
  }

  for (const line of lines) {
    try {
      const event = JSON.parse(line);

      // Result event — has final text and cumulative usage
      if (event.type === 'result') {
        if (event.usage) {
          usage.output_tokens = event.usage.output_tokens || 0;
        }
        if (event.result) {
          return { text: event.result, usage };
        }
      }

      // Accumulate text from assistant messages and count tool uses
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            usage.tool_uses++;
          }
        }
      }

      // Measure tool results (what Claude read from the repo)
      if (event.type === 'user' && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block.type === 'tool_result' && typeof block.content === 'string') {
            usage.tool_result_chars += block.content.length;
          }
        }
      }

      // Capture output usage from any event that has it
      if (event.usage) {
        usage.output_tokens = event.usage.output_tokens || 0;
      }
    } catch {
      // not JSON
    }
  }

  return { text: textParts.join('\n'), usage };
}

/**
 * Validate and sanitize a file path from Claude output.
 * Prevents path traversal and restricts to allowed locations.
 */
function sanitizePath(rawPath) {
  const normalized = normalize(rawPath).replace(/\\/g, '/');

  // Block absolute paths (Unix / and Windows C:\ patterns)
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;

  // Block traversal
  if (normalized.includes('..')) return null;

  // Allow exact file matches (e.g., CLAUDE.md but not CLAUDE.md.bak)
  if (ALLOWED_EXACT_FILES.includes(normalized)) return normalized;

  // Allow paths under allowed directory prefixes
  if (ALLOWED_DIR_PREFIXES.some(prefix => normalized.startsWith(prefix))) return normalized;

  return null;
}
