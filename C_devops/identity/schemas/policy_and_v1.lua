-- foobarch.schema.policy_and.v1
-- AND authorization across one or more child policy tips.
--
-- Policy tip data:
--   policies = { "policies/hypertext", "policies/foobarch-shell", … }
--     each entry is a tip ib or ib^gib addr
--   (optional) rel8ns.and_policy = same list as pinned addrs
--
-- For each child: load tip JSON, read keys + threshold, verify the same
-- sign_keys/signatures against that keyring (keys_v1 semantics). ALL must pass.
-- Child tips may themselves use keys_v1 schema; we only consume their keys params.

local function as_list(v)
  if type(v) ~= "table" then
    return {}
  end
  local out = {}
  if #v > 0 then
    for i = 1, #v do
      out[#out + 1] = v[i]
    end
    return out
  end
  for _, x in pairs(v) do
    out[#out + 1] = x
  end
  return out
end

local function resolve_child(ref)
  local api = foobarch or flowerpot
  if type(api) ~= "table" then
    return nil, "foobarch api missing"
  end
  ref = tostring(ref or "")
  if ref == "" then
    return nil, "empty policy ref"
  end
  local addr = ref
  if not string.find(ref, "^", 1, true) then
    if type(api.latest_addr) == "function" then
      addr = api.latest_addr(ref)
    end
    if not addr or addr == "" then
      return nil, "no tip for " .. ref
    end
  end
  local raw
  if type(api.fetch_frame) == "function" then
    raw = api.fetch_frame(addr)
  end
  if type(raw) ~= "string" or raw == "" then
    return nil, "no frame for " .. tostring(addr)
  end
  local decode = api.json_decode
  if type(decode) ~= "function" then
    return nil, "json_decode missing"
  end
  local frame, err = decode(raw)
  if type(frame) ~= "table" then
    return nil, err or "bad frame json"
  end
  local data = frame.data or {}
  local keys = as_list(data.keys)
  local threshold = data.threshold
  if type(threshold) ~= "number" or threshold < 1 then
    threshold = #keys
  end
  return {
    addr = addr,
    ib = frame.ib or ref,
    keys = keys,
    threshold = threshold,
  }
end

local function keys_ok(child)
  local keys = child.keys
  local threshold = child.threshold
  if type(keys) ~= "table" or #keys < 1 then
    return false, "policy.keys required", child
  end
  if threshold > #keys then
    return false, "invalid threshold", child
  end

  local sign_keys = ctx.sign_keys or {}
  local signatures = ctx.signatures or {}
  local used = {}
  local valid = 0
  local n = math.min(#sign_keys, #signatures)
  local verify = (foobarch and foobarch.verify_ed25519)
    or (flowerpot and flowerpot.verify_ed25519)
  if type(verify) ~= "function" then
    return false, "verify_ed25519 missing", child
  end

  for i = 1, n do
    local pub = sign_keys[i]
    local sig = signatures[i]
    if pub and sig and not used[pub] then
      local listed = false
      for _, k in ipairs(keys) do
        if k == pub then
          listed = true
          break
        end
      end
      if listed and verify(pub, ctx.message, sig) then
        used[pub] = true
        valid = valid + 1
      end
    end
  end

  if valid >= threshold then
    return true, nil, child
  end
  return false, "keys threshold not met", child, valid, threshold
end

local function child_refs()
  local list = as_list(ctx.policy and ctx.policy.policies)
  if #list > 0 then
    return list
  end
  -- Fallback: rel8ns on the policy tip itself (when host exposes them on policy).
  local pol = ctx.policy or {}
  if type(pol.and_policies) == "table" then
    return as_list(pol.and_policies)
  end
  return list
end

function authorize()
  local refs = child_refs()
  if #refs < 1 then
    return {
      allow = false,
      aside_ok = false,
      error = "policy_and: policies[] required",
    }
  end

  local passed = {}
  for _, ref in ipairs(refs) do
    local child, err = resolve_child(ref)
    if not child then
      return {
        allow = false,
        aside_ok = false,
        error = "policy_and: " .. tostring(err),
        ref = tostring(ref),
      }
    end
    local ok, why, _, valid, threshold = keys_ok(child)
    if not ok then
      return {
        allow = false,
        aside_ok = true,
        error = "policy_and: " .. tostring(why or "denied") .. " @ " .. tostring(child.ib),
        policy = child.ib,
        policy_addr = child.addr,
        valid = valid,
        threshold = threshold,
      }
    end
    passed[#passed + 1] = child.ib
  end

  return { allow = true, and_policies = passed }
end
