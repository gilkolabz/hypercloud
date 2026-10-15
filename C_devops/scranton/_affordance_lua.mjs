/**
 * rows_v1_schema.lua with its @config block filled in for one address affordance.
 *   rowsLua({ key: "comments", fields: { text: { max: 2000 } } })
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), "rows_v1_schema.lua");

const luaString = (s) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`affordance key/field must be an identifier: ${s}`);
  return `"${s}"`;
};

export function rowsLua({ key, fields }) {
  const entries = Object.entries(fields || {});
  if (!entries.length) throw new Error("rows affordance needs at least one field");
  const fieldLua = entries
    .map(([name, spec]) => {
      const min = Number.isInteger(spec?.min) ? spec.min : 1;
      const max = Number.isInteger(spec?.max) ? spec.max : 2000;
      if (min < 0 || max < min) throw new Error(`bad length range for ${name}`);
      return `${luaString(name).slice(1, -1)} = { min = ${min}, max = ${max} }`;
    })
    .join(", ");
  const src = fs.readFileSync(TEMPLATE, "utf8");
  const block = /-- @config\r?\n[\s\S]*?-- @end\r?\n/;
  if (!block.test(src)) throw new Error("rows_v1_schema.lua has no @config block");
  return src.replace(block, `-- @config\nlocal KEY = ${luaString(key)}\nlocal FIELDS = { ${fieldLua} }\n-- @end\n`);
}
