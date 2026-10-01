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
pin_revision() {
  if valid_revision "$1"; then
    ln -s "$1" "$site/.loading-$$"
    mv -Tf "$site/.loading-$$" "$site/loading"
  fi
}
# Selection and publication of the loading pin share the writer/GC's native
# flock. Never replace/delete its inode, and never inherit a held lock into
# Caddy: this short-lived subshell closes its descriptor before validation.
select_and_pin() (
  test -d "$site" || exit 0
  command -v flock >/dev/null || { printf '%s\n' 'Managed HTTPS requires native flock.' >&2; exit 1; }
  if ! test -e "$site/.write-lock"; then
    # Publish an appropriately owned inode without overwriting a concurrent
    # writer's lock. The volume owner is the Campaigns UID (not Caddy's root).
    temporary="$site/.write-lock-init-$$"
    (umask 077; : > "$temporary")
    chown "$(stat -c '%u:%g' "$site")" "$temporary"
    ln "$temporary" "$site/.write-lock" 2>/dev/null || test -e "$site/.write-lock"
    rm -f "$temporary"
  fi
  exec 9>>"$site/.write-lock"
  flock -x 9
  selected=$(readlink "$site/$1" 2>/dev/null || true)
  if valid_revision "$selected"; then
    pin_revision "$selected"
    printf '%s' "$selected"
  fi
)
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
revision_certificate() {
  if [ "$(revision_mode "$1")" = manual ]; then
    identity=$(sed -n 's/.*"certificateRevision":"\(site-[0-9]*-[0-9]*-[a-f0-9]*\)".*/\1/p' "$site/$1/site.json")
    if valid_revision "$identity"; then printf '%s' "$identity"; else printf '%s' "$1"; fi
  else
    printf automatic
  fi
}
mark_result() {
  printf '{"revision":"%s","state":"%s","runningRevision":"%s","lastSeen":%s}\n' "$1" "$2" "${running:-}" "$(date +%s)" > "$site/.result-$$"
  # Campaigns runs as UID 10001. The shared volume root is UID 10001 and
  # mode 0700 (https-site-init); only this status file may be read by another
  # UID. Never loosen the private key or its version directory permissions.
  chmod 644 "$site/.result-$$"
  mv -f "$site/.result-$$" "$site/result.json"
}
chosen=$(select_and_pin active)
boot_attempt="$chosen"
known_rejected() {
  test -f "$site/result.json" &&
    grep -Fq "\"revision\":\"$1\",\"state\":\"rejected\"" "$site/result.json"
}
if [ -n "$chosen" ] && ! known_rejected "$chosen" && validate_revision "$chosen"; then
  config="$site/$chosen/Caddyfile"
else
  if [ -n "$chosen" ]; then mark_result "$chosen" rejected; fi
  previous=$(select_and_pin last-good)
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
      chosen=$(select_and_pin active)
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
if ! kill -0 "$pid" 2>/dev/null; then
  wait "$pid" 2>/dev/null || true
  failed="$chosen"
  previous=$(select_and_pin last-good)
  if valid_revision "$previous" && [ "$previous" != "$failed" ] && validate_revision "$previous"; then
    chosen="$previous"
    config="$site/$chosen/Caddyfile"
    caddy run --config "$config" --adapter caddyfile &
    pid=$!
    sleep 2
    kill -0 "$pid" 2>/dev/null || { wait "$pid"; exit 1; }
    running="$chosen"
    mark_result "$failed" rejected
  else
    if [ -n "$failed" ]; then mark_result "$failed" rejected; fi
    exit 1
  fi
fi
running="$chosen"
if [ -n "$chosen" ]; then
  # A newer active revision can arrive during validation/start. The running
  # revision must become last-good BEFORE the next loading pin replaces it,
  # otherwise GC could delete the configuration needed for failure fallback.
  ln -s "$chosen" "$site/.last-good-$$"
  mv -Tf "$site/.last-good-$$" "$site/last-good"
  if [ "$chosen" = "$(active_revision)" ]; then mark_result "$chosen" active; fi
fi
running_mode=$(revision_mode "$running")
running_certificate=$(revision_certificate "$running")
last_attempted="$boot_attempt"
result_state=active
if [ -n "$(active_revision)" ] && [ "$(active_revision)" != "$running" ]; then
  result_state=rejected
fi
while kill -0 "$pid" 2>/dev/null; do
  candidate=$(select_and_pin active)
  if [ -n "$candidate" ] && [ "$candidate" != "$last_attempted" ]; then
    if [ "$candidate" = "$running" ]; then
      result_state=active
    else
      next_mode=$(revision_mode "$candidate")
      next_certificate=$(revision_certificate "$candidate")
      if validate_revision "$candidate"; then
        if [ "$next_certificate" != "$running_certificate" ] || [ "$next_mode" = manual ]; then
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
        running_certificate="$next_certificate"
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