# Residual probability, POD and clearance

Status: implemented 2026-09-16. Supersedes the binary zone-status workflow.

## Why this exists

Brantham, 15–16 September 2026. A three-year-old was reported missing from a
playground. Decoy Pond, 321 m away, was cordoned and reported **clear** on day 1.
He was found in it on day 2.

That is not a failure of the people who searched it. Water search has genuinely
low probability of detection — a shoreline walk-around for a submerged small
child might be POD 0.2. Missing him once was the statistically ordinary outcome.

The failure this document addresses is the one the *software* was complicit in:
**"searched" silently becomes "excluded", and the search moves outward.** A zone
board that renders a pond as a green "complete" chip tells an operator, at 3am,
on hour 30, that the pond is a solved problem. It was never a solved problem. It
was a 20%-confident look.

So: this system no longer has a state that means "done". It has a number that
means "how much probability is still sitting in here", and that number only
falls as fast as the evidence actually justifies.

## The model

### 1. POA is a weight, not a percentage

`search_zones.poa` is the **initial** planning weight, set once during planning
and never mutated by searching. Weights are normalised at read time, so operators
can type whatever relative numbers they like.

### 2. POA-outside is explicit

`search_operations.poa_outside` (default **0.15**) is the probability the subject
is outside the search area entirely — wrong datum, moving subject, abducted,
already walked out. Without it, renormalisation forces the zone weights to sum to
1 and quietly asserts the subject is definitely inside the rings. That assertion
is how search areas become prisons for the people planning them.

`poa_outside` is never reduced by searching, because you cannot search it. As
zones clear, it *rises* as a share — which is the correct and uncomfortable
signal that the area may be wrong.

### 3. POD comes from what was actually done

A sweep is a record, not a checkbox: `search_zone_sweeps` stores resource class,
method, conditions, coverage and the derived POD, plus `pod_basis` — the full
derivation, so any number on screen can be taken apart.

    effective_pod = base(resource_class, method)
                  × Π(condition modifiers)
                  × coverage
                  × correlation_penalty

Base values live in `server/pod-model.js`. They are **planning defaults drawn from
published SAR ranges, not values validated against this team's own performance.**
They are deliberately in one editable table so they can be argued with.

### 4. Repeat sweeps do not stack cleanly

Cumulative POD is `1 − Π(1 − pod_i)` — but only for *independent* looks. Sending
the same resource class with the same method over the same ground does not
produce an independent look; it tends to miss the same places for the same
reasons. So each repeat of a (resource_class, method) pair on a zone is
discounted:

    correlation_penalty = 0.7 ^ (n_prior_same_method)

This is the mathematical form of the Brantham lesson. Four shoreline walks of a
pond do not approach certainty; they asymptote well short of it, and the model
now says so out loud instead of letting four green ticks imply otherwise.

### 5. Residual is what the board ranks on

    weight_i    = poa_initial_i × (1 − cumulative_pod_i)
    total       = Σ weight_i + poa_outside
    poa_current = weight_i / total

`poa_current` is the posterior probability the subject is in zone *i* given that
everything searched so far has come up empty. **The zone board sorts on this.**

A consequence worth stating plainly, because it is the whole point: a zone that
has been searched three times can still sit at the top of the board. Priority is
what you believed at the start. Residual is what you know now.

## Clearance gates

`status = 'complete'` is no longer free. A zone reaches it only by:

1. **Evidence** — at least one recorded sweep, and `cumulative_pod >= 0.70`
   (configurable per operation), **or**
2. **Named risk acceptance** — `risk_accepted_by` / `_at` / `_reason` on the zone.
   Someone's name against the decision that this gap stays open.

High-consequence zones — any zone whose `search_method` is a water method, and
any zone flagged `high_consequence` — additionally require that a **subsurface-
capable** resource (sonar, dive, wade/pole) has swept them, or an explicit risk
acceptance. A shoreline walk can no longer close water.

The API refuses the transition and returns *why*, with the numbers. It is not a
warning dialog; warnings get clicked through.

## Water decomposes

Water zones expose three method slots — `shoreline`, `margins`, `subsurface` —
each tracked separately. The zone's water coverage is the weakest of the three,
not the best. Decoy Pond under this model, after a day-1 shoreline search, would
have shown roughly:

    ATT-1 Decoy Pond   cum POD 0.21   residual 0.081   subsurface NOT SEARCHED

instead of a green chip.

That is the entire argument for this change, in one line of a table.

## What this does not do

- It does not claim to predict where a subject is. It tracks how much of the
  original belief is left, and refuses to let confidence appear from nowhere.
- The POD numbers are defaults. Feed real outcomes back in and replace them.
- Independence between *different* resource classes is assumed. That is
  optimistic; a dog and a ground team both struggle in the same dense cover.
  The correlation penalty only handles same-method repeats today.
