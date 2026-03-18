import { resolve } from 'path';
import pc from 'picocolors';
import { scanRepo } from '../lib/scanner.js';

export function scanCommand(path, options) {
  const repoPath = resolve(path);
  const result = scanRepo(repoPath);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Pretty print
  console.log();
  console.log(pc.bold(`  ${result.name}`) + pc.dim(` (${result.repoType})`));
  console.log(pc.dim(`  ${result.path}`));
  console.log();

  if (result.languages.length > 0) {
    console.log(pc.cyan('  Languages: ') + result.languages.join(', '));
  }

  if (result.frameworks.length > 0) {
    console.log(pc.cyan('  Frameworks: ') + result.frameworks.join(', '));
  }

  if (result.entryPoints.length > 0) {
    console.log(pc.cyan('  Entry points: ') + result.entryPoints.join(', '));
  }

  console.log();

  if (result.structure.topDirs.length > 0) {
    console.log(pc.bold('  Structure'));
    const srcDir = result.structure.srcDir;
    for (const dir of result.structure.topDirs) {
      const marker = dir === srcDir ? pc.green(' ← source root') : '';
      console.log(pc.dim('    ') + dir + '/' + marker);
    }
    console.log();
  }

  if (Object.keys(result.structure.keyDirs).length > 0) {
    console.log(pc.bold('  Key directories'));
    for (const [role, dir] of Object.entries(result.structure.keyDirs)) {
      console.log(pc.dim('    ') + pc.yellow(role) + pc.dim(' → ') + dir + '/');
    }
    console.log();
  }

  if (result.domains.length > 0) {
    console.log(pc.bold('  Detected domains'));
    for (const domain of result.domains) {
      const sources = [...domain.directories];
      if (domain.files && domain.files.length > 0) {
        sources.push(...domain.files.slice(0, 3));
        if (domain.files.length > 3) sources.push(`+${domain.files.length - 3} files`);
      }
      console.log(pc.dim('    ') + pc.green(domain.name) + (sources.length > 0 ? pc.dim(` (${sources.join(', ')})`) : ''));
    }
    console.log();
  }

  // Size
  if (result.size) {
    console.log(pc.bold('  Repo size'));
    console.log(pc.dim('    ') + `${result.size.sourceFiles} source files (~${result.size.estimatedLines.toLocaleString()} lines) — ${result.size.category}`);
    console.log();
  }

  // Status
  const claude = result.hasClaudeConfig ? pc.green('yes') : pc.dim('no');
  const claudeMd = result.hasClaudeMd ? pc.green('yes') : pc.dim('no');
  console.log(pc.bold('  Claude Code'));
  console.log(pc.dim('    ') + `.claude/ ${claude}  CLAUDE.md ${claudeMd}`);
  console.log();
}
