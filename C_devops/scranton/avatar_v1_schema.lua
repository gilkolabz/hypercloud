-- scranton_avatar_v1
-- Write gate for avi tips: scranton/avatar/{pubkey}
-- Policy: scranton/avatar/policy → this Lua.
-- Governor: scranton/avatar (rel8ns.genesis_policy) — firstGen under the prefix
-- must be an avi for the signer. schema / policy / mod were planted first.
--
-- data.avi = { contract, pubkey, alias, name, color, bio, style }
-- rel8ns.bin = optional one thumbnail (GET kind bin)
-- rel8ns.links = optional ib^gib relationship pointers
-- Only the matching pubkey may create or mut8.

local CONTRACT = "scranton_avatar_v1"
local ROOT = "scranton/avatar"
local POLICY_IB = ROOT .. "/policy"
local ALIAS_MAX = 64
local NAME_MAX = 64
local BIO_MAX = 280
local STYLE_MAX = 128
local LINKS_MAX = 16

local CREATE_DATA = {
  parts = { "network_proposal", "ibgib_frame", "manifest", "json" },
  park = "defer",
  contract = CONTRACT,
  content_type = "image/png",
  default_method = "GET",
  method = {
    GET = { kind = "bin" },
    PUT = { kind = "commit" },
    PATCH = { kind = "commit" },
  },
  n = 0,
}

