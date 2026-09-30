#!/usr/bin/env bash
# Opt-in, host-side backup. Never source the configuration: it is data, not shell.
set -Eeuo pipefail
umask 077
export LC_ALL=C
cd "$(dirname "$0")"
command="${1:-}"
config="${CAMPAIGNS_BACKUP_CONFIG:-/etc/sendrepute-campaigns/backup.conf}"
fail() { printf 'Campaigns backup: %s\n' "$*" >&2; exit 1; }
[[ "$command" == backup || "$command" == verify || "$command" == extract || "$command" == status ]] ||
  fail "usage: backup.sh backup|verify ARCHIVE|extract ARCHIVE EMPTY_DIRECTORY|status"
[[ -f "$config" && ! -L "$config" ]] || fail "missing regular configuration: $config"
[[ $(stat -c %a "$config") =~ ^(600|400)$ ]] || fail "configuration must have mode 0600 or 0400"
[[ $(stat -c %u "$config") == "$(id -u)" ]] || fail "configuration must be owned by the invoking user"
AGE_RECIPIENT= AGE_IDENTITY= LOCAL_DIR= OFFHOST_LOCAL_DIR= OFFHOST_SFTP_HOST= OFFHOST_SFTP_USER= OFFHOST_SFTP_DIR= SSH_IDENTITY=
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" == *=* ]] || fail "invalid configuration line"
  key=${line%%=*}; value=${line#*=}
  case "$key" in
    AGE_RECIPIENT|AGE_IDENTITY|LOCAL_DIR|OFFHOST_LOCAL_DIR|OFFHOST_SFTP_HOST|OFFHOST_SFTP_USER|OFFHOST_SFTP_DIR|SSH_IDENTITY)
      [[ -z "${!key}" ]] || fail "duplicate configuration key $key"
      printf -v "$key" '%s' "$value" ;;
    *) fail "unknown configuration key $key" ;;
  esac
