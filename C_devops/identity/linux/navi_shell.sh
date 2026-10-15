#!/usr/bin/env bash
# Bootstrap: install navi_shell on Linux from foobarch hostpark.
#   curl -fsSL https://foobarch.net/torus/linux/navi_shell.sh | bash
#
# Cross-pkg ELF from Windows can hit V8 bytecode errors. This installer
# runs Node 22 + navi_shell_localnavi.cjs. The host build
# (navi_shell_host_localnavi.cjs, embedded hostparkinator) is installed beside it
# for navis that host. The pkg ELF is only fetched with NAVI_USE_ELF=1.
#
# Re-running updates in place; files being replaced are kept as *.bak-<date>.
# Restart the navi afterwards so it loads the new build.
#   curl -fsSL https://foobarch.net/torus/linux/navi_shell.sh | NAVI_INSTALL_DIR=/opt/navi_sprinter bash
#
# Env:
#   NAVI_ORIGIN        default https://foobarch.net
#   NAVI_INSTALL_DIR   default /opt/navi
#   NAVI_USE_ELF=1     fetch and run the pkg binary instead of node+cjs
set -euo pipefail

ORIGIN="${NAVI_ORIGIN:-https://foobarch.net}"
ORIGIN="${ORIGIN%/}"
DEST_DIR="${NAVI_INSTALL_DIR:-/opt/navi}"
BIN_NAME="navi_shell-linux-x64"
CJS_NAME="navi_shell_localnavi.cjs"
HOST_NAME="navi_shell_host_localnavi.cjs"
DEST="${DEST_DIR}/${BIN_NAME}"
CJS_DEST="${DEST_DIR}/${CJS_NAME}"
WRAPPER="${DEST_DIR}/navi"
STAMP="$(date +%Y%m%d-%H%M%S)"

if ! command -v curl >/dev/null 2>&1; then
  echo "navi_shell.sh: need curl" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"

dl() {
  local url="$1" out="$2" tmp
  tmp="$(mktemp "${DEST_DIR}/.dl.XXXXXX")"
  echo "navi_shell.sh: GET ${url}"
  if ! curl -fL --progress-bar -o "${tmp}" "${url}"; then
    rm -f "${tmp}"
    return 1
  fi
  if [[ -f "${out}" ]]; then
    if cmp -s "${tmp}" "${out}"; then
      rm -f "${tmp}"
      echo "navi_shell.sh: unchanged ${out}"
      return 0
    fi
    cp -p "${out}" "${out}.bak-${STAMP}"
    echo "navi_shell.sh: backup  ${out}.bak-${STAMP}"
  fi
  mv -f "${tmp}" "${out}"
}

dl "${ORIGIN}/torus/linux/${CJS_NAME}" "${CJS_DEST}"
dl "${ORIGIN}/torus/linux/${HOST_NAME}" "${DEST_DIR}/${HOST_NAME}"

if [[ "${NAVI_USE_ELF:-}" == "1" ]]; then
  dl "${ORIGIN}/torus/linux/${BIN_NAME}" "${DEST}"
  chmod +x "${DEST}"
  cat > "${WRAPPER}" <<EOF
#!/usr/bin/env bash
exec "${DEST}" "\$@"
EOF
else
  cat > "${WRAPPER}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if ! command -v node >/dev/null 2>&1; then
  echo "navi: need Node.js 22+" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -" >&2
  echo "  apt install -y nodejs" >&2
  exit 1
fi
exec node "${CJS_DEST}" "\$@"
EOF
fi
chmod +x "${WRAPPER}"

echo "navi_shell.sh: cjs     ${CJS_DEST}"
echo "navi_shell.sh: host    ${DEST_DIR}/${HOST_NAME}"
echo "navi_shell.sh: run via ${WRAPPER}"
if ! command -v node >/dev/null 2>&1; then
  echo "navi_shell.sh: install Node 22 next:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs"
fi
echo "navi_shell.sh: then in tmux:  ${WRAPPER}"
echo "  hostparkinator_5000 host 0.0.0.0"
echo "  hostparkinator_5000 start 5353"
