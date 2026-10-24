/**
 * @jest-environment node
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const eslintBin = path.join(root, "node_modules/eslint/bin/eslint.js");

interface EslintReport {
  messages: { ruleId: string | null; fatal?: boolean }[];
}

jest.setTimeout(30_000);

// ESLint 9 loads its flat config with a dynamic import, which Jest's VM blocks, so lint in a child process.
function lintMessages(filePath: string, code: string): EslintReport["messages"] {
  const run = spawnSync(
    process.execPath,
    [eslintBin, "--stdin", "--stdin-filename", filePath, "--format", "json"],
    { cwd: root, input: code, encoding: "utf8" },
  );
  const reports = JSON.parse(run.stdout) as EslintReport[];
  return reports[0]?.messages ?? [];
}

function lint(filePath: string, code: string): string[] {
  return lintMessages(filePath, code).map((m) => m.ruleId ?? "");
}

describe("lint rules the whole app relies on (LOG-08)", () => {
  it("rejects console.log outside src/lib/log.ts", () => {
    const rules = lint(path.join(root, "src/features/x/thing.ts"), 'console.log("x");\nexport {};\n');
    expect(rules).toContain("no-console");
  });

  it("allows console inside src/lib/log.ts", () => {
    const messages = lintMessages(path.join(root, "src/lib/log.ts"), 'console.log("x");\nexport {};\n');
    expect(messages.some((m) => m.fatal === true || m.ruleId === null)).toBe(false);
    expect(messages.map((m) => m.ruleId)).not.toContain("no-console");
  });

  it("rejects any", () => {
    const rules = lint(path.join(root, "src/features/x/thing.ts"), "export const a: any = 1;\n");
    expect(rules).toContain("@typescript-eslint/no-explicit-any");
  });

  it("rejects a floating promise", () => {
    const rules = lint(
      path.join(root, "src/features/x/thing.ts"),
      "async function f(): Promise<void> {}\nf();\nexport {};\n",
    );
    expect(rules).toContain("@typescript-eslint/no-floating-promises");
  });

  it("rejects a non-exhaustive switch on a union", () => {
    const rules = lint(
      path.join(root, "src/features/x/thing.ts"),
      'type C = "A" | "B";\nexport function f(c: C): number {\n  switch (c) {\n    case "A":\n      return 1;\n  }\n  return 0;\n}\n',
    );
    expect(rules).toContain("@typescript-eslint/switch-exhaustiveness-check");
  });

  const nonNull = "const a: string | undefined = undefined;\nexport const b = a!;\n";

  it("rejects a non-null assertion in source", () => {
    const rules = lint(path.join(root, "src/features/x/thing.ts"), nonNull);
    expect(rules).toContain("@typescript-eslint/no-non-null-assertion");
  });

  it("allows a non-null assertion in a test file", () => {
    const rules = lint(path.join(root, "src/features/x/thing.test.ts"), nonNull);
    expect(rules).not.toContain("@typescript-eslint/no-non-null-assertion");
  });
});
