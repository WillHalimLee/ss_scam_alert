# Harbor: Phase 2 review

> Draft for us to review together. Tags: **[Must]** before the 3:00pm deadline, **[Should]** if time allows, **[Investigate]** unknown, find out first, **[Decide]** needs our call.
> Written Sat Oct 17 from the repo state at `5c76e5b` plus uncommitted work (theme and styling).

## 1. What Phase 2 is

From the problem statement and agenda:

| Item | Detail |
|---|---|
| Format | **5-minute live demo + 3-minute Q&A**, up to **10 slides**, prototype link due by the deadline |
| Deadline | **Sun Oct 18, 3:00pm** submission, presentations from 3:15pm, winner at 5:30pm |
| Prize | One $15,000 award |
| Judging | Member Safety 30, UX & Trust 25, Feasibility 20, Innovation 15, Prototype & Presentation 10. Ties: harm prevention, then trust and accessibility |

Phase 1 was a 2-minute pitch. Phase 2 is a **live demo**, so what matters most is that it works on stage, tells one clear story, and handles the hard questions.

## 2. Where we are

**Done and working**

- Trigger engine (Arm and Decide), `harbor/engine.js`. `task test`, run today: **48/48 scam and ATO members held, 7/70 legitimate held** (6 of those are large wires or cash purchases), 0 missed.
- Prototype with 7 tabs: Member app, Employee console, How triggers fire, Simulator, Architecture, Live pipeline, Design notes.
- Live AI chat (Ollama qwen2.5:14b is installed locally) with a reply filter and code-controlled options, plus a model inspector.
- Streaming backend: Redpanda, Postgres, scorer, tagger, agent service, retro job. `task run` launches it all.
- Hosted static prototype on GitHub Pages, a 10-slide pitch deck as PNGs, and `SUBMISSION.md`.

**Uncommitted work in progress:** light/dark theme, fonts, new styles across `harbor/` and `docs/`.

## 3. Problems found today (fix first) **[Must]**

| # | Problem | Evidence | Fix |
|---|---|---|---|
| 1 | **`harbor/server.js` is broken by the uncommitted edit.** The new `// dev server: ...` comment sits on the same line as `fs.createReadStream(f).pipe(res);`, so the pipe is commented out. Every static file request would hang. | `git diff harbor/server.js` | Move the comment to its own line. Restart and load the app through `localhost:8787`. |
| 2 | **`docs/index.html` loads `theme.js`, but `docs/theme.js` doesn't exist.** `harbor/theme.js` is also untracked. The hosted site would 404 on it. | `ls docs/theme.js` | Add `theme.js` to the copy list in `task pages`, copy it, commit it. |
| 3 | `task pages` copies a fixed file list, so it will keep missing new assets. `docs/index.html` and `docs/style.css` already differ from `harbor/`. | `diff -rq harbor docs` | Re-run after fix 2. Consider copying everything except the dev-only files. |
| 4 | The theme change pulls fonts from Google Fonts. | `harbor/index.html` | **[Investigate]** Does the demo venue have reliable wifi? Add a system-font fallback so a blocked CDN can't break the look. |
| 5 | **No `package.json` or test script at the root.** `task test` is the only check, with no CI. | repo root | **[Should]** Run `task test` before each publish. |

## 4. Required-submission checklist

| Required by the brief | Where it lives | Status | Gap |
|---|---|---|---|
| Clickable prototype / working demo | `harbor/`, `docs/`, Pages link | Done | Verify the live link after fixes 1-3 |
| Member story and journey | Member app, Sarah and Linda | Done | Rehearse the order |
| Trigger, intervention, data used, role of people | How triggers fire, Console | Done | Make sure one slide says what data we use and don't use |
| False-positive path, appeal, override | Planned Big Payment, M1057, Linda's override | Mostly | **[Investigate]** Is the **appeal** (a held legit member contesting a hold) visible in the UI, or only in the design notes? |
| 90-day pilot with baseline and target assumptions | Slide 10 | Done | Re-check wording: no real fraud rates |
| Privacy, accessibility, responsible design | Slide 8, Design notes | Partial | No evidence of actual accessibility testing (see section 6) |
| Anchor persona walk-through (M1001-M1004) | Sarah M1003, Linda M1001 | Done | |
| One legitimate look-alike | M1039, M1057 | Done | |
| A scam we miss, shown honestly | M1002 Michael | Done in design | **[Investigate]** The engine reports 0 missed in-sample. Be ready to explain why Michael still counts as a "partial" (first flag only at the wire escalation, `sentBeforeFlag` $747.77). |
| Trusted contact: voluntary, revocable, informed not given access, may be the exploiter | Trusted Circle | Present | Check the demo shows "I'd rather not involve anyone" and the relative-is-the-exploiter case |