done < "$config"
[[ -n "$LOCAL_DIR" && "$LOCAL_DIR" == /* && -d "$LOCAL_DIR" && ! -L "$LOCAL_DIR" ]] || fail "LOCAL_DIR must be an existing absolute non-symlink directory"
[[ $(stat -c %a "$LOCAL_DIR") == 700 && $(stat -c %u "$LOCAL_DIR") == "$(id -u)" ]] ||
  fail "LOCAL_DIR must be owned by this user with mode 0700"
if [[ "$command" == status ]]; then
  [[ -f "$LOCAL_DIR/status" && ! -L "$LOCAL_DIR/status" ]] || fail "no regular backup status yet"
  [[ $(stat -c %a "$LOCAL_DIR/status") =~ ^(600|400)$ &&
     $(stat -c %u "$LOCAL_DIR/status") == "$(id -u)" ]] ||
    fail "status must be owned by this user with mode 0600 or 0400"
  cat -- "$LOCAL_DIR/status"
  exit
fi
if [[ "$command" == backup ]]; then
  exec 9>"$LOCAL_DIR/.backup.lock"
  flock -n 9 || fail "another backup operation holds the lock"
  early_failure() {
    local result=$?
    if (( result != 0 )); then
      printf 'last_result=failure\nlast_attempt_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LOCAL_DIR/status.tmp"
      [[ ! -f "$LOCAL_DIR/last-success" ]] || cat "$LOCAL_DIR/last-success" >> "$LOCAL_DIR/status.tmp"
      mv -f -- "$LOCAL_DIR/status.tmp" "$LOCAL_DIR/status"
      logger -t campaigns-backup 'backup preflight failed' 2>/dev/null || true
    fi
  }
  trap early_failure EXIT
fi
safe_key_file() {
  [[ -f "$1" && ! -L "$1" && $(stat -c %h "$1") == 1 &&
     $(stat -c %u "$1") == "$(id -u)" && $(stat -c %a "$1") =~ ^(600|400)$ ]] ||
    fail "unsafe or missing recovery state file: $1 (do not generate a replacement key)"
}
setup_age() {
  local keydir parent derived fingerprint answer saved new_keydir=0
  if [[ -z "$AGE_RECIPIENT" && -z "$AGE_IDENTITY" ]]; then
    # This sibling is never under the installation (whose .env is archived),
    # the encrypted spool, or the off-host destination.
    [[ "$config" == /* && "$config" != */../* && "$config" != */./* ]] ||
      fail "automatic recovery requires an absolute configuration path without dot segments"
    parent=${config%/*}
    [[ -n "$parent" ]] || parent=/
    [[ -d "$parent" && ! -L "$parent" && "$(realpath -e "$parent")" == "$parent" &&
       $(stat -c %u "$parent") == "$(id -u)" && $(stat -c %a "$parent") == 700 ]] ||
      fail "automatic recovery requires a user-owned mode 0700 configuration directory without symlinks"
    keydir="$config.keys"
    for saved in "$LOCAL_DIR" "$OFFHOST_LOCAL_DIR" "$PWD"; do
      [[ -z "$saved" ]] && continue
      # The leaf may be a real directory reached through a symlinked parent,
      # or via /./ and /../. Compare physical locations, not configured text.
      [[ -d "$saved" ]] || continue
      saved=$(realpath -e -- "$saved") ||
        fail "cannot resolve installation or backup directory"
      [[ "$keydir" != "$saved" && "$keydir" != "$saved/"* &&
         "$saved" != "$keydir/"* ]] ||
        fail "recovery directory must be separate from installation and backup directories"
    done
    if [[ ! -e "$keydir" && ! -L "$keydir" ]]; then
      if [[ "$command" != backup ]]; then
        fail "no automatic recovery identity exists; run an interactive first backup"
      fi
      # Never create a new key if a previous backup may need the old one.
      if compgen -G "$LOCAL_DIR/*.tar.age" >/dev/null ||
         { [[ -n "$OFFHOST_LOCAL_DIR" ]] && compgen -G "$OFFHOST_LOCAL_DIR/*.tar.age" >/dev/null; }; then
        fail "existing archives need their original recovery key; refusing to generate another"
      fi
      [[ ! -e "$LOCAL_DIR/last-success" ]] ||
        fail "backup history exists without a recovery identity; restore the original key"
      if [[ -e "$LOCAL_DIR/status" ]] &&
         grep -Eq '^(last_archive|completed_archive)=' "$LOCAL_DIR/status"; then
        fail "backup history exists without a recovery identity; restore the original key"
      fi
      mkdir -m 700 -- "$keydir" || fail "cannot create protected recovery directory: $keydir"
      new_keydir=1
    fi
    [[ -d "$keydir" && ! -L "$keydir" &&
       $(stat -c %u "$keydir") == "$(id -u)" && $(stat -c %a "$keydir") == 700 ]] ||
      fail "recovery directory must be owned by this user with mode 0700"
    [[ ! -L "$keydir/.init.lock" ]] || fail "unsafe recovery initialization lock"
    if [[ ! -e "$keydir/.init.lock" ]]; then
      ( set -C; : > "$keydir/.init.lock" ) 2>/dev/null ||
        fail "cannot create recovery initialization lock"
    fi
    safe_key_file "$keydir/.init.lock"
    exec 8<>"$keydir/.init.lock"
    flock 8 || fail "cannot lock recovery initialization"
    if [[ ! -e "$keydir/identity" && ! -L "$keydir/identity" ]]; then
      [[ "$command" == backup && ! -e "$keydir/recipient" &&
         ! -e "$keydir/acknowledged" ]] ||
        fail "recovery identity is missing; restore the original identity, never rotate it"
      # A preexisting directory signals interrupted or damaged setup, not a
      # reason to silently rotate. Only this run's newly created directory may
      # receive a new private identity.
      [[ "${new_keydir:-0}" == 1 ]] ||
        fail "recovery identity is missing; restore the original identity, never rotate it"
      age-keygen -o "$keydir/identity" >/dev/null 2>&1 ||
        fail "cannot generate recovery identity; inspect protected directory before retrying"
    fi
    AGE_IDENTITY="$keydir/identity"
    safe_key_file "$AGE_IDENTITY"
    derived=$(age-keygen -y "$AGE_IDENTITY" 2>/dev/null) ||
      fail "invalid recovery identity; restore the original identity"
    [[ "$derived" =~ ^age1[a-z0-9]{58}$ ]] || fail "invalid recovery identity"
    if [[ -e "$keydir/recipient" || -L "$keydir/recipient" ]]; then
      safe_key_file "$keydir/recipient"
      [[ $(cat -- "$keydir/recipient") == "$derived" ]] ||
        fail "recovery recipient differs from identity; restore the original files"
    else
      ( set -C; printf '%s\n' "$derived" > "$keydir/recipient" ) ||
        fail "cannot persist recovery recipient"
    fi
    AGE_RECIPIENT="$derived"
    fingerprint=$(printf '%s' "$derived" | sha256sum)
    fingerprint=${fingerprint%% *}
    if [[ -e "$keydir/acknowledged" || -L "$keydir/acknowledged" ]]; then
      safe_key_file "$keydir/acknowledged"
      [[ $(cat -- "$keydir/acknowledged") == "$fingerprint" ]] ||
        fail "recovery acknowledgement does not match identity; inspect recovery state"
    else
      printf 'Campaigns backup: Recovery file: %s\n' "$AGE_IDENTITY" >&2
      printf 'Campaigns backup: Save a separate protected copy OFF this host, NOT alongside encrypted backups. The host retains this private identity to verify every archive.\n' >&2
      [[ "$command" == backup ]] ||
        fail "first backup requires interactive recovery-file acknowledgement"
      [[ -t 0 && -t 1 && -r /dev/tty ]] ||
        fail "first backup requires an interactive terminal to confirm the recovery file was saved; no services touched"
      printf 'Campaigns backup: After saving the file off-host, type I SAVED THE RECOVERY FILE: ' > /dev/tty
      IFS= read -r answer < /dev/tty ||
        fail "recovery-file confirmation interrupted; no services touched"
      [[ "$answer" == 'I SAVED THE RECOVERY FILE' ]] ||
        fail "recovery-file confirmation rejected; no services touched"
      ( set -C; printf '%s\n' "$fingerprint" > "$keydir/acknowledged" ) ||
        fail "cannot persist recovery-file acknowledgement"
    fi
  else
    [[ -n "$AGE_RECIPIENT" && -n "$AGE_IDENTITY" ]] ||
      fail "set both AGE_RECIPIENT and AGE_IDENTITY, or leave both blank for automatic recovery"
  fi
  [[ "$AGE_RECIPIENT" =~ ^age1[a-z0-9]{58}$ ]] || fail "set a valid age recipient"
  [[ "$AGE_IDENTITY" == /* ]] || fail "set an absolute regular AGE_IDENTITY"
  safe_key_file "$AGE_IDENTITY"
  [[ "$(age-keygen -y "$AGE_IDENTITY" 2>/dev/null)" == "$AGE_RECIPIENT" ]] ||
    fail "age identity does not match recipient"
}
for tool in age age-keygen tar sha256sum flock mktemp docker; do command -v "$tool" >/dev/null || fail "missing $tool"; done
if [[ "$command" != backup ]]; then setup_age; fi

check_tar() {
  local input=$1 nested=$2 entry type part
  tar --absolute-names -tf "$input" >/dev/null || fail "tar integrity verification failed"
  while IFS= read -r entry; do
    if [[ "$nested" == no ]]; then
      [[ "$entry" == ./ || "$entry" =~ ^\./(\.env|compose\.yaml|Caddyfile|start-https\.sh|Dockerfile|postgres\.dump|volumes\.txt|running-services\.txt|SHA256SUMS|campaigns-(data|https-site|caddy-data|caddy-config)\.tar)$ ]] ||
        fail "unsafe outer archive member"
    else
      # GNU tar escape quoting makes newline/control characters visible, rather
      # than splitting them into apparent safe entries.
      [[ "$entry" == . || "$entry" == ./ || "$entry" == ./* ]] ||
        fail "unsafe volume member: absolute or non-relative path"
      [[ "$entry" != *\\* && "$entry" != *$'\r'* ]] || fail "unsafe volume member: escaped or control path"
      IFS=/ read -r -a parts <<< "$entry"
      for part in "${parts[@]:1}"; do
        [[ -n "$part" && "$part" != . && "$part" != .. ]] ||
          fail "unsafe volume member: empty or parent path segment"
      done
    fi
  done < <(tar --absolute-names --quoting-style=escape -tf "$input")
  while IFS= read -r entry; do
    type=${entry:0:1}
    [[ "$type" == - || "$type" == d ]] || fail "archive contains symlink, hardlink or special file"
  done < <(tar --absolute-names --quoting-style=escape -tvf "$input")
}
verify_archive() (
  local archive=$1 target=${2:-} temp entry digest path required
  [[ -f "$archive" && ! -L "$archive" ]] || fail "archive must be a regular file"
  temp=$(mktemp -d "$LOCAL_DIR/.verify.XXXXXXXX")
  trap 'rm -rf -- "$temp"' EXIT
  if ! age -d -i "$AGE_IDENTITY" -o "$temp/payload.tar" "$archive" 2>/dev/null; then
    rm -rf -- "$temp"; fail "decrypt or tar integrity verification failed"
  fi
  # Encryption to a public recipient does not authenticate the archive. Reject
  # unsafe members before extraction, and never accept a manifest path escape.
  check_tar "$temp/payload.tar" no
  if ! tar --no-overwrite-dir --no-same-owner --no-same-permissions -xf "$temp/payload.tar" -C "$temp" ||
     [[ ! -f "$temp/SHA256SUMS" || -L "$temp/SHA256SUMS" ]]; then
    rm -rf -- "$temp"; fail "archive extraction failed"
  fi
  while IFS= read -r entry; do
    digest=${entry:0:64}; path=${entry:66}
    [[ "$digest" =~ ^[0-9a-f]{64}$ && "${entry:64:2}" == "  " &&
       "$path" =~ ^(\.env|compose\.yaml|Caddyfile|start-https\.sh|Dockerfile|postgres\.dump|volumes\.txt|running-services\.txt|\./campaigns-(data|https-site|caddy-data|caddy-config)\.tar)$ ]] ||
      { rm -rf -- "$temp"; fail "unsafe checksum manifest"; }
  done < "$temp/SHA256SUMS"
  for required in .env compose.yaml Caddyfile start-https.sh Dockerfile postgres.dump \
    volumes.txt running-services.txt ./campaigns-data.tar ./campaigns-https-site.tar; do
    grep -Fq "  $required" "$temp/SHA256SUMS" ||
      { rm -rf -- "$temp"; fail "incomplete checksum manifest"; }
  done
  if [[ ! -s "$temp/postgres.dump" || ! -s "$temp/campaigns-data.tar" ||
        ! -s "$temp/campaigns-https-site.tar" ]] ||
     ! (cd "$temp" && sha256sum -c SHA256SUMS >/dev/null) ||
     ! docker run --rm -i --network none postgres:17.4-bookworm pg_restore -l < "$temp/postgres.dump" >/dev/null; then
    rm -rf -- "$temp"; fail "archive checksum or pg_restore listing failed"
  fi
  for required in campaigns-data campaigns-https-site campaigns-caddy-data campaigns-caddy-config; do
    [[ ! -e "$temp/$required.tar" ]] || check_tar "$temp/$required.tar" yes
  done
  if [[ -n "$target" ]]; then
    # Extract exactly the bytes just checked; do not reopen a mutable archive.
    tar --no-overwrite-dir --no-same-owner --no-same-permissions -xf "$temp/payload.tar" -C "$target"
  fi
  rm -rf -- "$temp"
)
case "$command" in
  verify|extract)
    [[ $# -ge 2 ]] || fail "archive required"
    if [[ "$command" == extract ]]; then
      [[ $# == 3 && "$3" == /* && -d "$3" && ! -L "$3" && -z "$(ls -A "$3")" ]] ||
        fail "extract requires an existing empty absolute non-symlink directory"
      [[ $(stat -c %a "$3") == 700 ]] || fail "extract directory must have mode 0700"
      verify_archive "$2" "$3"
      printf 'Verified contents extracted; no database or service was changed. Follow docs/operations.md restore isolation steps.\n'
    else
      verify_archive "$2"
      printf 'Verified archive; no database or service was changed.\n'
    fi
    exit ;;
esac
[[ $# == 1 ]] || fail "backup takes no arguments"
[[ -f .env && -f compose.yaml && -f Dockerfile && -f Caddyfile && -f start-https.sh ]] ||
  fail "run from an installed bundled Compose release"
for file in .env compose.yaml Dockerfile Caddyfile start-https.sh; do
  [[ ! -L "$file" ]] || fail "refusing symlinked runtime configuration"
done
[[ ! -e compose.override.yaml && -z "${COMPOSE_FILE:-}" && -z "${COMPOSE_PROJECT_NAME:-}" ]] ||
  fail "custom Compose configuration requires a separate coordinated backup plan"
[[ -n "$OFFHOST_LOCAL_DIR" && -z "$OFFHOST_SFTP_HOST$OFFHOST_SFTP_USER$OFFHOST_SFTP_DIR" ||
   -z "$OFFHOST_LOCAL_DIR" && -n "$OFFHOST_SFTP_HOST" && -n "$OFFHOST_SFTP_USER" && -n "$OFFHOST_SFTP_DIR" ]] ||
  fail "configure exactly one off-host destination (local mount or SFTP)"
if [[ -n "$OFFHOST_LOCAL_DIR" ]]; then
  [[ "$OFFHOST_LOCAL_DIR" == /* && -d "$OFFHOST_LOCAL_DIR" && ! -L "$OFFHOST_LOCAL_DIR" &&
     "$(realpath "$OFFHOST_LOCAL_DIR")" != "$(realpath "$LOCAL_DIR")" ]] || fail "invalid off-host mounted directory"
else
  [[ "$LOCAL_DIR" =~ ^/[a-zA-Z0-9_./-]+$ && "$LOCAL_DIR" != *..* &&
     "$OFFHOST_SFTP_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ &&
     "$OFFHOST_SFTP_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ &&
     "$OFFHOST_SFTP_DIR" =~ ^/[a-zA-Z0-9_./-]+$ &&
     "$OFFHOST_SFTP_DIR" != *..* ]] || fail "unsafe SFTP destination"
  [[ -z "$SSH_IDENTITY" || ( "$SSH_IDENTITY" == /* && -f "$SSH_IDENTITY" && ! -L "$SSH_IDENTITY" ) ]] ||
    fail "invalid SSH_IDENTITY"
  [[ -z "$SSH_IDENTITY" || ( $(stat -c %u "$SSH_IDENTITY") == "$(id -u)" &&
     $(stat -c %a "$SSH_IDENTITY") =~ ^(600|400)$ ) ]] ||
    fail "SSH_IDENTITY must be owned by this user with mode 0600 or 0400"
fi
for tool in docker sftp; do command -v "$tool" >/dev/null || fail "missing $tool"; done
setup_age
temp=$(mktemp -d "$LOCAL_DIR/.staging.XXXXXXXX")
archive="$LOCAL_DIR/campaigns-$(date -u +%Y%m%dT%H%M%SZ)-${temp##*.staging.}.tar.age"
[[ ! -e "$archive" ]] || fail "archive name collision"
stopped=0
original=
done_ok=0
offhost_temp=
finish() {
  local result=$? service attempt poll running health cid recovery_failed=
  trap - EXIT
  trap '' INT TERM
  if (( stopped )); then
    for service in campaigns https; do
      if grep -Fxq "$service" <<< "$original"; then
        local ready=0
        for attempt in 1 2 3; do
          if docker compose --profile https up -d "$service" >/dev/null; then
            for poll in 1 2 3 4 5 6 7 8 9 10; do
              running=$(docker compose --profile https ps --status running --services 2>/dev/null) || running=
              if grep -Fxq "$service" <<< "$running"; then
                if [[ "$service" == https ]]; then
                  ready=1
                else
                  cid=$(docker compose --profile https ps -q campaigns 2>/dev/null) || cid=
                  if [[ -n "$cid" ]]; then
                    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$cid" 2>/dev/null) || health=
                    [[ "$health" == healthy ]] && ready=1
                  fi
                fi
              fi
              (( ready )) && break
              sleep 2
            done
          fi
          (( ready )) && break
        done
        if (( ! ready )); then
          recovery_failed="${recovery_failed}${recovery_failed:+,}$service"
          result=1
        fi
      fi
    done
  fi
  [[ -z "$offhost_temp" ]] || rm -f -- "$offhost_temp"
  rm -rf -- "$temp"
  if (( result == 0 && done_ok )); then
    printf 'last_success_utc=%s\nlast_archive=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${archive##*/}" > "$LOCAL_DIR/last-success.tmp"
    mv -f -- "$LOCAL_DIR/last-success.tmp" "$LOCAL_DIR/last-success"
    printf 'last_result=success\nlast_attempt_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LOCAL_DIR/status.tmp"
    logger -t campaigns-backup 'verified encrypted off-host backup succeeded' || true
  else
    if [[ -n "$recovery_failed" ]]; then
      printf 'last_result=service_recovery_failed\nservice_recovery_failed=%s\narchive_complete=%s\nlast_attempt_utc=%s\n' \
        "$recovery_failed" "$done_ok" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LOCAL_DIR/status.tmp"
      if (( done_ok )); then printf 'completed_archive=%s\n' "${archive##*/}" >> "$LOCAL_DIR/status.tmp"; fi
      logger -t campaigns-backup "CRITICAL: service recovery failed: $recovery_failed" || true
      printf 'Campaigns backup: CRITICAL service recovery failed: %s\n' "$recovery_failed" >&2
    else
      printf 'last_result=failure\nlast_attempt_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LOCAL_DIR/status.tmp"
      logger -t campaigns-backup 'backup failed; investigate services and backup status' || true
      printf 'Campaigns backup failed; check service state and status.\n' >&2
    fi
    result=1
  fi
  [[ ! -f "$LOCAL_DIR/last-success" ]] || cat "$LOCAL_DIR/last-success" >> "$LOCAL_DIR/status.tmp"
  mv -f -- "$LOCAL_DIR/status.tmp" "$LOCAL_DIR/status"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
original=$(docker compose --profile https ps --status running --services)
grep -Fxq postgres <<< "$original" || fail "PostgreSQL must already be running"
grep -Fxq campaigns <<< "$original" || fail "Campaigns must already be running; refusing partial installation"
# Fail closed on any ambiguous delivery outcome, including historical unknowns.
query="SELECT count(*) FROM campaigns.jobs WHERE state IN ('sending','unknown');"
count=$(docker compose exec -T postgres sh -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$query") ||
  fail "cannot inspect delivery jobs"
[[ "$count" == 0 ]] || fail "sending/unknown jobs present (or query ambiguous): reconcile before backup"
stopped=1
docker compose --profile https stop https campaigns >/dev/null
count=$(docker compose exec -T postgres sh -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$query") ||
  fail "cannot recheck delivery jobs after quiescing"
[[ "$count" == 0 ]] || fail "sending/unknown jobs after stop; reconcile before backup"
app=$(docker compose --profile https ps -a -q campaigns)
[[ -n "$app" ]] || fail "Campaigns container missing"
volume() {
  local name
  name=$(docker inspect --format "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Name}}{{end}}{{end}}" "$1")
  [[ -n "$name" && "$name" =~ ^[a-zA-Z0-9_.-]+$ ]] || fail "missing named volume for $2"
  printf '%s' "$name"
}
save_volume() {
  docker run --rm --network none --mount "type=volume,src=$2,dst=/source,readonly" \
    busybox:1.37 sh -ec 'cd /source; tar -cf - .' > "$temp/$1.tar"
}
data=$(volume "$app" /var/lib/sendrepute-campaigns)
site=$(volume "$app" /var/lib/sendrepute-campaigns/https-site)
printf 'campaigns-data=%s\ncampaigns-https-site=%s\n' "$data" "$site" > "$temp/volumes.txt"
printf '%s\n' "$original" > "$temp/running-services.txt"
cp -- .env compose.yaml Caddyfile start-https.sh Dockerfile "$temp/"
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$temp/postgres.dump"
[[ -s "$temp/postgres.dump" ]] || fail "empty database dump"
save_volume campaigns-data "$data"
save_volume campaigns-https-site "$site"
https=$(docker compose --profile https ps -a -q https)
if [[ -n "$https" ]]; then
  caddy_data=$(volume "$https" /data)
  caddy_config=$(volume "$https" /config)
  printf 'campaigns-caddy-data=%s\ncampaigns-caddy-config=%s\n' "$caddy_data" "$caddy_config" >> "$temp/volumes.txt"
  save_volume campaigns-caddy-data "$caddy_data"
  save_volume campaigns-caddy-config "$caddy_config"
fi
(cd "$temp" && sha256sum .env compose.yaml Caddyfile start-https.sh Dockerfile postgres.dump volumes.txt running-services.txt ./*.tar > SHA256SUMS)
tar -cf - -C "$temp" . | age -r "$AGE_RECIPIENT" -o "$archive"
verify_archive "$archive"
if [[ -n "$OFFHOST_LOCAL_DIR" ]]; then
  [[ ! -L "$OFFHOST_LOCAL_DIR" && $(stat -c %a "$OFFHOST_LOCAL_DIR") == 700 &&
     $(stat -c %u "$OFFHOST_LOCAL_DIR") == "$(id -u)" ]] ||
    fail "mounted off-host directory must be owned by this user with mode 0700"
  offhost_temp=$(mktemp "$OFFHOST_LOCAL_DIR/.campaigns-upload.XXXXXXXX")
  cp -- "$archive" "$offhost_temp"
  cmp -- "$archive" "$offhost_temp" || fail "off-host copy mismatch"
  # Hard-link publication is atomic and fails for existing files AND dangling
  # symlinks. No cp -n/check-then-write race or overwrite is permitted.
  ln -- "$offhost_temp" "$OFFHOST_LOCAL_DIR/${archive##*/}" ||
    fail "off-host destination exists or does not support safe publication"
  cmp -- "$archive" "$OFFHOST_LOCAL_DIR/${archive##*/}" || fail "published off-host copy mismatch"
  rm -f -- "$offhost_temp"
  offhost_temp=
else
  batch=$(mktemp "$LOCAL_DIR/.sftp.XXXXXXXX")
  printf 'put %s %s/%s.part\nrename %s/%s.part %s/%s\n' \
    "$archive" "$OFFHOST_SFTP_DIR" "${archive##*/}" \
    "$OFFHOST_SFTP_DIR" "${archive##*/}" "$OFFHOST_SFTP_DIR" "${archive##*/}" > "$batch"
  ssh_args=(-oBatchMode=yes -oStrictHostKeyChecking=yes -oIdentitiesOnly=yes)
  [[ -z "$SSH_IDENTITY" ]] || ssh_args+=(-i "$SSH_IDENTITY")
  sftp "${ssh_args[@]}" -b "$batch" "$OFFHOST_SFTP_USER@$OFFHOST_SFTP_HOST" >/dev/null
  rm -f -- "$batch"
  # Read back encrypted remote bytes and compare; no plaintext is transferred.
  batch=$(mktemp "$LOCAL_DIR/.sftp.XXXXXXXX")
  remote_copy=$(mktemp "$LOCAL_DIR/.remote.XXXXXXXX")
  printf 'get %s/%s %s\n' "$OFFHOST_SFTP_DIR" "${archive##*/}" "$remote_copy" > "$batch"
  sftp "${ssh_args[@]}" -b "$batch" "$OFFHOST_SFTP_USER@$OFFHOST_SFTP_HOST" >/dev/null
  cmp -- "$archive" "$remote_copy" || fail "remote copy mismatch"
  rm -f -- "$batch" "$remote_copy"
fi
done_ok=1