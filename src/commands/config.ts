/**
 * Config command - Show config file locations and status
 */

import { type ConfigPathsResult, getConfigPaths } from '../config.js';

export interface ConfigOptions {
  json: boolean;
  configPath?: string;
}

function formatTextOutput(result: ConfigPathsResult): string {
  const lines: string[] = [];

  if (result.active) {
    lines.push(`Active: ${result.active}`);
    if (result.activeSource === 'cli') {
      lines.push('        (from -c/--config flag)');
    } else if (result.activeSource === 'env') {
      lines.push('        (from MCP_CONFIG_PATH)');
    }
  } else {
    lines.push('Active: (none found)');
  }

  lines.push('');
  lines.push('Search paths:');

  for (const info of result.searchPaths) {
    const marker = info.active ? '>' : info.exists ? 'o' : 'x';
    let label = '';
    if (info.source === 'cli') {
      label = ' (--config)';
    } else if (info.source === 'env') {
      label = ' (MCP_CONFIG_PATH)';
    }
    lines.push(`  ${marker} ${info.path}${label}`);
  }

  if (result.envVar) {
    lines.push('');
    lines.push(`MCP_CONFIG_PATH=${result.envVar}`);
  }

  return lines.join('\n');
}

function formatJsonOutput(result: ConfigPathsResult): string {
  return JSON.stringify(result, null, 2);
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  const result = getConfigPaths(options.configPath);

  if (options.json) {
    console.log(formatJsonOutput(result));
  } else {
    console.log(formatTextOutput(result));
  }
}
