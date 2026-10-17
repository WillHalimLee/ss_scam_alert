# Harbor: Your Personal Security Analyst

> Draft for team review. Items are tagged **[Core]**, **[Stretch]**, or **[Maybe]** so we can cut quickly.
> Sources: `data/HuskyHack_2026_Problem_Statement.docx`, the v2 data dictionary, `Member_Key_v2.csv` (118 members), `Synthetic_Events_v2.csv` (~7,470 events).
> Not in `data/`: the Starter Kit's "Capability Assumptions" and persona write-ups. We should get these before locking scope.

---

## 1. Pitch

**Harbor is a calm place to pause.** When an event stream shows a member at a moment of risk, Harbor holds the payment briefly and reaches the member through a trusted channel. A guided chat helps them slow down, see the facts, and choose. If anything is unclear, or the member doesn't answer, a real Sound employee takes over with the full context, so the member never repeats themselves.

Harbor's job is **slow down, here are the facts, here are your options, you decide.** It is not a fraud verdict and it never takes control from the member.

## 2. The problem

Sound has to spot a member being manipulated or compromised and step in before money moves. The problem statement rules out device, voice, carrier and message-content data, and it rules out "perfect knowledge" of fraud.

- **Authorized scam** (member sends the money): regulation mostly doesn't protect them, so the only defense is a well-timed human moment.
- **Account takeover (ATO)** (criminal sends it): detectable from the account's own event trail, and the speed of the attack is the giveaway.

Judging: Member Safety 30%, UX & Trust 25%, Feasibility 20%, Innovation 15%, Prototype 10%. Ties break on harm prevention, then trust and accessibility.

## 3. What the data tells us

**Loss by scenario (synthetic, 12 members each; never cite as real fraud rates):**

| Scenario | Attempted | Sent | Net loss |
|---|---|---|---|
| Family emergency (grandparent / fake attorney) | $111,750 | $61,000 | $49,658 |
| Romance / investment | $93,941 | $77,864 | $77,864 |
| Tech support / federal impersonation | $97,000 | $55,500 | $51,192 |
| Sound impersonation + ATO | $37,855 | $19,245 | $15,666 |

**Findings that shape the design:**

1. **The ATO signature is fast and clean.** In all 12 ATO members: password reset, then email and phone change, then new recipient, then first payment, within about 20 minutes. Prevented cases used a confirmation to the **pre-change phone**; the losses had no such step. The alert in the data went to the *old email*, which an attacker who has reset the password doesn't need.
2. **A naive ATO rule also fires on the 4 "real password reset and move" look-alikes.** The real movers change **only their address** and pay about **a day later** (M1039 and M1041, about 25h). ATOs change email *and* phone and pay within 10–20 minutes.
3. **Warnings alone fail.** In romance scenarios, all 34 `Warning Displayed` events ended in `Confirmed Intended`. Human outreach did better: 6 of 8 became `Requested Help`.
4. **Amount can't separate scams from look-alikes.** The $51K home-closing wire (held 3–4 hours, a false positive that cost the member time), the $1,188 grandchild P2P, and growing transfers to a member's own new brokerage account all resemble scams on the numbers. Only the member can supply the missing context: *who* is being paid and *why*.
5. **Trusted contact looks protective.** 12 members enrolled one: 8 Prevented, 4 Partial Loss, 0 full losses. Most enrolled in the branch mid-crisis, which is late. This is an observation on synthetic data, not proof.
6. **Slow-burn romance scams have a visible ramp.** Michael (M1002) goes from small P2P to recipients under 14 days old, then to wires of $1,500, $2,400, $3,840. The shift from P2P to wire with a recipient 30 days old or newer is the moment to act.
7. **Cash and wire carry the largest unrecoverable losses** ("reported next day; unrecoverable", cash to a courier).
8. **Timing gives us a window.** `Payment Initiated` starts as `Pending`. Sarah's payments took 14 minutes to complete. Routine P2P takes 1–3 minutes.

