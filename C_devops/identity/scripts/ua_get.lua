-- scripts/ua_get
-- Shared UA / Accept classifier for foobarch_host http.kind=lua parks.
-- Parks point GET (or any verb) at this tip; THIS park's req.tip carries the menu.
--
-- Park data (either data.ua or data.http[METHOD].ua):
--   default        case id when nothing matches (default "default")
--   passthru_header / case_header  (defaults below)
--   map            { detected_id = case_id }  optional rename
--   cases          { [case_id] = action }
-- Action:
--   kind           "bin" | "park_request" | "body"   (default bin)
--   rel8n          rel8ns key whose [1] is "bin <sha>" or a tip addr
--   bin / sha      explicit bin sha (with or without "bin " prefix)
--   path, method   park_request
--   body, content_type, headers
--
-- Request headers (always lowercased into req.headers):
--   X-Navi-Ua-Passthru: 1     → cfg.passthru or cfg.default (no classify)
--   X-Navi-Ua-Case: <id>      → that case (unknown id → default)
--   Accept: …                 → prefer text/plain → case "text";
--                               prefer text/html  → case "html"
--                               (only when Accept clearly picks; else UA)
-- Host Accept: application/ibgib+json still skips Lua entirely (frame JSON).
--
-- Classifier ids: edge, ie, chrome, firefox, safari, opera, cli, curl, bot, unknown
-- Suggested case ids for mime split: html, text (map cli/curl → text).
-- Unknown / missing cfg / missing bin → default tip bin, never a Lua 500.

local PASSTHRU = "x-navi-ua-passthru"
local CASE_HDR = "x-navi-ua-case"

local function hdr(req, name)
  if type(req) ~= "table" or type(req.headers) ~= "table" then
    return ""
  end
  local v = req.headers[name] or req.headers[string.upper(name)]
  if v == nil then
    return ""
  end
  return string.lower(tostring(v))
end

local function truthy(s)
  s = tostring(s or "")
  return s == "1" or s == "true" or s == "yes" or s == "on"
end

local function contains(hay, needle)
  if hay == nil or needle == nil or needle == "" then
    return false
  end
  return string.find(tostring(hay), tostring(needle), 1, true) ~= nil
end

-- Order matters: Edge UA contains Chrome+Safari; Chrome UA contains Safari.
local function classify_ua(ua)
  ua = tostring(ua or "")
  if ua == "" then
    return "unknown"
  end
  local l = string.lower(ua)

  if contains(l, "navi_shell") or contains(l, "navi-shell") then
    return "cli"
  end
  if contains(l, "curl/") or l == "curl" then
    return "curl"
  end
  if contains(l, "wget/") or contains(l, "httpie") or contains(l, "httpie/") then
    return "cli"
  end
  if contains(l, "go-http-client") or contains(l, "python-requests")
      or contains(l, "python-urllib") or contains(l, "aiohttp")
      or contains(l, "libwww-perl") or contains(l, "java/") then
    return "cli"
  end
  -- Node / undici / pkg navi_shell.exe often look like this, not Mozilla.
  if contains(l, "undici") or contains(l, "node-fetch")
      or string.find(l, "^node/") or contains(l, " node/") then
    return "cli"
  end

  if contains(l, "bot") or contains(l, "crawler") or contains(l, "spider")
      or contains(l, "slurp") or contains(l, "bingpreview") then
    return "bot"
  end

  if contains(ua, "Edg/") or contains(ua, "EdgA/") or contains(ua, "EdgiOS/")
      or contains(l, "edg/") or contains(ua, "Edge/") then
    return "edge"
  end
  if contains(l, "trident") or contains(l, "msie ") then
    return "ie"
  end
  if contains(l, "opr/") or contains(l, "opera") then
    return "opera"
  end
  if contains(l, "firefox/") or contains(l, "fxios/") then
    return "firefox"
  end
  if contains(l, "chrome/") or contains(l, "crios/") or contains(l, "chromium") then
    return "chrome"
  end
  if contains(l, "safari/") and not contains(l, "chrome") then
    return "safari"
  end
  if contains(ua, "Mozilla") then
    return "chrome"
  end
  return "unknown"
