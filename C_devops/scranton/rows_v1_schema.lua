-- scranton rows affordance v1
-- Write gate for address affordance frames that hold signed rows (comments/{page}, stagedir/{page}, …).
-- Policy tip: scranton/affordance/v1/<name>/policy → rel8ns.schema → this Lua, with the config
-- block below filled in per affordance by C_devops/scranton/_affordance_lua.mjs.
-- Frame data[KEY] = {
--   affordance, page, lobby, created_at, creator,
--   rows[] = { <FIELDS…>, by, at }   -- string fields only, signed by `by`
-- }
-- Anyone may create the frame (no governor): readers trust it only when its first generation
-- already named this policy and had no rows. Every mut8 is a whitelist against the parent:
--   * data: only data[KEY], data.n (= parent n + 1) and data.timestamp may differ.
--   * rel8ns: only rel8ns.past may differ, and it must be exactly { parent addr }.
--   * data[KEY]: only rows may differ.
--   * rows: push exactly one row with by = signer, or delete exactly one row you wrote.

-- @config
local KEY = "comments"
local FIELDS = { text = { min = 1, max = 2000 } }
-- @end

local SHORT_MAX = 64
local KEY_MAX = 512

local function deep_equal(a, b)
  if type(a) ~= type(b) then
    return false
  end
  if type(a) ~= "table" then
    return a == b
  end
  for k, v in pairs(a) do
    if not deep_equal(v, b[k]) then
      return false
    end
  end
  for k, _ in pairs(b) do
    if a[k] == nil then
      return false
    end
  end
  return true
end

local function without(t, drop)
  local o = {}
  if type(t) ~= "table" then
    return o
  end
  for k, v in pairs(t) do
    if not drop[k] then
      o[k] = v
    end
  end
  return o
end

local function list_of(t)
  if type(t) ~= "table" then
    return {}
  end
  return t
end

local function deny(msg)
  return { allow = false, aside_ok = false, error = msg }
end

local function verify_any()
  local sign_keys = ctx.sign_keys or {}
  local signatures = ctx.signatures or {}
  local n = math.min(#sign_keys, #signatures)
  local verify = (foobarch and foobarch.verify_ed25519)
    or (flowerpot and flowerpot.verify_ed25519)
  if type(verify) ~= "function" then
    return nil, "verify_ed25519 unavailable"
  end
  if type(ctx.message) ~= "string" or ctx.message == "" then
    return nil, "missing write message"
  end
  for i = 1, n do
    local pub = sign_keys[i]
    local sig = signatures[i]
    if type(pub) == "string" and pub ~= "" and type(sig) == "string" and sig ~= "" then
      if verify(pub, ctx.message, sig) then
        return pub
      end
    end
  end
  return nil, "no valid signature"
end

local function decode_body()
  local raw = foobarch.body()
  if type(raw) ~= "string" or raw == "" then
    return nil, "empty body"
  end
  local env = json_decode(raw)
  if type(env) ~= "table" or type(env.newIbGib) ~= "table" then
    return nil, "missing newIbGib"
  end
  return env.newIbGib
end

local function parent_frame()
  local addr = ctx.parent_addr
  if type(addr) ~= "string" or addr == "" then
    return nil, "missing parent_addr"
  end
  local raw = foobarch.fetch_frame(addr)
  if type(raw) ~= "string" or raw == "" then
    return nil, "cannot fetch parent frame"
  end
  local frame = json_decode(raw)
  if type(frame) ~= "table" or type(frame.data) ~= "table" or type(frame.data[KEY]) ~= "table" then
    return nil, "parent missing data." .. KEY
  end
  return frame
end

local function check_row(row, signer)
  if type(row) ~= "table" then
    return "row must be an object"
  end
  for k, _ in pairs(row) do
    if k ~= "by" and k ~= "at" and not FIELDS[k] then
      return "row field not allowed: " .. tostring(k)
    end
  end
  for name, spec in pairs(FIELDS) do
    local v = row[name]
    local lo = spec.min or 1
    local hi = spec.max or 2000
    if type(v) ~= "string" or #v < lo or #v > hi then
      return "row " .. name .. " must be " .. lo .. ".." .. hi .. " characters"
    end
  end
  if type(row.by) ~= "string" or row.by == "" or #row.by > KEY_MAX then
    return "row needs by"
  end
  if row.by ~= signer then
    return "row by must equal signer"
  end
  if type(row.at) ~= "string" or #row.at > SHORT_MAX then
    return "row at must be a short string"
  end
  return nil
end

function authorize()
  local signer, serr = verify_any()
  if not signer then
    return deny(serr or "unsigned")
  end
  local nib, berr = decode_body()
  if not nib then
    return deny(berr)
  end
  if type(nib.data) ~= "table" or type(nib.data[KEY]) ~= "table" then
    return deny("newIbGib.data." .. KEY .. " required")
  end
  local pf, perr = parent_frame()
  if not pf then
    return deny(perr)
  end

  local frozen = { [KEY] = true, n = true, timestamp = true }
  if not deep_equal(without(pf.data, frozen), without(nib.data, frozen)) then
    return deny("only data." .. KEY .. ", data.n and data.timestamp may change")
  end
  if tonumber(nib.data.n) ~= (tonumber(pf.data.n) or 0) + 1 then
    return deny("data.n must be parent n + 1")
  end
  if type(nib.data.timestamp) ~= "string" or #nib.data.timestamp > SHORT_MAX then
    return deny("data.timestamp must be a short string")
  end
  if not deep_equal(without(pf.rel8ns, { past = true }), without(nib.rel8ns, { past = true })) then
    return deny("only rel8ns.past may change")
  end
  local past = type(nib.rel8ns) == "table" and nib.rel8ns.past or nil
  if type(past) ~= "table" or #past ~= 1 or past[1] ~= ctx.parent_addr or next(past, 1) ~= nil then
    return deny("rel8ns.past must be exactly the parent addr")
  end

  local prev = pf.data[KEY]
  local nextC = nib.data[KEY]
  if not deep_equal(without(prev, { rows = true }), without(nextC, { rows = true })) then
    return deny("only data." .. KEY .. ".rows may change")
  end
  local pr = list_of(prev.rows)
  local nr = nextC.rows
  if type(nr) ~= "table" then
    return deny("rows required")
  end

  if #nr == #pr + 1 then
    for i = 1, #pr do
      if not deep_equal(pr[i], nr[i]) then
        return deny("push must keep prior rows intact")
      end
    end
    local err = check_row(nr[#nr], signer)
    if err then
      return deny(err)
    end
    return { allow = true, action = "push" }
  end

  if #nr == #pr - 1 then
    local removed = nil
    local j = 1
    for i = 1, #pr do
      if nr[j] ~= nil and deep_equal(nr[j], pr[i]) then
        j = j + 1
      elseif removed then
        return deny("delete must remove exactly one row")
      else
        removed = pr[i]
      end
    end
    if not removed or j ~= #nr + 1 then
      return deny("delete mismatch")
    end
    if type(removed) ~= "table" or removed.by ~= signer then
      return deny("only the row's author may delete it")
    end
    return { allow = true, action = "delete" }
  end

  return deny("push one row or delete one row")
end