## 5. Mapping to the judging criteria

| Criterion | Our strongest evidence | Weakest point | Work to do |
|---|---|---|---|
| **Member Safety (30)** | Hold before the scam payment in 48/48; ATO check-in goes to the *pre-change* phone | In-sample only. $17.8K still sent before the first flag across scam members. | Say the limits out loud. **[Investigate]** Which cases lose money before the first flag, and can Slow-burn or Contact-then-Pay act earlier? |
| **UX & Trust (25)** | Honest, non-blaming tone; look-alike suppression; "Why am I being asked?" | Tone never tested on a real person | **[Should]** 3 outside people read the chat copy (see section 6) |
| **Feasibility (20)** | Real streaming pipeline, outbox, DLQ, one case per member | Delivery is a stub; single broker; unknown capability assumptions | **[Investigate]** Ask organizers for the Starter Kit's Capability Assumptions (we've never seen it) |
| **Innovation (15)** | Planned Big Payment, old-phone confirmation, "AI never controls money" | Judges may have seen "AI chat + rules" before | Lead the demo with the Arm/Decide idea and the look-alike fix, not the chat |
| **Prototype & Presentation (10)** | Employee and member surfaces both shown | Live demo risk (model latency, Docker, wifi) | Section 7 |

## 6. Investigations and improvements

### 6.1 Demo reliability **[Must]**
- Run the full flow end to end on the demo machine twice: `task run`, a Sarah replay, the live chat, and the console receiving the case.
- **[Decide] Live AI or scripted chat on stage?** qwen2.5:14b can take several seconds a reply and may stall. Recommendation: **default to the scripted guided chat** and show Live AI as one planned moment, with the model inspector open. A fallback exists if no provider answers, but confirm it kicks in fast (timeout is 9s in `agent.js`).
- Prepare a screen recording of the full demo as a backup, since a dead laptop or wifi shouldn't end the pitch.
- Confirm Docker, Ollama, and ports 8787/8790 are free on the demo machine. Run `task status` as the pre-flight check.

### 6.2 Model safety evidence **[Should]**
- Our submission claims we found and fixed shared-password, family-pressure and prompt-injection failures. **[Investigate]** Is there a saved list of those test prompts and their results? If not, write 10 to 15 adversarial prompts and capture the results from the inspector. It makes the "AI never controls the money" claim concrete for Q&A.
- Check that the filter blocks: promising a refund, saying a payment is "safe", asking for a code or password, and blaming the member.

### 6.3 Evaluation honesty **[Should]**
- Rules were tuned on the same 118 members they are scored on. We say so, but a judge will ask "what about new data?" **[Investigate]** Can we do a cheap robustness check: perturb thresholds (the Simulator slider) and show the catch/false-hold curve is stable? Or hold out members, even though tuning has already seen them.
- 6 of the 7 held legit members are large wires or cash purchases. **[Decide]** Is that an acceptable number to present? Answer to rehearse: "a quick callback, not a long hold", and the pilot's shadow mode measures the real rate.

### 6.4 UX, trust and accessibility **[Should]**
- Run a quick accessibility pass on the member app: keyboard-only, a screen reader on the Sarah flow, contrast in **both** themes, text at 200% zoom, touch target size. Note what we fixed.
- The brief wants "diverse member needs": **[Investigate]** do we show the phone/branch path for members without a smartphone (Linda, James)? One screen or one sentence is enough.
- Language: the design notes mention translations, but the app is English only. State it as a pilot item, don't imply it's built.
- Have 3 people outside the team read the chat copy and say how it feels (warm, pushy, confusing).

