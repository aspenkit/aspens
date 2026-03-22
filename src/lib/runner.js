import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, normalize } from 'path';
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
      child.kill('SIGTERM');
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

  // Primary: XML tags — <file path="...">content</file>
  // Unambiguous, handles code blocks inside content
  const xmlPattern = /<file\s+path=["'](.+?)["']>\n?([\s\S]*?)<\/file>/g;
  let match;
  while ((match = xmlPattern.exec(output)) !== null) {
    const filePath = sanitizePath(match[1].trim());
    if (filePath) {
      files.push({ path: filePath, content: match[2].trim() + '\n' });
    }
  }

  // Fallback 1: HTML comment markers with content between them
  if (files.length === 0) {
    const commentPattern = /<!--\s*file:\s*(.+?)\s*-->\s*\n([\s\S]*?)(?=<!--\s*file:|<file\s|$)/g;
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
