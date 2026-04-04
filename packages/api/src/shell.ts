// ============================================================
// Click-Deploy — Shell Safety Utilities
// ============================================================
// Prevents shell injection in SSH exec commands.
// Every user-controllable value interpolated into a shell
// command string MUST pass through shellEscape() first.
// ============================================================

/**
 * Escape a string for safe interpolation into a shell command.
 * Wraps the value in single quotes and escapes any embedded
 * single quotes using the `'\''` idiom.
 *
 * Example: shellEscape("foo'bar") => "'foo'\\''bar'"
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Sanitize a string to contain only safe characters for use as
 * a Docker resource name (service name, image tag, etc.).
 * Strips everything except lowercase alphanumeric, hyphens, dots, colons, and slashes.
 */
export function sanitizeDockerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_./:@-]/g, '-').replace(/-+/g, '-');
}

/**
 * Sanitize an environment variable key/value pair for shell interpolation.
 * Removes characters that could break out of shell quoting.
 */
export function sanitizeEnvPair(key: string, value: string): { key: string; value: string } {
  const safeKey = key.replace(/[^a-zA-Z0-9_]/g, '');
  const safeValue = value.replace(/['\"\\$`!;|&(){}]/g, '');
  return { key: safeKey, value: safeValue };
}