### 6.5 Feasibility story **[Should]**
- Get the Starter Kit **Capability Assumptions**. Check each rail's hold mechanics (especially P2P, which completes in 1-3 minutes) against what we assume. Ask at the morning overview (9:30) or find a mentor.
- Be ready to answer: "Can Sound actually hold a P2P payment?" and "Who staffs the human handoff after hours?" **[Investigate]** Rough staffing estimate: held cases per day at the pilot's scope.
- Backend known gaps (from `backend/ARCHITECTURE.md`): no consumer-lag alert, wall-clock vs event-time case timeouts, single Redpanda node, delivery stub. All are fine to name as "pilot hardening".

### 6.6 Product ideas, only if time remains **[Maybe]**
- Friction at recipient setup, not only at payment (idea #4 in `proposed_idea.md`).
- Recovery checklist walk-through for a payment that already went out.
- Slow-burn: show the ramp earlier, before the first wire.
- A 7-day follow-up check-in screen.

## 7. The 5-minute demo

Timing is tight, and a demo with seven tabs will run long. Suggested script (about 4:45, leaving buffer):

| Time | Beat | Surface | Message |
|---|---|---|---|
| 0:00 | Problem in two sentences | Slide | Authorized scams leave members most exposed, so the only defense is a well-timed human moment |
| 0:20 | **Sarah (ATO)**: reset, email/phone change, new recipient, payment in 13 minutes | How triggers fire chart | Arm silently, Decide at the payment. Speed is the signal |
| 1:10 | Check-in goes to the **old phone**, one-tap "Not me" | Member app | Not the old email the attacker already controls |
| 1:50 | Employee takes over with full context | Console | Member never repeats their story |
| 2:30 | **M1057 look-alike**: $51K closing wire | Member app + Planned Big Payment toggle | Same numbers as a scam. A declared plan turns a 3-4 hour hold into a quick callback |
| 3:10 | **Live AI chat**: honest, non-blaming, can't touch the money | Member app + inspector | One planned prompt only |
| 3:50 | **What we miss**: Michael (slow-burn) | Simulator or console | Honest limit, and what we still do |
| 4:20 | Pilot and what's next | Slide | Shadow mode first, real rates measured, not claimed |

**[Decide]** Who drives the keyboard and who speaks? One person talking while another clicks avoids dead air.

**Slides:** keep the existing 10 (`submission/slides-16x9/`). **[Decide]** Does the order still fit the demo above, or do we move the "what we miss" slide up front? The deck is PNGs, so edits mean regenerating images. Find out where the source lives. **[Investigate]** It isn't in the repo.

## 8. Q&A prep (3 minutes)

Rehearse short answers:
1. "Your results are in-sample. How do you know it works?" (6.3)
2. "What if the scammer coaches the member to say 'it's me'?" (open questions, human handoff, honest limit)
3. "Can the AI release a payment?" (No. Code decides the options. Show the inspector.)
4. "What if the person exploiting them is a family member or caregiver?" (Trusted contact is optional, "I'd rather not involve anyone" has no penalty, Talk to Sound is always an option)
5. "How many false holds will members actually see?" (Shadow mode first. In-sample 7/70.)
6. "Can Sound build this?" (Rules plus events they already have; delivery and the hold mechanics are the pilot work)
7. "Do you restrict people by age?" (No. Behavioral triggers only.)

## 9. Timeline (Sunday)

| Time | Task |
|---|---|
| Tonight | Fix problems 1-3, commit, get the Capability Assumptions question to organizers |
| 9:30 | Phase 2 overview: note any new requirements |
| 9:40-11:00 | Section 6.1 and 6.2: reliability, model safety evidence |
| 11:00-12:00 | Accessibility pass, tone test, evaluation robustness |
| 12:00-1:00 | Lunch, first full rehearsal with a timer |
| 1:00-2:00 | Fixes from rehearsal, record the backup video, final `task pages` and push |
| 2:00-2:30 | Verify the hosted link, update `SUBMISSION.md`, final pre-flight (`task status`) |
| **3:00** | **Submit prototype link** |

## 10. Decisions for us

1. Live AI vs scripted chat as the demo default? (Recommendation: scripted, with one live moment.)
2. Which "maybe" items in 6.6, if any, are worth the risk this late? (Recommendation: none. Polish, rehearse, test.)
3. Do we change slide order or content, and where is the editable source?
4. Who speaks and who drives the demo?
5. Do we spend time on a held-out or robustness check, or only explain the limit?
6. Do we publish the dark-mode work, or revert to the committed look if it can't be verified in time?