end

-- Parse Accept; return "text", "html", or nil when inconclusive.
local function classify_accept(accept)
  accept = tostring(accept or "")
  if accept == "" then
    return nil
  end
  local plain_q, html_q = nil, nil
  local plain_seen, html_seen = false, false
  for part in string.gmatch(accept, "[^,]+") do
    local media = string.match(part, "^%s*([^;%s]+)")
    if media then
      media = string.lower(media)
      local q = 1
      local qs = string.match(part, "[;,]%s*q%s*=%s*([%d%.]+)")
      if qs then
        q = tonumber(qs) or 1
      end
      if media == "text/plain" or media == "text/*" then
        plain_seen = true
        if plain_q == nil or q > plain_q then
          plain_q = q
        end
      end
      if media == "text/html" or media == "application/xhtml+xml" then
        html_seen = true
        if html_q == nil or q > html_q then
          html_q = q
        end
      end
    end
  end
  if plain_seen and not html_seen then
    return "text"
  end
  if html_seen and not plain_seen then
    return "html"
  end
  if plain_seen and html_seen then
    plain_q = plain_q or 1
    html_q = html_q or 1
    if plain_q > html_q then
      return "text"
    end
    if html_q > plain_q then
      return "html"
    end
    -- Equal q: first listed wins (browse lists plain first; surf lists html first).
    local plain_i = string.find(accept, "text/plain", 1, true)
    local html_i = string.find(accept, "text/html", 1, true)
    if plain_i and html_i then
      if plain_i < html_i then
        return "text"
      end
      return "html"
    end
  end
  return nil
end

local function cfg_of(req)
  local data = req and req.tip and req.tip.data
  if type(data) ~= "table" then
    return nil
  end
  if type(data.ua) == "table" then
    return data.ua
  end
  local method = tostring(req.method or "GET")
  local http = data.http
  if type(http) == "table" then
    local ctrl = http[method] or http[string.upper(method)] or http[string.lower(method)]
    if type(ctrl) == "table" and type(ctrl.ua) == "table" then
      return ctrl.ua
    end
  end
  return nil
end

local function rel8_first(req, name)
  local rel8ns = req and req.tip and req.tip.rel8ns
  if type(rel8ns) ~= "table" or not name then
    return nil
  end
  local slot = rel8ns[name]
  if type(slot) == "table" then
    return slot[1] or slot["1"]
  end
  if type(slot) == "string" then
    return slot
  end
  return nil
end

local function bin_sha(ref)
  if ref == nil or ref == "" then
    return nil
  end
  local s = tostring(ref)
  s = string.gsub(s, "^bin%s+", "")
  s = string.gsub(s, "^%s+", "")
  s = string.gsub(s, "%s+$", "")
  if s == "" then
    return nil
  end
  return s
end

local function get_bin(sha)
  sha = bin_sha(sha)
  if not sha or type(foobarch) ~= "table" or type(foobarch.get_bin) ~= "function" then
    return nil
  end
  local ok, blob = pcall(foobarch.get_bin, sha)
  if ok and type(blob) == "table" and blob.body_b64 then
    return blob
  end
  return nil
end

local function serve_bin(sha, content_type, extra_headers)
  local blob = get_bin(sha)
  if not blob then
    return {
      status = 404,
      content_type = "text/plain; charset=utf-8",
      body = "ua_get: bin missing\n",
    }
  end
  local headers = { ["X-Navi-Ua-Script"] = "scripts/ua_get" }
  if type(extra_headers) == "table" then
    for k, v in pairs(extra_headers) do
      if v ~= nil then
        headers[tostring(k)] = tostring(v)
      end
    end
  end
  return {
    status = 200,
    content_type = content_type or blob.content_type or "application/octet-stream",
    body_b64 = blob.body_b64,
    headers = headers,
  }
end

local function serve_tip_bin(req, content_type, extra_headers)
  local ref = rel8_first(req, "bin")
  if not ref then
    return {
      status = 404,
      content_type = "text/plain; charset=utf-8",
      body = "ua_get: tip has no rel8ns.bin\n",
    }
  end
  return serve_bin(ref, content_type, extra_headers)
end

