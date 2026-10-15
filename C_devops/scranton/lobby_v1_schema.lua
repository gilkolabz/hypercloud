-- scranton_lobby_v1
-- Write gate for lobby tips: roster (join/leave/OP kick) + append index CRUD.
-- Policy tip: scranton/lobby/v1/policy → rel8ns.schema → this Lua.
-- Lobby tip data.lobby = {
--   contract, path, created_at, creator,
--   roster[pubkey] = { joined_at, ts },
--   append[] = { addr, by, at }   -- ib^gib notice board
-- }
-- Every mut8 is a whitelist against the parent frame:
--   * data: only data.lobby, data.n (= parent n + 1) and data.timestamp may differ.
--   * rel8ns: only rel8ns.past may differ, and it must be exactly { parent addr }.
--   * data.lobby: only roster OR append may differ (one concern per mut8); everything
--     else is byte-for-byte the parent's, except a legacy `op` may be renamed `creator`
--     (same pubkey).
--   * roster: join one { joined_at, ts } entry (signed by that key), leave self, or OP kick;
--     untouched entries stay identical.
--   * append: push / delete / update exactly one { addr, by, at } row; addr is ib^gib;
--     push sets by = signer; OP may delete/update any row, authors their own.
-- firstGen: the governor tip scranton/lobby/v1 names this policy as rel8ns.genesis_policy, so the
-- host runs authorize_genesis() for every new lobby: the frame must be exactly the client template,
-- rel8ns exactly { policy = { scranton/lobby/v1/policy } }, creator = signer, roster = just the
-- creator, append empty.

local CONTRACT = "scranton_lobby_v1"
local LOBBY_ROOT = "scranton/lobby/v1"
local POLICY_IB = LOBBY_ROOT .. "/policy"
local ADDR_MAX = 512
local SHORT_MAX = 64
local CREATE_DATA = {
  parts = { "network_proposal", "ibgib_frame", "manifest", "json" },
  park = "defer",
  contract = CONTRACT,
  about = { label = CONTRACT, description = "Scranton lobby v1 — roster + append ib^gib index" },
  default_method = "GET",
  method = { GET = { kind = "frame" }, PUT = { kind = "commit" }, PATCH = { kind = "commit" } },
  n = 0,
}
local CREATE_REL8NS = { policy = { POLICY_IB }, past = {}, tjp = {}, dna = {} }

local function op_of(lobby)
  return tostring(lobby.creator or lobby.op or "")
end

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

local function only_keys(t, allowed)
  for k, _ in pairs(t) do
    if not allowed[k] then
      return false, tostring(k)
    end
  end
  return true
end

local function short_string(v)
  return type(v) == "string" and #v <= SHORT_MAX
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
  if type(env) ~= "table" then
    return nil, "body not JSON"
  end
  local nib = env.newIbGib
  if type(nib) ~= "table" then
    return nil, "missing newIbGib"
  end
  return nib
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
  if type(frame) ~= "table" or type(frame.data) ~= "table" then
    return nil, "parent frame invalid"
  end
  if type(frame.data.lobby) ~= "table" then
    return nil, "parent missing data.lobby"
  end
  return frame
end

local function list_of(t)
  if type(t) ~= "table" then
    return {}
  end
  return t
end

local function check_row(row)
  if type(row) ~= "table" then
    return "append row must be an object"
  end
  local ok, bad = only_keys(row, { addr = true, by = true, at = true })
  if not ok then
    return "append row field not allowed: " .. bad
  end
  if type(row.addr) ~= "string" or #row.addr > ADDR_MAX
    or not row.addr:match("^[^%s%^]+%^[^%s%^]+$") then
    return "append addr must be ib^gib"
  end
  if type(row.by) ~= "string" or row.by == "" or #row.by > ADDR_MAX then
    return "append row needs by"
  end
  if not short_string(row.at) then
    return "append row at must be a short string"
  end
  return nil
end

local function check_entry(entry)
  if type(entry) ~= "table" then
    return "roster entry required"
  end
  local ok, bad = only_keys(entry, { joined_at = true, ts = true })
  if not ok then
    return "roster entry field not allowed: " .. bad
  end
  if not short_string(entry.joined_at) then
    return "roster entry needs joined_at"
  end
  if type(entry.ts) ~= "number" and not short_string(entry.ts) then
    return "roster entry needs ts"
  end
  return nil