## 4. The trigger: event-based, two stages **[Core]**

Event-based triggering is allowed. The brief lists payment, timing, new-recipient, profile-change and password-reset data as available, and bans only device, biometric, voice and carrier data. In production these would be events on a stream. In the demo we replay the CSVs as a stream.

| Stage | Event(s) | What Harbor does |
|---|---|---|
| **Arm** | Password reset, then email and/or phone change, then recipient added | Silently marks the account "elevated". No member-visible action yet. |
| **Decide** | `Payment Initiated`, evaluated with account state, rail, recipient age, and baseline ratio | Holds the payment and starts the Harbor check-in. |

**The trigger starts a check-in, not a scam verdict.** Rules are transparent and each shows its reason to the member and to staff.

| Trigger | Signals used | Scenario |
|---|---|---|
| **ATO Fast-Change** | Reset recent + email *and* phone change + new recipient + payment within about 60 min | ATO |
| **Slow-burn Ramp** | Repeated payments to a recipient 30 days old or newer, rising amount vs baseline, rail moving P2P to wire / external transfer | Romance / investment |
| **High-Stakes Rail** | Outgoing wire or cash, new recipient or "Significantly Above Typical" (4x baseline or more) | Grandparent, federal impersonation |
| **Fresh-Recipient Urgency** | New recipient + 1.5x baseline or more on P2P | Family emergency |
| **Contact-then-Pay** | Branch visit or contact-center call shortly before a large payment | Tech support / federal |

**Look-alike suppression ("Why this is probably you")** **[Core]**:
- Address-only change plus a gap of more than about 12 hours before payment: light confirmation only (M1039, M1041).
- Member's own newly linked external account: confirm once, then trust it (M1064, M1090, M1101).
- Large wire matching a **Planned Big Payment** the member declared in advance: quick callback instead of a long hold (M1057, M1067, M1075, M1104).
- Member-labelled recipient plus stated reason (landlord, contractor): lower friction.

## 5. The Harbor flow

```
Event stream → Trigger (Arm / Decide) → Hold payment (time-limited)
      → Out-of-band notice (pre-change phone / authenticated app only)
      → Harbor chat (guided, scripted) ──► member says "this is me, here's why" → release / light confirm
                     │                  ──► member cancels                    → payment cancelled, aftercare
                     │                  ──► member wants a person / unclear   → human handoff w/ summary
                     └─ no response (timeout) ───────────────────────────────→ human outreach, safe default
```

### 5.1 Notification: safe channel **[Core]**

- **ATO path:** the attacker has the session and has changed email and phone. Harbor sends the check-in to the **pre-change phone/email**. The chat link only works inside an authenticated app, and "Not me" in the check-in freezes new recipients and opens a case. We never run the chat inside a session we suspect is the attacker's.
- **Phishing-proof by design:** the Sarah scenario starts with a fake Sound text, so our message must not look like one. Rules: the notification never asks for credentials or codes, the link goes only to the authenticated app, and every message says "Sound will never ask you to move money."
- **No-smartphone / not-digital members:** phone call or branch equivalent for every step (Linda and James are branch and phone people).

### 5.2 Harbor chat agent **[Core]**

- **Scripted decision tree; LLM for tone and summaries only.** The agent has no ability to release payments or change account state. This addresses hallucination, prompt injection by the member or a scammer on the line, and a scammer probing the bot to learn the rules.
- **Honest framing:** "You're in control. Here's what I noticed. Here's what you can do." We do not say "calm down" or promise "all the power", since a payment the member authorizes is largely their liability and we should say so plainly.
- **Open, scenario-specific questions instead of yes/no** (coached members will say "yes, it's me"). Examples:
  - "Who asked you to send this, and how did they reach you?"
  - "Did anyone tell you to keep this secret or stay on the phone?"
  - Cash: "Is someone waiting to collect this?"
  - New-recipient wire: "Have you met this person in person?"
