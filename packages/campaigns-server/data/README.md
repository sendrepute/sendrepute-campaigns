# Disposable domain snapshot

Source: https://github.com/disposable-email-domains/disposable-email-domains

File: `disposable_email_blocklist.conf`, main branch, retrieved 2026-10-03.
This bundled snapshot contains 9,203 domains and is licensed CC0-1.0; the
upstream license is included as `DISPOSABLE-LICENSE.txt`.

Additional source: https://github.com/FGRibreau/mailchecker

File: `mailchecker-list.txt`, upstream `list.txt`, master branch, retrieved
2026-10-03. Contains 56,331 domains. The MIT copyright and permission notice
ships as `MAILCHECKER-LICENSE.txt`. The two snapshots form a deduplicated union;
neither replaces the other.

Runtime updates fetch only these fixed public files, conditionally using ETag.
They never execute upstream Python/shell scripts or upload email addresses.
The source itself warns that historical disposable classifications may no
longer apply. Campaigns flags matching addresses for review, not deletion.