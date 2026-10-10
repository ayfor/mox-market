// Prod-migrate guard (S1.1, AC-13; S1.1d16). prisma.config.ts calls
// assertMigrateAllowed before defineConfig, so every Prisma CLI command that
// loads this config is checked. A command that can connect is refused when any
// effective database host is Supabase (*.supabase.co or *.pooler.supabase.com),
// unless ALLOW_PROD_MIGRATE=1 is set inline for that one command.
//
// Effective hosts (ADV.1): the URL hostname plus every `host` query parameter,
// because Prisma 7.5's schema engine and pg both connect to `?host=` instead of
// the hostname. Checked for the config URL, every --url value and, for the
// commands that open one, the shadow database URL (ADV.2).
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
  /** The datasource's shadowDatabaseUrl, if prisma.config.ts sets one (ADV.2). */
  shadowUrl?: string | undefined;
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
const DIFF_DATASOURCE_FLAGS = [
  "--from-config-datasource",
  "--to-config-datasource",
];
/** `migrate diff` applies a migrations directory to the shadow database. */
const DIFF_MIGRATIONS_FLAGS = ["--from-migrations", "--to-migrations"];
/**
 * Guarded commands known never to open a shadow database. Every other guarded
 * command (`migrate dev`, `mcp`, `dev`, `init`, anything unknown) has its
 * shadow URL checked too, so the guard fails closed.
 */
const SHADOW_FREE = new Set([
  "migrate deploy",
  "migrate resolve",
  "migrate status",
  "migrate reset",
  "db push",
  "db pull",
  "db execute",
  "db seed",
  "studio",
]);

const flagName = (arg: string) => arg.split("=", 1)[0];
const hasFlag = (argv: readonly string[], flags: readonly string[]) =>
  argv.some((arg) => flags.includes(flagName(arg)));

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

export interface UrlHosts {
  /**
   * The URL hostname and every `host` query parameter value, comma-split,
   * lower-cased, trailing dot dropped. An empty piece stays as "" so callers
   * can fail closed on it (pg falls back to PGHOST for an empty host).
   */
  hosts: string[];
  /** Every `hostaddr` query parameter value: IP addresses, not names. */
  hostaddrs: string[];
}

const normaliseHost = (host: string) =>
  host.trim().toLowerCase().replace(/\.$/, "");

/**
 * The hosts a database URL can make a client connect to (ADV.1), or null when
 * it does not parse. Query keys match case-insensitively; URLSearchParams has
 * already percent-decoded keys and values.
 */
export function hostsOf(url: string): UrlHosts | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const hosts = parsed.hostname ? parsed.hostname.split(",") : [];
  const hostaddrs: string[] = [];
  for (const [key, value] of parsed.searchParams) {
    const name = key.trim().toLowerCase();
    if (name === "host") hosts.push(...value.split(","));
    else if (name === "hostaddr") hostaddrs.push(...value.split(","));
  }
  return {
    hosts: hosts.map(normaliseHost),
    hostaddrs: hostaddrs.map(normaliseHost),
  };
}

export function isSupabaseHost(host: string): boolean {
  const h = normaliseHost(host);
  return (
    h === "supabase.co" ||
    h.endsWith(".supabase.co") ||
    h === "pooler.supabase.com" ||
    h.endsWith(".pooler.supabase.com")
  );
}

const SUBCOMMAND = /^[a-z][a-z0-9-]*$/;

/**
 * A short command label for messages: never includes URLs or flags. A
 * positional that does not look like a command name (a flag's value, such as
 * the URL in `db --url <url> push`) is shown as "(unknown)".
 */
function commandLabel(argv: readonly string[]): string {
  const [command, sub] = positionals(argv);
  if (!command) return "(none)";
  if (!SUBCOMMAND.test(command)) return "(unknown)";
  if (command !== "migrate" && command !== "db") return command;
  if (sub === undefined) return command;
  return `${command} ${SUBCOMMAND.test(sub) ? sub : "(unknown)"}`;
}

/** Exempt: no command at all (`prisma`, `-v`, `--help`) or one that never connects. */
export function isExempt(argv: readonly string[]): boolean {
  const [command] = positionals(argv);
  return !command || EXEMPT_COMMANDS.has(command);
}

interface Target {
  url: string | undefined;
  source: "--url" | "config" | "shadow";
}

/**
 * The URLs a command can reach. A help or version flag after a command does
 * not exempt it: that would be a bypass if Prisma ever ran the command anyway,
 * and refusing help text costs nothing.
 */
function targetsOf(
  argv: readonly string[],
  url: string | undefined,
  shadowUrl: string | undefined,
): Target[] {
  if (isExempt(argv)) return [];
  const flagged: Target[] = urlFlagValues(argv).map((value) => ({
    url: value,
    source: "--url",
  }));
  const [command, sub] = positionals(argv);

  if (command === "migrate" && sub === "diff") {
    // migrate diff takes no --url; any given is checked anyway (fail closed).
    const targets = [...flagged];
    if (hasFlag(argv, DIFF_DATASOURCE_FLAGS))
      targets.push({ url, source: "config" });
    if (hasFlag(argv, DIFF_MIGRATIONS_FLAGS))
      targets.push({ url: shadowUrl, source: "shadow" });
    return targets;
  }

  // --url overrides the config datasource for the commands that accept it.
  const main: Target[] =
    flagged.length > 0 ? flagged : [{ url, source: "config" }];
  return SHADOW_FREE.has(commandLabel(argv))
    ? main
    : [...main, { url: shadowUrl, source: "shadow" }];
}

/**
 * Throws MigrateGuardError when a guarded command would reach a Supabase host
 * without ALLOW_PROD_MIGRATE=1 (exactly '1'). Fails closed: a guarded command
 * whose URL does not parse, names no host or an empty one, or carries
 * `hostaddr` (an IP that bypasses the name check) is refused even with the flag.
 */
export function assertMigrateAllowed({
  argv,
  url,
  shadowUrl,
  env,
}: MigrateGuardInput): void {
  const command = commandLabel(argv);
  const cannotCheck = (why: string) =>
    new MigrateGuardError(
      `migrate guard: refused \`prisma ${command}\`: ${why}, so its host cannot be checked.`,
      command,
      null,
    );

  for (const target of targetsOf(argv, url, shadowUrl)) {
    if (target.url === undefined || target.url === "") {
      if (target.source === "--url") throw cannotCheck("--url has no value");
      continue; // no URL configured: nothing to protect
    }

    const parsed = hostsOf(target.url);
    if (parsed === null) throw cannotCheck("the database URL does not parse");
    if (parsed.hostaddrs.length > 0)
      throw cannotCheck(
        "the database URL sets hostaddr, which overrides its host by IP address",
      );
    if (parsed.hosts.length === 0 || parsed.hosts.includes(""))
      throw cannotCheck("the database URL names no host or an empty one");

    const host = parsed.hosts.find(isSupabaseHost);
    if (host !== undefined && env.ALLOW_PROD_MIGRATE !== "1") {
      const which = target.source === "shadow" ? " (its shadow database)" : "";
      throw new MigrateGuardError(
        `migrate guard: refused \`prisma ${command}\` against ${host}${which} (a Supabase production host). ` +
          "Production is Josh's channel only: set ALLOW_PROD_MIGRATE=1 inline for this one command, " +
          "never in any .env* file.",
        command,
        host,
      );
    }
  }
}