- **Gathers context, never judges.** Output is a short summary for a human plus a suggested next step.
- **Always offers:** talk to a person, ask my trusted contact, cancel, continue.

### 5.3 Human handoff **[Core]**

- The employee console shows trigger reason, event timeline, chat summary, payment details, and suggested open questions (Conversation Coach). The member does not repeat their story.
- **No-response path:** a timeout starts employee outreach. Safe default depends on the rail: wires and cash default to hold; P2P is gentler.
- **After-hours:** Sarah's takeover was at 10pm and reported two days later. Out of hours, ATO-pattern payments stay held, the member gets a clear message and a callback time, and the case is first in the morning queue.

### 5.4 Override and appeal **[Core]**

- After a human conversation, if the member still wants to send, we respect it. We log it, explain plainly that authorized payments are harder to recover, offer a follow-up check-in and a recall checklist (M1001 Linda's override is the honest example).
- A held legitimate member can appeal in the chat, with a target time to resolution that beats the 3–4 hour hold in the data.

### 5.5 Trusted Circle **[Core, with guardrails]**

- Offered **early and calmly** (at milestones or after a mild nudge), not only mid-crisis at the branch.
- Voluntary, revocable, member-directed. The contact is **informed, never given account access**. Message: "Linda asked us to let you know she's about to make a large payment. You may want to call her."
- **Caregiver / relative-is-the-exploiter case:** "Talk to Sound first" is always an option, and Harbor never contacts anyone without the member's choice. A one-tap "I'd rather not involve anyone" has no penalty.
- No restrictions based on age or other demographic traits. Triggers are behavioral only.

### 5.6 Recovery and aftercare **[Core, lightweight]**

- "Something feels wrong" button in app, chat and branch, leading to a guided wire-recall / P2P dispute checklist and warm human follow-up (no blame language).
- Employee case timeline of the events leading up to the case. A check-in about 7 days later.

## 6. Features that make it different (Innovation, 15%)

| # | Idea | Why interesting | Feasibility |
|---|---|---|---|
| 1 | **"Why am I being asked?" card**: exact reasons in plain words, with a "that's wrong because…" reply that feeds the look-alike logic and the employee view | Trust; false positives become a feature | High |
| 2 | **Planned Big Payment**: member pre-declares a closing or purchase to pre-clear the wire | Directly fixes the 4 home-closing false positives; coached scams usually aren't pre-declared | High |
| 3 | **Adaptive scam-script questions** per rail and context | Beyond generic warnings | High |
| 4 | **Friction at recipient setup**, not only at payment | Earlier for slow-burn scams (M1002's `intervention_candidate`) | Medium |
| 5 | **Employee Conversation Coach** panel | Strong employee-facing story | High |
| 6 | **Trigger simulator**: replay any of the 118 members; slider shows missed scams vs false positives as thresholds change | Proves both false-positive and miss honestly (required by the brief) | Medium |
| 7 | **Old-contact confirmation with one-tap "Not me"** for ATO | Proven pattern in the data | High |

Recommendation: commit to #1, #2 and #6, and fold #5 and #7 into the core flow.

## 7. Prototype plan

**Phase 1 (Sat, 2-min pitch):** story-led, using Sarah and Linda, with the Harbor chat screen mockup.

**Phase 2 (Sun, 5-min live demo, up to 10 slides, prototype link):** a clickable app with three surfaces:
1. **Member app (mobile web):** notification, then Harbor chat, then "Why am I being asked?", then continue / cancel / trusted contact / talk to a person, then aftercare.
2. **Employee console:** held-payment queue with trigger reasons, handoff summary, Conversation Coach, release / hold / escalate / recovery actions.
3. **Trigger simulator** **[Stretch]** over the CSVs.

Stack: single-page React or plain HTML/JS, CSVs pre-processed into JSON, no real backend. A scripted chat tree is deterministic, so the demo can't go off the rails.

### Required walk-throughs

| Required | Member | Walk-through |
|---|---|---|
| Anchor persona | **M1003 Sarah (ATO)** | Reset 22:09, email/phone change 22:14, recipient 22:19, payment 22:22. Arm at the profile change; Decide at the payment. Check-in goes to the *old* phone; one-tap "Not me" freezes recipients. Actual outcome: $3,006 lost. |
| Anchor persona | **M1001 Linda (authorized)** | Wire hold, chat, human handoff, and the override. Shows Harbor's honest limit and the recovery path. |
| Look-alike | **M1039 / M1041 (real reset + move)** | Same flags as Sarah on a naive rule. Address-only change and next-day payment, so light confirmation and release. |
| Look-alike | **M1057 ($51,587 closing wire)** | Without Planned Big Payment: 3–4 hour hold. With it: quick callback. |
| Scam we miss | **M1002 Michael (slow-burn romance)** | Early small P2Ps look normal. Harbor first acts at the wire escalation, not payment #1. Show what it still prevents and the recovery help. |

## 8. 90-day pilot concept **[Core]**

- **Scope:** one region plus mobile; new-recipient wires, cash above threshold, and ATO sequences only.
- **Days 1–30 shadow mode:** rules run silently; staff review flags. **31–60:** live for wires, cash and ATO with chat and human outreach. **61–90:** add Trusted Circle prompts and Planned Big Payment.
- **Metrics** (targets are assumptions against Sound's own baselines, not from synthetic data):
  - Share of triggered authorized-scam attempts ending in a cancellation or a human conversation.
  - Time from trigger to member response and to human contact; hold time for verified-legitimate members (goal: less than the 3–4h in the data).
  - False-positive rate and friction minutes per legitimate member.
  - Trusted Contact enrollment, and how many enrolled before an incident.
  - Dollars intercepted vs flagged; recovery success rate.
  - Chat completion rate; share handed to a human; member trust survey ("I felt respected").
  - Staff load: cases per staff member per day.
- **Baselines:** pulled from Sound's real loss and hold data at pilot start. Example target: "halve median hold time for verified-legitimate wires". Marked as assumption.

## 9. Privacy, accessibility, responsible design **[Core]**

- Only event fields already in the dataset plus what the member tells the chat. No device, voice, carrier or message-content data. No claim of certainty about fraud.
- **Behavior-only triggers; no age or demographic inputs.** State this explicitly.
- Chat transcripts: minimal retention, shared only with the handling employee, and member told what is shared.
- Every trigger explains itself; every hold is time-limited and has a way out.
- Accessibility: plain language (about 6th-grade), large touch targets, screen-reader labels, phone and branch alternatives for every digital step, translations for top languages, no countdown pressure, no scare language.
- Trusted-contact data minimized, consent logged, revocable anytime; messages contain no account details.
- Audit log and periodic review of who gets flagged. Human review before any account restriction. Cap nudges per member per week to limit alert fatigue.

## 10. Risks and limitations

- **Authorized scams are hard.** Coached members will say "it's me." Harbor reduces harm and does not stop every case, and we say so.
- **Thresholds are tuned on synthetic data.** Fine for a demo; the shadow-mode period is the real test.
- **Staff capacity** for human conversations and after-hours coverage needs an estimate.
- **Chat reach:** some members won't use it; the phone and branch paths must be real.
- **Missing Starter Kit.** Hold mechanics per rail (especially P2P) may need adjusting once we see the capability assumptions.

## 11. Open questions for the team

1. Who builds what: member UI, employee console, data prep and simulator, pitch and deck?
2. Do we commit to the simulator (#6)? It raises the Prototype and Feasibility scores but costs time.
3. Can we get the Starter Kit's Capability Assumptions and persona details from the organizers or at Q&A?
4. Chat tone: how warm vs. concise? We should test the copy with a few people outside the team.
