#!/bin/sh
# Guided entry point. install.sh remains the noninteractive, local-only initializer.
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

die() { printf 'Setup error: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
usage() {
  say 'Usage: ./setup.sh [--mode local|http|https|resume] [--host HOST] [--accept-http] [--confirm-change] [--install-docker] [--wait-seconds 1..600]'
  exit 0
}
interactive=false
if [ -t 0 ]; then interactive=true; fi
color=false
if [ -t 1 ] && [ -z "${NO_COLOR+x}" ] && [ "${TERM:-dumb}" != dumb ]; then color=true; fi
if [ "$color" = true ]; then
  bold=$(printf '\033[1m')
  blue=$(printf '\033[36m')
  yellow=$(printf '\033[33m')
  reset=$(printf '\033[0m')
else bold= blue= yellow= reset=; fi
header() {
  say ''
  printf '%s  SENDREPUTE CAMPAIGNS  |  SELF-HOST SETUP%s\n' "$bold" "$reset"
  say '  ------------------------------------------------'
  say '  Your settings and secrets stay on this server.'
  say ''
}
stage() {
  say ''
  printf '%s  [%s/4] %s%s\n' "$blue" "$1" "$2" "$reset"
  say '  ------------------------------------------------'
}
note() { printf '%s  %s%s\n' "$yellow" "$*" "$reset"; }
panel_line() { printf '  %s\n' "$*"; }
mode= host= accept_http=false confirm_change=false install_docker=false wait_seconds=120
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode|--host|--wait-seconds)
      option=$1; shift
      [ "$#" -gt 0 ] || die "Missing value for $option"
      case "$option" in
        --mode) mode=$1 ;; --host) host=$1 ;; --wait-seconds) wait_seconds=$1 ;;
      esac ;;
    --accept-http) accept_http=true ;;
    --confirm-change) confirm_change=true ;;
    --install-docker) install_docker=true ;;
    --help|-h) usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done
case "$wait_seconds" in *[!0-9]*|'') die 'Invalid wait seconds' ;; esac
[ "$wait_seconds" -ge 1 ] && [ "$wait_seconds" -le 600 ] || die 'Wait must be between 1 and 600 seconds'
case "$mode" in ''|local|http|https|resume) ;; *) die 'Invalid mode' ;; esac