local function park_request(path, method)
  if type(foobarch) ~= "table" or type(foobarch.park_request) ~= "function" then
    return nil
  end
  local ok, nested = pcall(foobarch.park_request, tostring(path), method or "GET")
  if not ok or type(nested) ~= "table" then
    return nil
  end
  return nested
end

local function apply_action(req, action, case_id)
  if type(action) ~= "table" then
    local out = serve_tip_bin(req)
    out.headers = out.headers or {}
    out.headers["X-Navi-Ua-Case"] = case_id or "default"
    return out
  end
  local kind = string.lower(tostring(action.kind or "bin"))
  local extra = action.headers
  local mark = { ["X-Navi-Ua-Case"] = case_id or "default" }
  if type(extra) == "table" then
    for k, v in pairs(extra) do
      mark[tostring(k)] = tostring(v)
    end
  end

  if kind == "body" then
    return {
      status = tonumber(action.status) or 200,
      content_type = action.content_type or "text/plain; charset=utf-8",
      body = tostring(action.body or ""),
      headers = mark,
    }
  end

  if kind == "park_request" or kind == "redirect" then
    local path = action.path or action.target
    if path and path ~= "" then
      local nested = park_request(path, action.method)
      if nested then
        nested.headers = nested.headers or {}
        for k, v in pairs(mark) do
          nested.headers[k] = v
        end
        return nested
      end
    end
    local fallback = serve_tip_bin(req)
    fallback.headers = fallback.headers or {}
    fallback.headers["X-Navi-Ua-Case"] = case_id or "default"
    fallback.headers["X-Navi-Ua-Fallback"] = "park_request"
    return fallback
  end

  -- bin
  local sha = action.bin or action.sha
  if not sha then
    local rel8n = action.rel8n or action.rel8ns
    if rel8n then
      sha = rel8_first(req, rel8n)
    end
  end
  if not sha then
    sha = rel8_first(req, "bin")
  end
  local out = serve_bin(sha, action.content_type, mark)
  return out
end

function handle(req)
  req = req or {}
  local cfg = cfg_of(req)
  local detected = classify_ua(hdr(req, "user-agent"))
  local accept_case = classify_accept(hdr(req, "accept"))

  if type(cfg) ~= "table" then
    local out = serve_tip_bin(req)
    out.headers = out.headers or {}
    out.headers["X-Navi-Ua-Detected"] = detected
    if accept_case then
      out.headers["X-Navi-Ua-Accept"] = accept_case
    end
    out.headers["X-Navi-Ua-Case"] = "default"
    return out
  end

  local passthru_name = string.lower(tostring(cfg.passthru_header or PASSTHRU))
  local case_name = string.lower(tostring(cfg.case_header or CASE_HDR))
  local default_id = tostring(cfg.default or "default")
  local cases = type(cfg.cases) == "table" and cfg.cases or {}

  local case_id = default_id
  local via = "default"
  if truthy(hdr(req, passthru_name)) then
    case_id = tostring(cfg.passthru or default_id)
    via = "passthru"
  else
    local forced = hdr(req, case_name)
    if forced ~= "" then
      case_id = forced
      via = "header"
    elseif accept_case then
      case_id = accept_case
      via = "accept"
      if type(cfg.map) == "table" and cfg.map[accept_case] then
        case_id = tostring(cfg.map[accept_case])
      end
    else
      case_id = detected
      via = "ua"
      if type(cfg.map) == "table" and cfg.map[detected] then
        case_id = tostring(cfg.map[detected])
      end
    end
  end

  local action = cases[case_id]
  if type(action) ~= "table" then
    action = cases[default_id]
  end
  if type(action) ~= "table" then
    action = { kind = "bin" }
    case_id = default_id
  end

  local out = apply_action(req, action, case_id)
  out.headers = out.headers or {}
  out.headers["X-Navi-Ua-Detected"] = detected
  if accept_case then
    out.headers["X-Navi-Ua-Accept"] = accept_case
  end
  out.headers["X-Navi-Ua-Via"] = via
  out.headers["X-Navi-Ua-Case"] = case_id
  out.headers["X-Navi-Ua-Script"] = "scripts/ua_get"
  return out
end
