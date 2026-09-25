# Comparing two campaign variants

A/B experiments compare two frozen versions of one campaign. They do not send
anything when created, do not choose a winner before the configured requirements
are met, and never automatically send the winner to the remaining audience.

## Prepare and start

1. Prepare a draft campaign with its sender, provider, template, subject and
   selected audience. This becomes variant A.
2. Open **A/B tests** and select that campaign. Choose variant B's template and
   subject.
3. Declare one winner metric: provider-observed delivery, open or click rate.
   Choose the total percentage used for the test, the minimum accepted sends
   required **in each variant**, and the minimum observation time.
4. Create the experiment. Content and audience membership are frozen. Addresses
   are assigned deterministically to disjoint A, B and remainder groups. Each
   test arm receives the same number; rounding stays in the remainder.
5. Inspect the frozen subjects and audience counts, then explicitly start the
   test. Only A and B are queued. The remainder is held.

An experiment reserves its campaign. Ordinary campaign editing, scheduling and
sending cannot replace or bypass its snapshots. Changing a source template does
not change already-frozen variant content. Current unsubscribe and suppression
checks still apply at delivery time.

## Read the result

The denominator is the number of distinct test deliveries accepted for sending.
The numerator is the number of those deliveries with a matching event for the
declared metric. Repeated events for the same delivery count once. Remainder
deliveries do not contribute to the A/B comparison.

Rates describe observed provider events, not guaranteed human behavior.
Tracking blockers, privacy proxies, bots and provider support can affect open
and click measurements. An accepted send is not proof of inbox placement or
delivery. If the provider does not supply the chosen event, the experiment
cannot invent a result.

Evaluate after the minimum wait and accepted sample have been reached. The wait
starts from the latest accepted send in each arm, not merely the start button;
queued, sending or uncertain deliveries keep the comparison waiting. Waiting,
insufficient samples, no observed events, or tied rates do not produce a winner.
A winner means a higher observed rate for the declared metric; it is **not a
claim of statistical significance**. Once recorded, the decision is fixed and
cannot flip because of later events.

## Approve the remainder separately

After a winner is recorded, an authorized sender can explicitly approve sending
its frozen content to the held remainder. This is a separate action from
starting or evaluating the experiment. Retrying the action does not create
duplicate deliveries, and original A/B recipients cannot enter the remainder.
Do not approve if you only want a comparison.

Use delivery history for operational failures and uncertain transport outcomes;
an ambiguous result must not be treated as permission to resend.

## Try without sending

The browser demo is isolated from real provider transport. Its observation
controls simulate local results and elapsed time; they are not available as
server shortcuts. Demo data is illustrative, not a real campaign result.

## Installation and recovery

The standalone server applies its numbered PostgreSQL migrations at startup.
Keep the whole installation database when backing up experiment history:
frozen assignments, delivery history and winner decisions belong together.
The portable business-record backup is not a delivery-history replay tool.
Consult the server's `BACKUP.md` before restoring records.