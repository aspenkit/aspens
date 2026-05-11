import { describe, it, expect } from 'vitest';
import {
  parseTriggersFrontmatter,
  parseActivationPatterns,
  parseKeywords,
} from '../src/lib/skill-reader.js';

// ─── parseTriggersFrontmatter ───────────────────────────────────────────────

describe('parseTriggersFrontmatter', () => {
  it('returns null when no frontmatter present', () => {
    expect(parseTriggersFrontmatter('No frontmatter here')).toBeNull();
  });

  it('returns null when frontmatter has no triggers: key', () => {
    const content = `---
name: auth
description: Auth domain
---

Content here.`;
    expect(parseTriggersFrontmatter(content)).toBeNull();
  });

  it('parses files as block list', () => {
    const content = `---
name: auth
description: JWT auth
triggers:
  files:
    - app/deps.py
    - app/api/v1/auth.py
  keywords:
    - auth
    - jwt
---

Content.`;
    const result = parseTriggersFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result.filePatterns).toEqual(['app/deps.py', 'app/api/v1/auth.py']);
    expect(result.keywords).toEqual(['auth', 'jwt']);
    expect(result.alwaysActivate).toBe(false);
  });

  it('parses keywords as inline array', () => {
    const content = `---
name: billing
description: Stripe billing
triggers:
  files:
    - stripe_service.py
  keywords: [billing, stripe, subscription]
---

Content.`;
    const result = parseTriggersFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result.keywords).toEqual(['billing', 'stripe', 'subscription']);
    expect(result.filePatterns).toEqual(['stripe_service.py']);
  });

  it('parses alwaysActivate: true for base skill', () => {
    const content = `---
name: base
description: Core conventions
triggers:
  alwaysActivate: true
---

Content.`;
    const result = parseTriggersFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result.alwaysActivate).toBe(true);
    expect(result.filePatterns).toEqual([]);
    expect(result.keywords).toEqual([]);
  });

  it('returns empty arrays when triggers: key is present but empty', () => {
    const content = `---
name: orphan
description: No sub-fields
triggers:
name2: something
---

Content.`;
    const result = parseTriggersFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result.filePatterns).toEqual([]);
    expect(result.keywords).toEqual([]);
    expect(result.alwaysActivate).toBe(false);
  });

  it('handles glob patterns in files', () => {
    const content = `---
name: payments
description: Payment processing
triggers:
  files:
    - app/payments/**
    - src/lib/stripe*.js
  keywords:
    - payment
---

Content.`;
    const result = parseTriggersFrontmatter(content);
    expect(result.filePatterns).toEqual(['app/payments/**', 'src/lib/stripe*.js']);
  });

  it('returns null for empty content', () => {
    expect(parseTriggersFrontmatter('')).toBeNull();
    expect(parseTriggersFrontmatter(null)).toBeNull();
    expect(parseTriggersFrontmatter(undefined)).toBeNull();
  });
});

// ─── parseActivationPatterns — frontmatter path ─────────────────────────────

describe('parseActivationPatterns with frontmatter triggers', () => {
  it('returns filePatterns from triggers: when present', () => {
    const content = `---
name: auth
description: JWT auth
triggers:
  files:
    - app/deps.py
    - app/api/v1/auth.py
  keywords:
    - auth
---

Content here.`;
    const patterns = parseActivationPatterns(content);
    expect(patterns).toEqual(['app/deps.py', 'app/api/v1/auth.py']);
  });

  it('returns empty array when triggers: present but no files', () => {
    const content = `---
name: base
description: Base skill
triggers:
  alwaysActivate: true
---

Content.`;
    const patterns = parseActivationPatterns(content);
    expect(patterns).toEqual([]);
  });

  it('frontmatter triggers takes precedence over ## Activation section', () => {
    // Both present — frontmatter wins
    const content = `---
name: auth
description: Auth
triggers:
  files:
    - new/path.py
  keywords:
    - auth
---

## Activation

- \`old/legacy.py\`

Content.`;
    const patterns = parseActivationPatterns(content);
    expect(patterns).toEqual(['new/path.py']);
    expect(patterns).not.toContain('old/legacy.py');
  });
});

// ─── parseActivationPatterns — legacy ## Activation fallback ────────────────

describe('parseActivationPatterns legacy ## Activation fallback', () => {
  it('falls back to ## Activation when no triggers: in frontmatter', () => {
    const content = `---
name: scanner
description: Scanner
---

## Activation

- \`src/lib/scanner.js\`
- \`src/commands/doc-init.js\`

Keywords: scanning

---

Content.`;
    const patterns = parseActivationPatterns(content);
    expect(patterns).toContain('src/lib/scanner.js');
    expect(patterns).toContain('src/commands/doc-init.js');
  });

  it('returns empty array when neither triggers: nor ## Activation present', () => {
    const content = `---
name: bare
description: No trigger info
---

Just content.`;
    expect(parseActivationPatterns(content)).toEqual([]);
  });
});

// ─── parseKeywords — frontmatter path ───────────────────────────────────────

describe('parseKeywords with frontmatter triggers', () => {
  it('returns keywords from triggers: when present (block list)', () => {
    const content = `---
name: auth
description: Auth
triggers:
  keywords:
    - auth
    - jwt
    - token
---

Content.`;
    expect(parseKeywords(content)).toEqual(['auth', 'jwt', 'token']);
  });

  it('returns keywords from triggers: when present (inline array)', () => {
    const content = `---
name: billing
description: Billing
triggers:
  keywords: [billing, stripe, webhook]
---

Content.`;
    expect(parseKeywords(content)).toEqual(['billing', 'stripe', 'webhook']);
  });

  it('returns empty array when triggers: present but no keywords', () => {
    const content = `---
name: base
description: Base
triggers:
  alwaysActivate: true
---

Content.`;
    expect(parseKeywords(content)).toEqual([]);
  });

  it('falls back to Keywords: line when no triggers:', () => {
    const content = `---
name: scanner
description: Scanner
---

## Activation

- \`src/lib/scanner.js\`

Keywords: scanning, graph-builder

---

Content.`;
    const keywords = parseKeywords(content);
    expect(keywords).toContain('scanning');
    expect(keywords).toContain('graph-builder');
  });

  it('returns empty array when no triggers: and no Keywords: line', () => {
    const content = `---
name: bare
description: No keywords
---

Content.`;
    expect(parseKeywords(content)).toEqual([]);
  });
});
