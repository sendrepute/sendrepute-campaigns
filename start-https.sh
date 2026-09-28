#!/bin/sh
set -eu

# The Caddy admin listener remains on its container-local loopback; never
# publish 2019 or mount Docker's socket. Site files are only shared with the
# Campaigns process and this container.
site=${CAMPAIGNS_SITE_DIR:-/run/campaigns-site}
valid_revision() {
  printf '%s\n' "$1" | grep -Eq '^site-[0-9]+-[0-9]+-[a-f0-9]+$'
}
active_revision() {
  revision=$(readlink "$site/active" 2>/dev/null || true)
  valid_revision "$revision" && printf '%s' "$revision" || true
}
validate_revision() {
  test -f "$site/$1/Caddyfile" &&
    caddy validate --config "$site/$1/Caddyfile" --adapter caddyfile >/dev/null 2>&1
}
revision_mode() {
  if test -f "$site/$1/site.json" &&
    grep -Eq '"mode":"(uploaded|cloudflare-origin)"' "$site/$1/site.json"; then
    printf manual
  else
    printf automatic
  fi
}
mark_result() {
  printf '{"revision":"%s","state":"%s","lastSeen":%s}\n' "$1" "$2" "$(date +%s)" > "$site/.result-$$"
  # Campaigns runs as UID 10001. The shared volume root is UID 10001 and
  # mode 0700 (https-site-init); only this status file may be read by another
  # UID. Never loosen the private key or its version directory permissions.
  chmod 644 "$site/.result-$$"
  mv -f "$site/.result-$$" "$site/result.json"
}
chosen=$(active_revision)
known_rejected() {
  test -f "$site/result.json" &&
    grep -Fq "\"revision\":\"$1\",\"state\":\"rejected\"" "$site/result.json"
}
if [ -n "$chosen" ] && ! known_rejected "$chosen" && validate_revision "$chosen"; then
  config="$site/$chosen/Caddyfile"
else
  if [ -n "$chosen" ]; then mark_result "$chosen" rejected; fi
  previous=$(readlink "$site/last-good" 2>/dev/null || true)
  if valid_revision "$previous" && validate_revision "$previous"; then
    chosen="$previous"
    config="$site/$chosen/Caddyfile"
  elif printf '%s\n' "${CAMPAIGNS_DOMAIN:-}" |
    grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'; then
    chosen=""
    config=/etc/caddy/Caddyfile
  else
    if [ -n "${CAMPAIGNS_DOMAIN:-}" ]; then
      printf '%s\n' 'Invalid CAMPAIGNS_DOMAIN; refusing HTTPS startup.' >&2
      exit 1
    fi
    printf '%s\n' 'Waiting for an HTTPS domain in installation settings (or CAMPAIGNS_DOMAIN).' >&2
    while :; do
      chosen=$(active_revision)
      if [ -n "$chosen" ] && validate_revision "$chosen"; then
        config="$site/$chosen/Caddyfile"
        break
      fi
      sleep 3
    done
  fi
fi
caddy run --config "$config" --adapter caddyfile &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' INT TERM EXIT
sleep 2
kill -0 "$pid" 2>/dev/null || { wait "$pid"; exit 1; }
if [ -n "$chosen" ] && [ "$chosen" = "$(active_revision)" ]; then
  ln -s "$chosen" "$site/.last-good-$$"
  mv -Tf "$site/.last-good-$$" "$site/last-good"
  mark_result "$chosen" active
fi
running="$chosen"
running_mode=$(revision_mode "$running")
last_attempted="$chosen"
result_state=active
if [ -n "$(active_revision)" ] && [ "$(active_revision)" != "$running" ]; then
  last_attempted=""
  result_state=rejected
fi
while kill -0 "$pid" 2>/dev/null; do
  candidate=$(active_revision)
  if [ -n "$candidate" ] && [ "$candidate" != "$last_attempted" ]; then
    if [ "$candidate" = "$running" ]; then
      result_state=active
    else
      next_mode=$(revision_mode "$candidate")
      if validate_revision "$candidate"; then
        if [ "$next_mode" != "$running_mode" ] || [ "$next_mode" = manual ]; then
          # Caddy 2.10 may acknowledge a reload from automatic to a manually
          # loaded certificate while losing its live TLS certificate cache.
          # A fresh process safely rebuilds that cache from the persistent
          # /data volume; do not use Caddy's reload for certificate changes.
          kill "$pid" 2>/dev/null || true
          wait "$pid" 2>/dev/null || true
          caddy run --config "$site/$candidate/Caddyfile" --adapter caddyfile &
          pid=$!
          sleep 2
          if kill -0 "$pid" 2>/dev/null; then
            changed=true
          else
            wait "$pid" 2>/dev/null || true
            caddy run --config "$config" --adapter caddyfile &
            pid=$!
            sleep 2
            kill -0 "$pid" 2>/dev/null || exit 1
            changed=false
          fi
        elif caddy reload --config "$site/$candidate/Caddyfile" --adapter caddyfile >/dev/null 2>&1; then
          changed=true
        else
          changed=false
        fi
      else
        changed=false
      fi
      if [ "$changed" = true ]; then
        running="$candidate"
        running_mode="$next_mode"
        config="$site/$running/Caddyfile"
        ln -s "$running" "$site/.last-good-$$"
        mv -Tf "$site/.last-good-$$" "$site/last-good"
        result_state=active
      else
        result_state=rejected
      fi
    fi
    last_attempted="$candidate"
  fi
  if [ -n "$candidate" ]; then mark_result "$candidate" "$result_state"; fi
  sleep 3
done
wait "$pid"