local function deep_equal(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= "table" then return a == b end
  for k, v in pairs(a) do
    if not deep_equal(v, b[k]) then return false end
  end
  for k, _ in pairs(b) do
    if a[k] == nil then return false end
  end
  return true
end

local function without(t, drop)
  local o = {}
  if type(t) ~= "table" then return o end
  for k, v in pairs(t) do
    if not drop[k] then o[k] = v end
  end
  return o
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
  if type(env) ~= "table" then return nil, "body not JSON" end
  local nib = env.newIbGib
  if type(nib) ~= "table" then return nil, "missing newIbGib" end
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
  if type(frame.data.avi) ~= "table" then
    return nil, "parent missing data.avi"
  end
  return frame
end

local function str_max(v, max)
  return type(v) == "string" and #v <= max
end

local function hex_color(v)
  if type(v) ~= "string" then return false end
  return v:match("^#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]$") ~= nil
end

local function bin_ref(s)
  return type(s) == "string" and s:match("^bin [0-9a-f]+$") ~= nil and #s == 68
end

local function addr_ref(s)
  return type(s) == "string" and s:match("^.+%^[0-9A-F]+$") ~= nil
end

local function check_avi(avi, signer, ib)
  if type(avi) ~= "table" then return "data.avi required" end
  for k, _ in pairs(avi) do
    if k ~= "contract" and k ~= "pubkey" and k ~= "alias" and k ~= "name"
      and k ~= "color" and k ~= "bio" and k ~= "style" then
      return "avi field not allowed: " .. tostring(k)
    end
  end
  if avi.contract ~= CONTRACT then return "contract must be " .. CONTRACT end
  if avi.pubkey ~= signer then return "avi.pubkey must be the signer" end
  if ib ~= ROOT .. "/" .. signer then return "ib must be scranton/avatar/{signer pubkey}" end
  if not str_max(avi.alias, ALIAS_MAX) then return "alias must be a string ≤ " .. ALIAS_MAX end
  if not str_max(avi.name, NAME_MAX) then return "name must be a string ≤ " .. NAME_MAX end
  if not hex_color(avi.color) then return "color must be #rrggbb" end
  if not str_max(avi.bio, BIO_MAX) then return "bio must be a string ≤ " .. BIO_MAX end
  if avi.style ~= nil and not str_max(avi.style, STYLE_MAX) then
    return "style must be a string ≤ " .. STYLE_MAX
  end
  return nil
end

local function check_rel8ns(rel, parent_past)
  if type(rel) ~= "table" then return "rel8ns required" end
  local pol = rel.policy
  if type(pol) ~= "table" or #pol ~= 1 or pol[1] ~= POLICY_IB then
    return "rel8ns.policy must be { " .. POLICY_IB .. " }"
  end
  local past = rel.past
  if parent_past then
    if type(past) ~= "table" or #past ~= 1 or past[1] ~= parent_past then
      return "rel8ns.past must be exactly the parent addr"
    end
  else
    if type(past) ~= "table" or next(past) ~= nil then
      return "new avi past must be empty"
    end
  end
  local tjp = rel.tjp
  local dna = rel.dna
  if tjp ~= nil and (type(tjp) ~= "table" or next(tjp) ~= nil) then
    return "rel8ns.tjp must be empty"
  end
  if dna ~= nil and (type(dna) ~= "table" or next(dna) ~= nil) then
    return "rel8ns.dna must be empty"
  end
  local bin = rel.bin
  if bin ~= nil then
    if type(bin) ~= "table" or #bin > 1 then return "rel8ns.bin at most one thumbnail" end
    if #bin == 1 and not bin_ref(bin[1]) then return "rel8ns.bin must be bin <sha256>" end
  end
  local links = rel.links
  if links ~= nil then
    if type(links) ~= "table" then return "rel8ns.links must be a list" end
    local n = 0
    for i, a in ipairs(links) do
      n = i
      if not addr_ref(a) then return "link must be ib^gib" end
    end
    if n > LINKS_MAX then return "too many links" end
    for k, _ in pairs(links) do
      if type(k) ~= "number" then return "rel8ns.links must be a list" end
    end
  end
  for k, _ in pairs(rel) do
    if k ~= "policy" and k ~= "past" and k ~= "tjp" and k ~= "dna" and k ~= "bin" and k ~= "links" then
      return "rel8n not allowed: " .. tostring(k)
    end
  end
  return nil
end

function authorize_genesis()
  local signer, serr = verify_any()
  if not signer then return deny(serr or "unsigned") end
  local nib, berr = decode_body()
  if not nib then return deny(berr) end
  if nib.ib ~= ctx.ib then return deny("newIbGib.ib must match the address") end
  if type(nib.data) ~= "table" then return deny("data required") end
  if not deep_equal(without(nib.data, { avi = true, timestamp = true }), CREATE_DATA) then
    return deny("new avi data must match the scranton_avatar_v1 template")
  end
  if type(nib.data.timestamp) ~= "string" or #nib.data.timestamp > 64 then
    return deny("data.timestamp must be a short string")
  end
  local err = check_avi(nib.data.avi, signer, nib.ib)
  if err then return deny(err) end
  err = check_rel8ns(nib.rel8ns, nil)
  if err then return deny(err) end
  return { allow = true, action = "create", pubkey = signer }
end

function authorize()
  local signer, serr = verify_any()
  if not signer then return deny(serr or "unsigned") end
  local nib, berr = decode_body()
  if not nib then return deny(berr) end
  local parent, perr = parent_frame()
  if not parent then return deny(perr) end
  if nib.ib ~= ctx.ib then return deny("newIbGib.ib must match the address") end
  if type(nib.data) ~= "table" then return deny("data required") end
  if not deep_equal(without(nib.data, { avi = true, n = true, timestamp = true }), without(parent.data, { avi = true, n = true, timestamp = true })) then
    return deny("only data.avi, data.n and data.timestamp may change")
  end
  local want_n = (parent.data.n or 0) + 1
  if nib.data.n ~= want_n then return deny("n must be parent n + 1") end
  if type(nib.data.timestamp) ~= "string" or #nib.data.timestamp > 64 then
    return deny("data.timestamp must be a short string")
  end
  local err = check_avi(nib.data.avi, signer, nib.ib)
  if err then return deny(err) end
  if parent.data.avi.pubkey ~= signer then
    return deny("only the avi pubkey may mut8")
  end
  err = check_rel8ns(nib.rel8ns, ctx.parent_addr)
  if err then return deny(err) end
  return { allow = true, action = "mut8", pubkey = signer }
end