end

local function roster_keys(roster)
  local keys = {}
  for k, _ in pairs(list_of(roster)) do
    if type(k) == "string" and k ~= "" then
      keys[#keys + 1] = k
    end
  end
  table.sort(keys)
  return keys
end

local function deny(msg)
  return { allow = false, aside_ok = false, error = msg }
end

local function authorize_roster(signer, prev, nextL)
  local pr = list_of(prev.roster)
  local nr = list_of(nextL.roster)
  local added, removed = {}, {}
  for _, k in ipairs(roster_keys(nr)) do
    if pr[k] == nil then
      added[#added + 1] = k
    elseif not deep_equal(pr[k], nr[k]) then
      return deny("existing roster entries may not change")
    end
  end
  for _, k in ipairs(roster_keys(pr)) do
    if nr[k] == nil then
      removed[#removed + 1] = k
    end
  end

  if #added == 1 and #removed == 0 then
    local pub = added[1]
    if pub ~= signer then
      return deny("join must be signed by joining pubkey")
    end
    local err = check_entry(nr[pub])
    if err then
      return deny(err)
    end
    return { allow = true, action = "join", pubkey = pub }
  end

  if #added == 0 and #removed == 1 then
    local pub = removed[1]
    if pub == signer then
      return { allow = true, action = "leave", pubkey = pub }
    end
    if signer == op_of(prev) then
      return { allow = true, action = "kick", pubkey = pub, by = signer }
    end
    return deny("only self (leave) or OP (kick) may remove a pubkey")
  end

  return deny("illegal roster diff (join one / leave-or-kick one only)")
end

local function authorize_append(signer, prev, nextL)
  local pa = list_of(prev.append)
  local na = list_of(nextL.append)
  local op = op_of(prev)

  if #na == #pa + 1 then
    for i = 1, #pa do
      if not deep_equal(pa[i], na[i]) then
        return deny("append push must keep prior rows intact")
      end
    end
    local row = na[#na]
    local err = check_row(row)
    if err then
      return deny(err)
    end
    if row.by ~= signer then
      return deny("append push by must equal signer")
    end
    return { allow = true, action = "append_push", addr = row.addr }
  end

  if #na == #pa - 1 then
    local removed = nil
    local j = 1
    for i = 1, #pa do
      if na[j] ~= nil and deep_equal(na[j], pa[i]) then
        j = j + 1
      elseif removed then
        return deny("append delete must remove exactly one row")
      else
        removed = pa[i]
      end
    end
    if not removed or j ~= #na + 1 then
      return deny("append delete mismatch")
    end
    local by = type(removed) == "table" and removed.by or nil
    if by == signer or signer == op then
      return { allow = true, action = "append_delete" }
    end
    return deny("only row author or lobby OP may delete append row")
  end

  if #na == #pa and #na > 0 then
    local changed = nil
    for i = 1, #pa do
      if not deep_equal(pa[i], na[i]) then
        if changed then
          return deny("append update must change exactly one row")
        end
        changed = i
      end
    end
    if not changed then
      return deny("no append change")
    end
    local err = check_row(na[changed])
    if err then
      return deny(err)
    end
    local before = type(pa[changed]) == "table" and pa[changed].by or nil
    if before ~= na[changed].by then
      return deny("append row by is immutable")
    end
    if before == signer or signer == op then
      return { allow = true, action = "append_update", index = changed, addr = na[changed].addr }
    end
    return deny("only row author or lobby OP may update append row")
  end

  return deny("illegal append diff (push one / delete one / update one)")
end

function authorize_genesis()
  local signer, serr = verify_any()
  if not signer then
    return deny(serr or "unsigned")
  end
  local nib, berr = decode_body()
  if not nib then
    return deny(berr)
  end
  if nib.ib ~= ctx.ib then
    return deny("newIbGib.ib must match the address")
  end
  if type(nib.data) ~= "table" or type(nib.data.lobby) ~= "table" then
    return deny("newIbGib.data.lobby required")
  end
  if not deep_equal(without(nib.data, { lobby = true, timestamp = true }), CREATE_DATA) then
    return deny("new lobby data must match the scranton_lobby_v1 template")
  end
  if not short_string(nib.data.timestamp) then
    return deny("data.timestamp must be a short string")
  end
  if not deep_equal(nib.rel8ns, CREATE_REL8NS) then
    return deny("new lobby rel8ns must be exactly { policy = { " .. POLICY_IB .. " } }")
  end

  local l = nib.data.lobby
  local ok, bad = only_keys(l, {
    contract = true, path = true, created_at = true, creator = true, roster = true, append = true,
  })
  if not ok then
    return deny("lobby field not allowed: " .. bad)
  end
  if l.contract ~= CONTRACT then
    return deny("contract must be " .. CONTRACT)
  end
  if type(l.path) ~= "string" or ctx.ib ~= LOBBY_ROOT .. "/" .. l.path then
    return deny("lobby.path must match the address")
  end
  if not short_string(l.created_at) then
    return deny("lobby.created_at must be a short string")
  end
  if l.creator ~= signer then
    return deny("creator must be the signer")
  end
  local keys = roster_keys(l.roster)
  if type(l.roster) ~= "table" or #keys ~= 1 or keys[1] ~= signer then
    return deny("new lobby roster must be just the creator")
  end
  local count = 0
  for _ in pairs(l.roster) do
    count = count + 1
  end
  if count ~= 1 then
    return deny("new lobby roster must be just the creator")
  end
  local err = check_entry(l.roster[signer])
  if err then
    return deny(err)
  end
  if type(l.append) ~= "table" or next(l.append) ~= nil then
    return deny("new lobby append must be empty")
  end
  return { allow = true, action = "create", pubkey = signer }
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
  if type(nib.data) ~= "table" or type(nib.data.lobby) ~= "table" then
    return deny("newIbGib.data.lobby required")
  end

  local pf, perr = parent_frame()
  if not pf then
    return deny(perr)
  end
  local prev = pf.data.lobby
  local nextL = nib.data.lobby
  if prev.contract ~= CONTRACT or nextL.contract ~= CONTRACT then
    return deny("contract must be " .. CONTRACT)
  end

  -- data: only lobby, n, timestamp may change
  local frozen = { lobby = true, n = true, timestamp = true }
  if not deep_equal(without(pf.data, frozen), without(nib.data, frozen)) then
    return deny("only data.lobby, data.n and data.timestamp may change")
  end
  if tonumber(nib.data.n) ~= (tonumber(pf.data.n) or 0) + 1 then
    return deny("data.n must be parent n + 1")
  end
  if not short_string(nib.data.timestamp) then
    return deny("data.timestamp must be a short string")
  end

  -- rel8ns: only past may change, and it must be exactly the parent
  if not deep_equal(without(pf.rel8ns, { past = true }), without(nib.rel8ns, { past = true })) then
    return deny("only rel8ns.past may change")
  end
  local past = type(nib.rel8ns) == "table" and nib.rel8ns.past or nil
  if type(past) ~= "table" or #past ~= 1 or past[1] ~= ctx.parent_addr or next(past, 1) ~= nil then
    return deny("rel8ns.past must be exactly the parent addr")
  end

  -- lobby: everything but roster/append fixed (legacy op may become creator)
  local fixed = { roster = true, append = true, op = true, creator = true }
  if not deep_equal(without(prev, fixed), without(nextL, fixed)) then
    return deny("only data.lobby.roster or data.lobby.append may change")
  end
  if op_of(prev) == "" or op_of(prev) ~= op_of(nextL) then
    return deny("creator immutable")
  end
  if nextL.op ~= nil and nextL.op ~= prev.op then
    return deny("creator immutable")
  end
  if type(nextL.roster) ~= "table" or type(nextL.append) ~= "table" then
    return deny("lobby.roster and lobby.append required")
  end

  local rosterChanged = not deep_equal(list_of(prev.roster), nextL.roster)
  local appendChanged = not deep_equal(list_of(prev.append), nextL.append)
  if rosterChanged and appendChanged then
    return deny("mut8 must change roster or append, not both")
  end
  if not rosterChanged and not appendChanged then
    return deny("no lobby change")
  end
  if rosterChanged then
    return authorize_roster(signer, prev, nextL)
  end
  return authorize_append(signer, prev, nextL)
end
