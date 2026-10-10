// Prod-migrate guard (S1.1, AC-13; S1.1d16). prisma.config.ts calls
// assertMigrateAllowed before defineConfig, so every Prisma CLI command that
// loads this config is checked. A command that can connect is refused when its
// effective database host is Supabase (*.supabase.co or *.pooler.supabase.com),
// unless ALLOW_PROD_MIGRATE=1 is set inline for that one command.
//
// Known limit: `--config <other file>` never loads this config, so it bypasses
// the guard (README Troubleshooting).
//
// Imported by relative path from prisma.config.ts: the Prisma CLI loader has
// no `@/` alias, so this file imports nothing from the app.

export class MigrateGuardError extends Error {
  readonly host: string | null;
  readonly command: string;

  constructor(message: string, command: string, host: string | null) {
    super(message);
    this.name = "MigrateGuardError";
    this.command = command;
    this.host = host;
  }
}

export interface MigrateGuardInput {
  /** process.argv.slice(2) as the Prisma CLI received it. */
  argv: readonly string[];
  /** The URL prisma.config.ts resolved for its datasource. */
  url: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}

/** Commands that never connect to a database. */
const EXEMPT_COMMANDS = new Set([
  "generate",
  "validate",
  "format",
  "version",
  "debug",
]);
const CONFIG_DATASOURCE_FLAGS = [
  "--from-config-datasource",
  "--to-config-datasource",
];

const flagName = (arg: string) => arg.split("=", 1)[0];

function positionals(argv: readonly string[]): string[] {
  return argv.filter((arg) => !arg.startsWith("-"));
}

/** Every value given to --url, in either `--url v` or `--url=v` form. */
export function urlFlagValues(argv: readonly string[]): (string | undefined)[] {
  const values: (string | undefined)[] = [];
  argv.forEach((arg, i) => {
    if (arg === "--url") {
      const next = argv[i + 1];
      values.push(
        next === undefined || next.startsWith("--") ? undefined : next,
      );
    } else if (arg.startsWith("--url=")) {
      values.push(arg.slice("--url=".length));
    }
  });
  return values;
}

/** Hostname of a database URL, lower-cased, without a trailing dot; null if unparsable. */
export function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return host || null;
  } catch {
    return null;
  }
}

export function isSupabaseHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return (
    h === "supabase.co" ||
    h.endsWith(".supabase.co") ||
    h === "pooler.supabase.com" ||
    h.endsWith(".pooler.supabase.com")
  );
}

/** A short command label for messages: never includes URLs or flags. */
function commandLabel(argv: readonly string[]): string {
  const [command, sub] = positionals(argv);
  if (!command) return "(none)";
  return command === "migrate" || command === "db"
    ? `${command} ${sub ?? ""}`.trim()
    : command;
}

/**
 * Exempt: no command at all (`prisma`, `-v`, `--version`, `-h`, `--help`), a
 * command that never connects, or a `migrate diff` that names no config
 * datasource. A help or version flag after a command does not exempt it: that
 * would be a bypass if Prisma ever ran the command anyway, and refusing help
 * text costs nothing.
 */
export function isExempt(argv: readonly string[]): boolean {
  const [command, sub] = positionals(argv);
  if (!command) return true;
  if (EXEMPT_COMMANDS.has(command)) return true;
  if (command === "migrate" && sub === "diff") {
    return !argv.some((arg) => CONFIG_DATASOURCE_FLAGS.includes(flagName(arg)));
  }
  return false;
}

/**
 * Throws MigrateGuardError when a guarded command would reach a Supabase host
 * without ALLOW_PROD_MIGRATE=1 (exactly '1'). Fails closed: a guarded command
 * whose URL does not parse is refused too.
 */
export function assertMigrateAllowed({
  argv,
  url,
  env,
}: MigrateGuardInput): void {
  if (isExempt(argv)) return;

  const flagged = urlFlagValues(argv);
  const candidates = flagged.length > 0 ? flagged : [url];
  const command = commandLabel(argv);

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === "") {
      if (flagged.length > 0) {
        throw new MigrateGuardError(
          `migrate guard: refused \`prisma ${command}\`: --url has no value, so its host cannot be checked.`,
          command,
          null,
        );
      }
      continue; // no URL configured: nothing to protect
    }

    const host = hostOf(candidate);
    if (host === null) {
      throw new MigrateGuardError(
        `migrate guard: refused \`prisma ${command}\`: the database URL does not parse, so its host cannot be checked.`,
        command,
        null,
      );
    }

    if (isSupabaseHost(host) && env.ALLOW_PROD_MIGRATE !== "1") {
      throw new MigrateGuardError(
        `migrate guard: refused \`prisma ${command}\` against ${host} (a Supabase production host). ` +
          "Production is Josh's channel only: set ALLOW_PROD_MIGRATE=1 inline for this one command, " +
          "never in any .env* file.",
        command,
        host,
      );
    }
  }
}
