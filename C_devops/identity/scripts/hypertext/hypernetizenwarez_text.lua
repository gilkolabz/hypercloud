-- scripts/hypertext/hypernetizenwarez_text
-- Plain-text warez table for Accept: text/plain / cli (via ua_get park_request).
-- Lists hypernetizen/warez frames without nested park_request per manifest
-- (hop limits); ib leaf + frame addr are enough for browse/mount.

local WAREZ_PATH = "hypernetizen/warez"

local function api()
  return foobarch or flowerpot
end

local function decode(s)
  local a = api()
  if type(a) ~= "table" or type(a.json_decode) ~= "function" then
    return nil, "json_decode missing"
  end
  return a.json_decode(tostring(s or ""))
end

local function split_addr(addr)
  local s = tostring(addr or "")
  local caret = string.find(s, "^", 1, true)
  if caret and caret > 1 then
    return string.sub(s, 1, caret - 1), string.sub(s, caret + 1)
  end
  return s, ""
end

local function leaf_name(pathOrName)
  local s = tostring(pathOrName or "")
  if s == "" then
    return ""
  end
  local base = s
  local i = string.find(s, "/[^/]*$")
  if i then
    base = string.sub(s, i + 1)
  end
  base = string.gsub(base, "%.js$", "")
  return base
end

local function fetch_warez()
  local a = api()
  if type(a) ~= "table" or type(a.park_request) ~= "function" then
    return nil, "park_request missing"
  end
  local ok, res = pcall(a.park_request, WAREZ_PATH, "GET")
  if not ok or type(res) ~= "table" then
    return nil, "park_request failed"
  end
  local status = tonumber(res.status) or 0
  local body = res.body or ""
  if status < 200 or status >= 300 then
    return nil, "HTTP " .. tostring(status) .. " " .. tostring(body):sub(1, 120)
  end
  if body == "" then
    return nil, "empty warez body"
  end
  local tip, err = decode(body)
  if type(tip) ~= "table" then
    return nil, err or "warez not JSON"
  end
  return tip
end

function handle(req)
  req = req or {}
  local lines = {
    "Hypernetizen Warez (text)",
    "",
    "Approved mods — from navi_shell.exe REPL:",
    "  browse <park>            |  mount <park>",
    "  (park = hostpark mod tip; name shown below)",
    "",
  }

  local tip, err = fetch_warez()
  if not tip then
    return {
      status = 502,
      content_type = "text/plain; charset=utf-8",
      body = table.concat(lines, "\n")
        .. "error loading warez tip: "
        .. tostring(err)
        .. "\n",
      headers = { ["X-Navi-Ua-Script"] = "scripts/hypertext/hypernetizenwarez_text" },
    }
  end

  local frames = tip.frames
  if type(frames) ~= "table" and tip.rel8ns then
    frames = tip.rel8ns.frames
  end
  if type(frames) ~= "table" then
    frames = {}
  end

  local list = {}
  if #frames > 0 then
    for i = 1, #frames do
      list[#list + 1] = frames[i]
    end
  else
    for _, v in pairs(frames) do
      list[#list + 1] = v
    end
  end

  lines[#lines + 1] = string.format("%-4s %-28s %s", "#", "name", "manifest ib")
  lines[#lines + 1] = string.rep("-", 72)

  local n = 0
  for _, frame_addr in ipairs(list) do
    n = n + 1
    local ib = select(1, split_addr(frame_addr))
    local name = leaf_name(ib)
    lines[#lines + 1] = string.format("[%d]  %-26s %s", n, name, ib)
  end

  if n == 0 then
    lines[#lines + 1] = "(no frames on hypernetizen/warez)"
  end

  lines[#lines + 1] = ""
  lines[#lines + 1] = "  [back] welcome → hypertext/welcome"
  lines[#lines + 1] = ""

  return {
    status = 200,
    content_type = "text/plain; charset=utf-8",
    body = table.concat(lines, "\n"),
    headers = { ["X-Navi-Ua-Script"] = "scripts/hypertext/hypernetizenwarez_text" },
  }
end
