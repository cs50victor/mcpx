/**
 * Convert glob pattern to regex
 * Handles: * (any chars), ? (single char), ** (globstar)
 *
 * Examples:
 * - "*file*" matches "read_file", "file_utils"
 * - "**test**" matches "test", "my_test_tool", "testing"
 * - "server/*" matches "server/tool" but not "server/sub/tool"
 * - "server/**" matches "server/tool" and "server/sub/tool"
 */
export function globToRegex(pattern: string): RegExp {
  let escaped = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*' && pattern[i + 1] === '*') {
      // ** (globstar) - match anything including slashes (zero or more chars)
      escaped += '.*';
      i += 2;
      // Skip any immediately following * (e.g., *** becomes .*)
      while (pattern[i] === '*') {
        i++;
      }
    } else if (char === '*') {
      // * - match any chars except slash (zero or more)
      escaped += '[^/]*';
      i += 1;
    } else if (char === '?') {
      // ? - match single char (not slash)
      escaped += '[^/]';
      i += 1;
    } else if ('[.+^${}()|\\]'.includes(char)) {
      // Escape special regex chars
      escaped += `\\${char}`;
      i += 1;
    } else {
      escaped += char;
      i += 1;
    }
  }

  return new RegExp(`^${escaped}$`, 'i');
}