ask() {
  printf '%s' "$1" >&2
  IFS= read -r answer || die 'Input ended; use explicit CLI flags for unattended setup'
}
confirm() {
  if [ "$interactive" = true ]; then
    while :; do
      ask "  $1 Type yes or no: "
      case "$answer" in
        yes) return 0 ;;
        no) die 'Not confirmed; no changes made' ;;
        *) note 'Please enter yes or no.' ;;
      esac
    done
  else
    die "$2"
  fi
}
valid_domain() {
  # RFC-style ASCII DNS hostname: no schemes, ports, spaces, shell syntax or trailing dot.
  printf '%s\n' "$1" | LC_ALL=C awk '
    length($0)>253 || $0 !~ /^[A-Za-z0-9.-]+$/ {exit 1}
    { n=split($0,a,"."); if (n<2) exit 1;
      for (i=1;i<=n;i++) if (length(a[i])<1 || length(a[i])>63 ||
          a[i] !~ /^[A-Za-z0-9]/ || a[i] !~ /[A-Za-z0-9]$/) exit 1;
      if (a[n] !~ /^[A-Za-z]/) exit 1;
      t=tolower(a[n]); if (t=="local" || t=="localhost" || t=="test" ||
        t=="example" || t=="invalid" || t=="internal") exit 1;
      if (tolower(a[n-1])=="example" && (t=="com" || t=="net" || t=="org")) exit 1
    }'
}
valid_ipv4() {
  printf '%s\n' "$1" | LC_ALL=C awk '
    $0 !~ /^[0-9.]+$/ {exit 1}
    { n=split($0,a,"."); if(n!=4) exit 1;
      for(i=1;i<=4;i++) if(a[i]=="" || length(a[i])>3 || a[i]+0>255 ||
          (length(a[i])>1 && substr(a[i],1,1)=="0")) exit 1
    }'
}
valid_public_ipv4() {
  valid_ipv4 "$1" || return 1
  printf '%s\n' "$1" | awk -F. '{
    if ($1==0 || $1==10 || $1==127 || $1>=224 ||
        ($1==100 && $2>=64 && $2<=127) ||
        ($1==169 && $2==254) ||
        ($1==172 && $2>=16 && $2<=31) ||
        ($1==192 && (($2==168) || ($2==0 && ($3==0 || $3==2)))) ||
        ($1==198 && (($2==18 || $2==19) || ($2==51 && $3==100))) ||
        ($1==203 && $2==0 && $3==113)) exit 1
  }'
}
read_key() {
  # Never execute .env as shell code. Parse only literal assignments, preserving
  # quoted values and optional inline comments as supported by Compose dotenv.
  awk -v key="$1" '
    index($0,key "=")==1 {
      raw=substr($0,length(key)+2); sub(/^[[:space:]]+/, "", raw)
      if (substr(raw,1,1)=="\"" || substr(raw,1,1)=="\047") {
        quote=substr(raw,1,1); raw=substr(raw,2)
        end=index(raw,quote); if (!end) exit 2
        suffix=substr(raw,end+1)
        if (suffix !~ /^[[:space:]]*(#.*)?$/) exit 2
        value=substr(raw,1,end-1)
      } else {
        sub(/[[:space:]]+#.*$/, "", raw)
        sub(/[[:space:]]+$/, "", raw)
        value=raw
      }
    }
    END { if (value ~ /[$`\\]/) exit 2; print value }
  ' .env || die "Invalid .env assignment for $1; correct it manually (no file changed)"
}

header
stage 1 'Checking Docker and this server'
# Snap Docker can fail at AppArmor/no-new-privileges transitions even when
# docker info and postgres appear healthy. Do not migrate or delete its data.
if command -v docker >/dev/null 2>&1; then
  docker_path=$(command -v docker)
  if command -v readlink >/dev/null 2>&1; then
    docker_path=$(readlink -f "$docker_path" 2>/dev/null || printf '%s' "$docker_path")
  fi
  case "$docker_path" in
    /snap/*|/var/lib/snapd/*) die 'Snap Docker detected. Stop here: back up credentials and volumes, then plan a manual migration to Ubuntu docker.io. Do not remove Snap or delete volumes automatically.' ;;
  esac
else
  if [ "$install_docker" != true ]; then
    if [ "$interactive" = true ]; then
      say 'Docker is missing. On Ubuntu 24/26, this can install the Ubuntu docker.io and docker-compose-v2 packages using sudo apt-get.'
      confirm 'Install Ubuntu Docker packages and enable its service?' 'Docker installation needs explicit consent'
    else
      die 'Docker missing. Install Ubuntu docker.io and docker-compose-v2 yourself, or explicitly pass --install-docker on Ubuntu 24/26.'
    fi
  fi
  [ -r /etc/os-release ] || die 'Cannot verify Ubuntu version; install Docker manually'
  . /etc/os-release
  [ "${ID:-}" = ubuntu ] || die 'Automatic package install is supported only on Ubuntu 24/26'
  case "${VERSION_ID:-}" in 24.*|26.*) ;; *) die 'Automatic package install is supported only on Ubuntu 24/26' ;; esac
  command -v sudo >/dev/null 2>&1 || die 'sudo is required for Ubuntu package installation'
  say 'Installing Ubuntu docker.io and docker-compose-v2 (no external repository).'
  sudo apt-get update || die 'apt-get update failed'
  sudo apt-get install -y docker.io docker-compose-v2 || die 'Ubuntu Docker package installation failed'
  sudo systemctl enable --now docker || die 'Could not enable/start Docker service'
  command -v docker >/dev/null 2>&1 || die 'Docker command still missing after installation'
fi
use_sudo=false
docker_cmd() {
  if [ "$use_sudo" = true ]; then sudo docker "$@"; else docker "$@"; fi
}
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    use_sudo=true
    say 'Using sudo for Docker access; existing Docker permissions remain unchanged.'
  else
    die 'Docker daemon unavailable. Start Docker and check your access (or sudo); no application settings changed.'
  fi
fi
root=$(docker_cmd info --format '{{.DockerRootDir}}' 2>/dev/null) || die 'Could not inspect Docker data root'
case "$root" in
  /var/snap/*|/snap/*) die 'Snap Docker data root detected. Stop here: back up credentials and volumes, then plan a manual migration to Ubuntu docker.io. Do not remove Snap or delete volumes automatically.' ;;
esac
docker_cmd compose version >/dev/null 2>&1 || die 'Docker Compose v2 unavailable. Install the Ubuntu docker-compose-v2 package; no settings changed.'
say '  Docker Engine, Compose v2 and the daemon are available.'

existing=false
if [ -e .env ]; then
  [ -f .env ] && [ ! -L .env ] || die 'Refusing non-regular or symlink .env'
  existing=true
  old_bind=$(read_key CAMPAIGNS_BIND_ADDRESS)
  old_port=$(read_key CAMPAIGNS_HTTP_PORT)
  old_proxy=$(read_key CAMPAIGNS_TRUST_PROXY)
  old_domain=$(read_key CAMPAIGNS_DOMAIN)
  old_public_host=$(read_key CAMPAIGNS_PUBLIC_HOST)
  old_insecure_origin=$(read_key CAMPAIGNS_INSECURE_HTTP_ORIGIN)
else
  old_bind= old_port= old_proxy= old_domain= old_public_host= old_insecure_origin=
fi
# Compose interpolation requires the initialized postgres password even for
# `ps`. Skip inspection on a fresh .env; inspect running UI-saved sites only
# on existing installations, before changing any setting.
active_domain=
if [ "$existing" = true ]; then
  running_services=$(docker_cmd compose ps --status running --services 2>/dev/null) ||
    die 'Cannot inspect running Campaigns services safely; no settings changed'
  if printf '%s\n' "$running_services" | grep -qx campaigns; then
    # Read only the public hostname, never the site JSON or certificate keys.
    active_domain=$(docker_cmd compose exec -T campaigns node -e '
      const fs=require("node:fs");
      try {
        const s=JSON.parse(fs.readFileSync("/var/lib/sendrepute-campaigns/https-site/active/site.json","utf8"));
        if (typeof s.domain !== "string") process.exit(2);
        console.log(s.domain);
      } catch(e) {
        if (e.code === "ENOENT") console.log("NONE"); else process.exit(2);
      }
    ' 2>/dev/null) || die 'Cannot safely read the active HTTPS site; no settings changed'
    [ "$active_domain" != NONE ] || active_domain=
    if [ -n "$active_domain" ]; then
      valid_domain "$active_domain" || die 'Active HTTPS site hostname is invalid; inspect Workspace Settings'
    fi
  fi
fi
stage 2 'Choosing how to access Campaigns'
if [ -z "$mode" ]; then
  if [ "$interactive" != true ]; then die 'Unattended use requires --mode (and --host for public modes)'; fi
  if [ "$existing" = true ]; then
    say 'Existing configuration found. Resume preserves the exposure and all .env contents.'
  else
    say 'Recommended: HTTPS with a DNS hostname pointing to this server (open TCP 80/443).'
  fi
  say '  1) HTTPS domain       Recommended; automatic certificate (requires DNS)'
  say '  2) Public IP HTTP     Unencrypted; explicit confirmation required'
  say '  3) Local / SSH tunnel No public application port'
  if [ "$existing" = true ]; then say '  4) Resume             Keep existing settings (default)'
  else say '  Press Enter for safe local mode (3).'; fi
  while :; do
    ask '  Select 1-3 (or H/P/L), 4/R if resuming: '
    case "$answer" in
      1|h|H) mode=https; break ;;
      2|p|P) mode=http; break ;;
      3|l|L) mode=local; break ;;
      4|r|R) if [ "$existing" = true ]; then mode=resume; break; fi ;;
      '') if [ "$existing" = true ]; then mode=resume; else mode=local; fi; break ;;
    esac
    note 'Please select a listed number or letter.'
  done
fi
[ "$mode" != resume ] || [ "$existing" = true ] || die 'Nothing to resume: choose a mode'
resuming=false
if [ "$mode" = resume ]; then
  resuming=true
  bind=${old_bind:-127.0.0.1}
  port=${old_port:-8080}
  proxy=${old_proxy:-false}
  domain=$old_domain
  if [ -n "$domain" ] || [ -n "$active_domain" ]; then
    if [ -n "$active_domain" ]; then
      [ -z "$domain" ] || [ "$domain" = "$active_domain" ] ||
        die 'Active HTTPS site differs from .env. Update the domain/certificate in Workspace Settings before resuming; no settings changed.'
      domain=$active_domain
    fi
    valid_domain "$domain" || die 'Existing HTTPS domain is invalid; inspect .env'
    [ "$bind" = 127.0.0.1 ] && [ "$proxy" = true ] ||
      die 'Existing HTTPS exposure is inconsistent (backend must be loopback and proxy trusted). Use --mode https --host DOMAIN --confirm-change to correct it.'
    mode=https
  elif [ "$bind" = 0.0.0.0 ]; then
    [ "$proxy" = false ] || die 'Existing public HTTP configuration trusts a proxy without HTTPS; inspect .env before resuming'
    mode=http
    [ "$port" != 80 ] || die 'Public HTTP port 80 is not supported by the exact-origin opt-in; choose another backend port'
    host=${host:-$old_public_host}
    if [ -z "$host" ]; then
      [ "$interactive" = true ] || die 'Existing public HTTP mode needs --host PUBLIC_IP to display its public URL'
      while :; do
        ask '  Public IPv4 address for the existing HTTP URL: '
        if valid_public_ipv4 "$answer"; then host=$answer; break; fi
        note 'Enter a routable public IPv4 address (without scheme or port).'
      done
    fi
    valid_public_ipv4 "$host" || die 'Public HTTP requires a routable public IPv4 address'
    [ "$old_insecure_origin" = "http://$host:$port" ] ||
      die 'Existing public HTTP origin is missing or inconsistent. Use --mode http --host PUBLIC_IP --accept-http --confirm-change to opt in explicitly.'
  elif [ "$bind" = 127.0.0.1 ] && [ "$proxy" = false ]; then mode=local
  else die 'Existing exposure cannot be classified safely; inspect .env and choose an explicit mode'
  fi
  if [ "$mode" != http ] && [ -n "$host" ]; then die '--host is only valid on resume of public HTTP'; fi
else
  port=${old_port:-8080}
  case "$port" in ''|*[!0-9]*|0*) die 'Existing HTTP port is invalid' ;; esac
  [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || die 'Existing HTTP port is invalid'
  case "$mode" in
    local)
      [ -z "$host" ] || die '--host is only for public modes'
      bind=127.0.0.1 proxy=false domain= ;;
    https)
      say '  Use a subdomain you control, for example campaigns.example.com (replace with your own).'
      say '  Point its public DNS A record to this server; use AAAA only with working IPv6.'
      say '  Enter only the hostname: no scheme (https://), port or path.'
      if [ -z "$host" ]; then
        [ "$interactive" = true ] || die 'HTTPS requires --host DNS_NAME'
        while :; do
          ask '  Public DNS hostname (no scheme, port or path): '
          if valid_domain "$answer"; then host=$answer; break; fi
          note 'Enter your own valid public DNS hostname, without scheme, port or path (not an IP address or reserved example domain).'
        done
      fi
      valid_domain "$host" || die 'HTTPS requires a valid DNS hostname (not an IP address)'
      [ -z "$active_domain" ] || [ "$active_domain" = "$host" ] ||
        die 'An active UI-saved HTTPS site uses a different hostname. Change its domain/certificate in Workspace Settings first; no .env or certificate was changed.'
      bind=127.0.0.1 proxy=true domain=$host ;;
    http)
      [ "$port" != 80 ] || die 'Public HTTP port 80 is not supported by the exact-origin opt-in; choose another backend port'
      if [ -z "$host" ]; then
        [ "$interactive" = true ] || die 'Public HTTP requires --host PUBLIC_IP'
        while :; do
          ask '  Public IPv4 address (no scheme or port): '
          if valid_public_ipv4 "$answer"; then host=$answer; break; fi
          note 'Enter a routable public IPv4 address (without scheme or port).'
        done
      fi
      valid_public_ipv4 "$host" || die 'Public HTTP requires a routable public IPv4 address'
      bind=0.0.0.0 proxy=false domain= ;;
  esac
fi
case "$port" in ''|*[!0-9]*|0*) die 'Existing HTTP port is invalid' ;; esac
[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || die 'Existing HTTP port is invalid'

stage 3 'Reviewing settings and starting services'
say '  Configuration review'
case "$mode" in
  local) say '  Access:      Local server / SSH tunnel' ;;
  http) say "  Access:      Public IP HTTP at $host:$port" ;;
  https) say "  Access:      HTTPS domain $domain" ;;
esac
say "  Backend:     $bind:$port"
say "  Trust proxy: $proxy"
if [ "$existing" = true ]; then say '  Data:        Existing .env and volumes preserved'
else say '  Data:        New private .env; volumes are never deleted'; fi
if [ "$resuming" = true ]; then say '  Action:      Resume current exposure without changing .env'
else say '  Action:      Start or update this access mode'; fi
if [ "$mode" = http ]; then
  note 'WARNING: Public HTTP is unencrypted. Login, setup and API credentials can be exposed in transit.'
  if [ "$resuming" = false ] && [ "$accept_http" != true ]; then
    confirm 'Expose the application over unencrypted HTTP?' 'Public HTTP requires --accept-http'
  fi
fi
if [ "$existing" = true ] && [ "$resuming" = false ]; then
  if [ "${old_bind:-127.0.0.1}" != "$bind" ] || [ "${old_proxy:-false}" != "$proxy" ] || [ "$old_domain" != "$domain" ] || { [ "$mode" = http ] && { [ "$old_public_host" != "$host" ] || [ "$old_insecure_origin" != "http://$host:$port" ]; }; }; then
    say 'This changes the existing public exposure. Your database, secrets, and unknown .env keys will be preserved.'
    if [ "$confirm_change" != true ]; then confirm 'Change the existing exposure?' 'Exposure change requires --confirm-change'; fi
  fi
fi
if [ "$existing" = false ]; then
  ./install.sh || die 'Could not initialize .env'
fi
public_host=
if [ "$mode" = http ]; then public_host=$host; fi
insecure_origin=
if [ "$mode" = http ]; then insecure_origin="http://$host:$port"; fi
if [ "$resuming" = false ] && { [ "$existing" = false ] || [ "${old_bind:-127.0.0.1}" != "$bind" ] || [ "${old_proxy:-false}" != "$proxy" ] || [ "$old_domain" != "$domain" ] || [ "$old_public_host" != "$public_host" ] || [ "$old_insecure_origin" != "$insecure_origin" ]; }; then
  # mktemp creates private files in the same directory; rename is atomic.
  tmp=$(mktemp ./.env.new.XXXXXX) || die 'Cannot create private temporary configuration'
  trap 'rm -f "$tmp"' EXIT HUP INT TERM
  if [ "$existing" = true ]; then
    backup=$(mktemp ./.env.backup.XXXXXX) || die 'Cannot create private backup'
    cp -p .env "$backup" || die 'Cannot back up .env'
    chmod 600 "$backup"
  fi
  awk -v bind="$bind" -v port="$port" -v proxy="$proxy" -v domain="$domain" -v public_host="$public_host" -v insecure_origin="$insecure_origin" '
    BEGIN { v["CAMPAIGNS_BIND_ADDRESS"]=bind; v["CAMPAIGNS_HTTP_PORT"]=port;
      v["CAMPAIGNS_TRUST_PROXY"]=proxy; v["CAMPAIGNS_DOMAIN"]=domain;
      v["CAMPAIGNS_PUBLIC_HOST"]=public_host;
      v["CAMPAIGNS_INSECURE_HTTP_ORIGIN"]=insecure_origin }
    {
      key=$0; sub(/=.*/, "", key)
      if (key in v) {
        if (!seen[key]++) {
          if (v[key]!="") {
            comment=$0
            sub(/^[^=]*=/, "", comment)
            if (match(comment, /[[:space:]]#/)) comment=" " substr(comment,RSTART+1)
            else comment=""
            print key "=" v[key] comment
          } else if ($0 ~ /[[:space:]]#/) {
            comment=$0; match(comment, /[[:space:]]#/); print substr(comment,RSTART+1)
          }
        }
      } else print
    }
    END {
      n=split("CAMPAIGNS_BIND_ADDRESS CAMPAIGNS_HTTP_PORT CAMPAIGNS_TRUST_PROXY CAMPAIGNS_DOMAIN CAMPAIGNS_PUBLIC_HOST CAMPAIGNS_INSECURE_HTTP_ORIGIN", keys, " ")
      for (i=1;i<=n;i++) if (!seen[keys[i]] && v[keys[i]]!="")
        print keys[i] "=" v[keys[i]]
    }' .env > "$tmp" || die 'Could not prepare configuration'
  chmod 600 "$tmp"
  mv -f "$tmp" .env || die 'Could not update configuration'
  trap - EXIT HUP INT TERM
  [ "$existing" = false ] || say "Private .env backup saved: $backup"
fi
chmod 600 .env

say '  Building images and starting containers. First build may take several minutes.'
say '  Compose output is hidden to avoid exposing credentials; this step waits for completion.'
if [ "$mode" = https ]; then
  docker_cmd compose --profile https up -d --build >/dev/null 2>&1 ||
    die 'Compose startup failed. Check disk/build access and whether TCP 80/443 or the backend port is already in use; run docker compose --profile https ps (no secrets printed).'
else
  docker_cmd compose up -d --build >/dev/null 2>&1 ||
    die 'Compose startup failed. Check disk/build access and whether the backend port is already in use; run docker compose ps (no secrets printed).'
fi
say '  Compose finished starting services.'
stage 4 'Checking application readiness'
say "  Waiting up to $wait_seconds seconds for the Campaigns status endpoint inside its container."
elapsed=0
status=
while [ "$elapsed" -lt "$wait_seconds" ]; do
  # Query *inside this Compose project*, not localhost:$port (which could be
  # another application after a failed bind). Return only a strict boolean.
  status=$(docker_cmd compose exec -T campaigns node -e '
    fetch("http://127.0.0.1:8080/api/campaigns/status", {signal:AbortSignal.timeout(3000)})
      .then(async r => { if (!r.ok) process.exit(1);
        const body=await r.json();
        if (typeof body?.data?.installed !== "boolean") process.exit(1);
        console.log(body.data.installed ? "installed" : "needs-setup");
      }).catch(() => process.exit(1));
  ' 2>/dev/null) || status=
  if [ "$status" = installed ] || [ "$status" = needs-setup ]; then break; fi
  status=
  sleep 2
  elapsed=$((elapsed + 2))
done
[ -n "$status" ] || die 'Application did not become healthy before timeout. Check docker compose ps and docker compose logs campaigns postgres (logs may contain sensitive data; do not share unredacted).'
if [ "$mode" != https ]; then
  # A previously enabled Compose profile is not removed by a plain `up`.
  docker_cmd compose --profile https stop https >/dev/null 2>&1 ||
    die 'Local app is healthy, but could not stop the previously enabled HTTPS proxy. Check docker compose --profile https ps; public exposure may remain active.'
fi
say ''
say '  ================================================================'
if [ "$status" = needs-setup ]; then say '  CAMPAIGNS READY FOR OWNER SETUP'
else say '  CAMPAIGNS RUNNING'; fi
say '  ================================================================'
panel_line 'Readiness confirms local container health only, not public reachability or valid HTTPS.'
case "$mode" in
  local)
    say '  ACCESS'
    panel_line "Local container health ready. Server-only URL: http://127.0.0.1:$port/campaigns/"
    panel_line 'From your computer, run:'
    panel_line "  ssh -o ExitOnForwardFailure=yes -N -L 18080:127.0.0.1:$port USER@YOUR_SERVER_HOST"
    if [ "$status" = needs-setup ]; then
      panel_line 'Then open http://127.0.0.1:18080/campaigns/install on your computer.'
    else
      panel_line 'Then open http://127.0.0.1:18080/campaigns/ on your computer.'
    fi
    panel_line 'Wizard Public URL (when using this tunnel): http://127.0.0.1:18080/campaigns/' ;;
  http)
    say '  ACCESS'
    panel_line 'WARNING: Public HTTP is unencrypted; login and API credentials are exposed in transit.'
    panel_line 'Local container health ready; public HTTP reachability not verified.'
    if [ "$status" = needs-setup ]; then panel_line "Setup page (unencrypted): http://$host:$port/campaigns/install"
    else panel_line "App page (unencrypted): http://$host:$port/campaigns/"; fi
    panel_line "Wizard Public URL: http://$host:$port/campaigns/" ;;
  https)
    say '  ACCESS'
    if [ -n "$active_domain" ]; then
      panel_line 'Local container health ready. Existing HTTPS site is externally unverified.'
      panel_line 'Check its TLS certificate, DNS and TCP 80/443 from outside this server.'
    else
      panel_line 'Local container health ready. HTTPS certificate/ACME is pending and externally unverified.'
      panel_line 'Check DNS and TCP 80/443 from outside this server.'
    fi
    if [ "$status" = needs-setup ]; then panel_line "Setup page (unverified): https://$domain/campaigns/install"
    else panel_line "App page (unverified): https://$domain/campaigns/"; fi
    panel_line "Wizard Public URL: https://$domain/campaigns/"
    panel_line 'Do not treat local container health as proof of public HTTPS reachability.'
    panel_line 'Do not enter any secrets until this HTTPS page has a valid, trusted certificate with no browser warnings.' ;;
esac
say ''
say '  NEXT STEP'
if [ "$status" = needs-setup ]; then
  panel_line 'REQUIRED: Complete the one-time owner setup; Campaigns is not installed yet.'
  case "$mode" in
    https)
      panel_line '1) Verify the HTTPS installation page above from another network.'
      panel_line '   If the certificate is pending or invalid, STOP: do not enter the token, password or API key.'
      panel_line '   Continue only with a valid, trusted certificate and no browser warnings.' ;;
    local)
      panel_line '1) Open the installation page above through the trusted SSH tunnel (or locally on this server).' ;;
    http)
      panel_line '1) Open the unencrypted installation page above only if you accept the stated HTTP risk.' ;;
  esac
  panel_line '2) On this server, from this project directory, retrieve the required one-time token:'
  if [ "$use_sudo" = true ]; then
    panel_line '   sudo docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token'
  else
    panel_line '   docker compose exec campaigns cat /var/lib/sendrepute-campaigns/installer-token'
  fi
  panel_line '3) Copy the command output and paste it into the "Setup token" field on the installation page.'
  panel_line '4) Fill in the owner details and Public URL, then complete SendRepute activation and owner setup in the wizard.'
  panel_line 'Setup never prints the token automatically. Keep it private; never put it in a URL or share it.'
else
  panel_line 'Owner setup is already complete; no setup token is needed.'
fi
say '  ================================================================'