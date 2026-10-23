/**
 * @jest-environment node
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const eslintBin = path.join(root, "node_modules/eslint/bin/eslint.js");

interface EslintReport {
  messages: { ruleId: string | null }[];
}

// ESLint 9 loads its flat config with a dynamic import, which Jest's VM blocks, so lint in a child process.
function lint(filePath: string, code: string): Promise<string[]> {
  const run = spawnSync(
    process.execPath,
    [eslintBin, "--stdin", "--stdin-filename", filePath, "--format", "json"],
    { cwd: root, input: code, encoding: "utf8" },
  );
  const reports = JSON.parse(run.stdout) as EslintReport[];
  return Promise.resolve((reports[0]?.messages ?? []).map((m) => m.ruleId ?? ""));
}

describe("lint rules the whole app relies on (LOG-08)", () => {
  it("rejects console.log outside src/lib/log.ts", async () => {
    const rules = await lint(path.join(root, "src/features/x/thing.ts"), 'console.log("x");\nexport {};\n');
    expect(rules).toContain("no-console");
  });

  it("allows console inside src/lib/log.ts", async () => {
    const rules = await lint(path.join(root, "src/lib/log.ts"), 'console.log("x");\nexport {};\n');
    expect(rules).not.toContain("no-console");
  });

  it("rejects any", async () => {
    const rules = await lint(path.join(root, "src/features/x/thing.ts"), "export const a: any = 1;\n");
    expect(rules).toContain("@typescript-eslint/no-explicit-any");
  });

  it("rejects a floating promise", async () => {
    const rules = await lint(
      path.join(root, "src/features/x/thing.ts"),
      "async function f(): Promise<void> {}\nf();\nexport {};\n",
    );
    expect(rules).toContain("@typescript-eslint/no-floating-promises");
  });

  it("rejects a non-exhaustive switch on a union", async () => {
    const rules = await lint(
      path.join(root, "src/features/x/thing.ts"),
      'type C = "A" | "B";\nexport function f(c: C): number {\n  switch (c) {\n    case "A":\n      return 1;\n  }\n  return 0;\n}\n',
    );
    expect(rules).toContain("@typescript-eslint/switch-exhaustiveness-check");
  });
});
