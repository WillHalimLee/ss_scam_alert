# Harbor quality review

Working log for a 5-iteration quality pass (more only if needed). Nothing is committed. Each iteration appends below.

## Plan

**Scope**: `harbor/` (prototype UI, engine, chat agent, dev server), `backend/` (Kafka/Postgres pipeline, agent service), `scripts/`, `Taskfile.yml`.
`docs/` (GitHub Pages copy) is intentionally left alone (paused per project memory) and `submission/` is static assets.

**Baselines to protect** (re-checked every iteration):
- `node harbor/test_engine.js`: 48/48 scam members caught, 7/70 legit held (7 look-alikes), 3 light-confirm. Anchor holds: M1001 HIGHSTAKES+CONTACT $8,500, M1002 RAMP $1,500, M1003 ATO $1,574, M1004 HIGHSTAKES+CONTACT $7,000, M1039 none, M1057 HIGHSTAKES+CONTACT $51,587.
- Every `/api/*` route answers as before; the 7 demo stories run end to end.

**Users and their routes**
| User | Surface | Routes |
|---|---|---|
| Member | Member app (phone mock) | `/api/demo/start`, `/api/demo/send`, `/api/demo/state`, `/api/cases/:id/reply` (Live AI), `/api/cases/:id/log` (guided), `/api/cases/:id/resolve`, `/api/chat` (no backend) |
| Employee | Employee console | `/api/console`, `/api/demo/state`, `/api/cases/:id/takeover`, `/api/cases/:id/action`, `/api/cases/:id/log` (employee messages), `/api/traces` (model log) |
| Developer / judge | Dev tools: simulator, architecture, live pipeline, inspector | `/api/pipeline`, `/api/cases`, `/api/cases/:id`, `/api/review`, `/api/retro`, `/api/analyst/run`, `/api/traces*`, `/api/status` |

**Iterations**
1. **Baseline + dead code.** Start the stack (Colima, Kafka, Postgres, workers, Ollama). Hit every route. Walk all 7 stories (Sarah ATO, Linda, Michael, James, mover, closing ± planned, contractor) through the API. Remove unused code. Record bugs.
2. **Agent quality.** Build a repeatable eval harness: scripted member conversations per story against the live `qwen2.5:14b` chat agent and the first-message composer. Judge every reply (tone, one question, no premature scam talk, correct signals, guardrails). Improve prompt / guardrails / signal handling; re-run and compare.
3. **Bug fixes from walkthroughs.** Backend correctness (route edge cases, staff wording leaking to members, case lifecycle), UI flow logic.
4. **Simplification.** Collapse duplicated helpers (server static serving, API constants, Ollama fetch code), dead branches, redundant state.
5. **Regression + extras.** Full re-run of engine test, routes, stories, agent eval. Add a smoke test task if it pays off. Write the summary.

Rule for new ideas: if anything that already worked breaks, drop the idea and note it here.

---
## Iteration 1: baseline, walkthroughs, dead code

**Environment**: Colima started; `task run` brought up Redpanda, Postgres, scorer, tagger (`qwen2.5:3b`), analyst and agent (`qwen2.5:14b`) on :8787. Later restarted with `backend/scripts/start-all.sh` so services can be restarted one at a time.

**Walkthrough (all 8 story runs through the real API: start, stream, send, Live AI reply, console, takeover, employee message, hand back, action)**
| Story | Decision | Opening message | Result |
|---|---|---|---|
| M1003 Sarah (ATO) | hold, ATO, 3 ms | LLM | ok |
| M1001 Linda | hold, HIGHSTAKES+CONTACT | **template** (LLM dropped the "never ask" line) | ok, agent weak (see below) |
| M1002 Michael | hold, RAMP | LLM | ok, wrong signal |
| M1004 James | hold, HIGHSTAKES+CONTACT | LLM | **best reply blocked by guardrail false positive** |
| M1039 mover | none, no case | - | ok |
| M1057 closing | hold | **template** | agent re-asks what was answered |
| M1057 + Planned | confirm | **template** (LLM echoed "NOT paused or blocked") | same |
| M1049 contractor | confirm, FRESH | **template** | verified member gets no signal |
All routes answered; history streams in ~2.5-3.3 s; rules decide in 2-7 ms; first message 4-9 s.

**Bugs found**
1. `POST /api/cases/:id/resolve` on an unknown/reset case returns **500** (FK violation). The UI fires resolve after a story reset race. *Fixed*: 404 like the other case actions.
2. `POST /api/chat` with a bad body returns 502 "agent unavailable" instead of 400. *Fixed*.
3. Guardrail regex `(it's|this is) ... safe\b` blocks "It's safe to hang up and call back", the single most important sentence for James (government impersonation). The safe fallback then *drops* the "officials never ask you to move money" warning. (iteration 2)
4. Composer falls back to the template in 4/7 runs: the model omits "never ask" (Linda, M1057), writes "South Sound", or copies the instruction `the payment is NOT paused or blocked: do not ...` verbatim into the message for light checks. (iteration 2)
5. Chat agent (`qwen2.5:14b`): asks two questions at once (Linda); re-asks what the member already said (M1057, Michael); sets `unverified_contact` for a member who said they called the title company on the number from their paperwork; never sets `member_verified`/`own_initiative` for M1057 or the contractor, so the code-gated "This looks fine, continue" button can **never** appear for legitimate members; misses `growing_amounts` ("returns growing every week") and sets `unusual_method` instead; does not offer a person after two red flags (lawyer + secrecy). (iteration 2)
6. Tagger (`qwen2.5:3b`): rates **incoming deposits** as high-risk "payments" (7 of 9 review-queue items are deposits; the prompt never says the direction); creates junk tags that duplicate seeds or just name the event type (`login_attempt` described as a failed sign-in but used 248 times, mostly on normal logins; `payment_initiated` with "$163" in its description; `email_change`, `one_time_code_sent`). (iteration 3)
7. Analyst: reads Sarah's takeover as "Member initiated multiple P2P payments", gives a cash withdrawal a "new recipient", rates the real mover medium. It never sees the rules' own reasons. If it ever starts a check-in, its staff-facing assessment is pasted verbatim into the member's message (`template()` and `whyFor()` for source `analyst`). (iteration 3)
8. Employee console, light-check story while the chat is still running: says "Harbor asked a light question and released the payment" before the member has answered. (iteration 3)

**Dead code removed**
- `app.js`: `svgBox`, `arrow` (leftovers of a removed trigger chart), unused `first` in `node()`, unused `S.trig`, `window.HarborVoice`, the duplicate `BACKEND` constant (same as `API`), the `chipFor` alias, and a duplicated "Talk to a Sound employee" branch in `liveChips` (both branches pushed the same button).
- `style.css`: 6 unused diagram classes (`dg-grid`, `dg-dot`, `dg-arm-line`, `dg-decide-line`, `dg-brk`, `dg-lbl`).
- `engine.js`: stray `{ }` block wrapping all of `step()`; `recipAdded` state that was written on every event (and persisted to Postgres) but never read.
- `backend/lib/demo.js`: unused `triggerEnvelope`; `demoSend` no longer re-runs the engine when the event id is given. `backend/lib/db.js`: unused `SEED_TAGS` export.

**Checks**: `test_engine.js` output byte-identical to baseline. `node --check` on all edited files.

## Iteration 2: the chat agent and first messages

**New: `harbor/eval_agent.js` (`task eval`)**. 13 scripted member conversations (calm tuition, verified home closing, contractor with contract, federal-agent cash, grandson's "lawyer" + secrecy, online romance with growing returns, takeover denied, takeover confirmed, caregiver pressure, asks for a person, distressed, reads out a code, prompt injection) plus 7 first-message alerts (one per story). Each reply is scored by code: at most one question, length, banned words, no `[placeholder]`, expected / forbidden signals, required / forbidden phrases, guardrail not triggered. `--agent <file>` scores another version on the same rubric.

**Results (qwen2.5:14b, 2 runs per case)**
| | Before | After |
|---|---|---|
| Chat cases | 7/26 (same rubric) | 26/26, then 24-26/26 on reruns (model variance) |
| First message written by the model (not the template) | 3 of 7 live runs | 14/14 in the eval, 5/7 live under GPU load |
| Avg. chat latency | ~5.0 s | ~3.2 s (shorter replies) |

**What was wrong, judged as a reviewer**
- The prompt's own example question ("Who asked you to send this, and how did they reach you?") became the model's default, asked even after "it's my daughter's tuition". Members who verified (title company on the number from their paperwork) were asked again who they spoke to and got `unverified_contact`.
- The model never set `member_verified` / `own_initiative`, so the code-gated "This looks fine. Please continue" never appeared: a legitimate member's only ways out were a person, cancel, or "send anyway".
- It left `[Member's First Name]` in replies when no name was known.
- The guardrail blocked "It's safe to hang up and call back" (fixed regex) and its fallback dropped the officials-never-ask warning.

**Changes**
- `agent.js` prompt rewritten around *what to say next* given what the member already said (8 ordered cases: takeover denied/confirmed, official asking for money, secrecy/relative/online pressure, someone else asked, own plan or verified, wants a person, purpose unknown), naming the real buttons on screen. Signals redefined with concrete examples (e.g. "a cash withdrawal or wire alone is not `unusual_method`").
- Ollama calls use a JSON schema (`format`), so `signals` can only be valid names and `member_state` a valid state.
- Code, not the model, now guarantees the lines that matter (`shapeReply`): strips `[placeholders]`; keeps one question (the main one); adds "Sound and government agencies never ask... hang up and call back" when the member names an official, otherwise a call-back line only if the model gave none; adds "Sound never asks anyone to log in from a text" when a takeover is denied; offers a private conversation on any red flag; points to "Talk to a Sound employee" when asked; removes a pointer to "This looks fine" while that button is hidden. Every change is recorded as a guardrail in the trace, so the console's model log and the inspector show it.
- Keyword backstops can only add `wants_person`, `secrecy_or_isolation`, `member_distressed` (signals that make Harbor more careful). Contradictions resolve to the safer reading (`member_verified` drops `unverified_contact`; a denial beats a confirmation).
- First messages moved to `backend/lib/compose.js` (testable). Code now repairs instead of rejecting: inserts the "never asks" line if missing, fixes "South Sound"; requires the amount, exactly one closing question, correct paused / not-paused wording ("going through" is rejected for a light check, which waits for the member). The brief no longer contains text the model copied verbatim ("NOT paused or blocked: do not..."). A Planned Big Payment is acknowledged in both the model brief and the template. The takeover template now ends with its question.
- **Staff wording no longer reaches members**: the analyst's assessment was pasted into the member message and into the chat context; merged alerts appended staff rule reasons ("1.8x this member's usual amount") to the chat context. Both now use the member-safe `whyFor`.

**Bug I introduced and fixed in the same iteration**: the sentence splitter cut the quoted button label `'This looks fine. Please continue'` in half, leaving "Please continue' whenever you're ready." in Michael's chat (seen in the live re-walk). Labels are now protected before splitting; unit-checked.

**Not changed (noted)**: under the full pipeline the 14B composer, the 14B analyst and the 3B tagger share one Ollama; the first message hit the 9 s timeout 2/7 times and used the template, which is the designed fallback. In takeover replies the model sometimes says "we'll stop the payment" before the member taps; acceptable because it immediately points to the button.

## Iteration 3: pipeline models, UI walkthrough in Chrome, bugs

**Tagger (`backend/services/tagger.js`)**
- The model never knew a deposit was *incoming*; the prompt now says `INCOMING money` / `outgoing` (the catch-up sweep also keeps the direction).
- New tags must describe a pattern: no amounts, dates or ids in the description, no name that just restates an event type (`payment_initiated`, `email_change`...), near-duplicate threshold 0.6 -> 0.5.
- Everyday events (login, deposit, purchase...) choose only from the curated seed vocabulary.
- The data overrules the model: a deposit or purchase, a payment *below* the member's own usual amount ("$20 is unusually large"), or the bank's own intervention/case events can be at most `medium`, so they never reach the human review queue.
- `scripts/reset.js` never cleared the `tags` table, so model-made junk tags survived every reset and accumulated. It now removes model-made tags and zeroes use counts (seed tags stay).
- Result on a fresh reset: 0 junk tags (was 17), logins/deposits tagged `normal_login` / `routine_activity` low (were `login_attempt` and high-risk "payments"), review queue 3 items (was 9, 7 of them deposits).

**Analyst (`backend/services/analyst.js`)**
- Context now carries the rules' own findings (`rule_findings`), the rules decision with any look-alike reason, `looks_like_real_move`, hours since the password reset, money direction, and no "new recipient" for cash. Prompt tells it to build on rule findings and never call a takeover payment "member initiated".
- Sarah: "Member initiated multiple P2P payments" -> "password reset, email and phone changes, and a large payment to a new recipient... potential unauthorized activity". James: no invented recipient.
- When the rules judged a look-alike (real mover / declared plan), code caps the analyst's risk at medium and records why (`verdict.capped`, shown in the console). The 14B model still writes "shortly after" for a 25-hour gap even with the number in its input: noted as model quality.

**UI walkthrough in Chrome (localhost:8787, Live AI and Guided)**: Sarah takeover end to end (criminal's session, paused screen, SMS to old phone, chat, "It wasn't me", console), contractor light check in Guided mode, every Dev tools tab (simulator with slider and replay, architecture, live pipeline, notes). No console errors.

**Bugs found and fixed**
1. **Console lost the real pipeline data when a chat ended**: `finish()` replaces the case object and `syncOne` returned for finished cases *before* attaching `k.real`, so the analyst's read, the tagger note and the real timings vanished from the console the moment the member finished. Light-check stories never got them at all (early return for non-hold). Fixed: the real view is attached first.
2. Console text for a light check while the member was still answering said "Harbor asked a light question and released the payment". That branch only renders while the chat is open, so it was always wrong. Now: "Harbor is asking the member a light question now...".
3. Composer copied the brief's third-person phrase verbatim: "The member is in control." The brief is now written as the member reads it ("you're in control") and code rejects "the member" in a member message.
4. Two buttons doing the same thing under the chat ("Talk to a Sound employee" chip and "Talk to a person" link). The link now hides when a chip already offers a person.
5. Guided-script openings (`start`, `light`, `planned`, `ato0`) lacked "Sound will never ask for your password or a code, or ask you to move money", which the design notes promise in every message. Added.
6. Takeover denied but the model answered with the "you made the changes, we'll call you" branch (variance): code now always points to the "It wasn't me. Stop the payment..." button when a denial is detected.
7. My own syntax slip in the `planned` node (template literal closed with a quote) caught by `node --check` before reload.

**Checked, not a bug**: simulator showed 44/48 once. It was my test script setting a slider to 3 and the reset event landing on a detached element after re-render; with defaults it shows 48/48, same as `test_engine.js`.

## Iteration 4: simplification

- **One HTTP helper** (`harbor/http.js`: `json`, `readBody`, `serveStatic`) replaces two copies in `harbor/server.js` and `agent-service.js` (MIME table, static serving, body parsing, JSON responses). The two deny-lists had drifted; now there is one, and it also hides `http.js`, `eval_agent.js`, `test_engine.js`, `build_data.py` and `README.md`, which were being served. Verified: app files 200, all private files and path traversal 404. The chat-only server now 404s unknown `/api/*` routes instead of looking for a file, and returns 400 for a bad chat body.
- **One Ollama call path**: `llm.chatSchema` (tagger) now goes through `agent.callModel` (which gained `schema` and `options`) instead of its own fetch/abort/timeout code. The Ollama URL default lives in one place (was three).
- **Compose moved to `backend/lib/compose.js`** (iteration 2), so `agent-service.js` is only alerts, cases, demo and routes.
- `app.js`: `scen(id)`, `scenOf(mid)`, `recOf(mid)` replace 20 inline `SCENARIOS.find(...)` / `Object.values(S.rec).find(...)` lookups; the live chat, pipeline reply and resolve use the existing `post()` helper (now takes an abort signal) instead of three hand-built `fetch` POSTs; the employee-action handler no longer round-trips the log text through `t.dataset.v`.
- Diff so far: 15 tracked files, +293 / -299 lines, plus 3 new files (`compose.js`, `http.js`, `eval_agent.js`). Despite the new eval harness and guardrails, tracked code shrank slightly.

**Checks**: services restarted; all 8 story walkthroughs pass; tagger running through the new path (66 events tagged by the model, 0 errors); `test_engine.js` identical.

## Iteration 5: regression, extras, and one regression I caused

**New: `backend/scripts/smoke.js` (`task smoke`)**. With the stack running it plays all 8 story runs through the same API calls as the app (stream, send, decision level, case, first message has "never ask" and a question, a member reply with no placeholder or extra questions, case in `/api/console`, takeover makes the agent stop (409), employee message, hand back, action), then the edge routes (unknown member 404, resolve unknown case 404, bad chat body 400, private file 404). Exits 1 on any problem. It replaces the throwaway driver used in iterations 1-4.

**Regressions**
- `test_engine.js`: byte-identical to the baseline in every iteration.
- `task eval -- --repeat 3`: **60/60** (13 chat cases and 7 first messages, 3 runs each). One more composer fix was needed: the only style example in the prompt was a *paused* message, so for a Planned Big Payment light check the model wrote "I've paused your wire" and the check (correctly) rejected it 2/2. Added a light-check example and a `check` field to the brief: 0/2 -> 3/3.
- `task smoke`: all good, twice.
- Chrome: all 7 stories in Guided mode to an outcome; Sarah (Live AI) end to end; Linda (Live AI) with employee takeover, employee message, member writing to the person, hand back (Harbor's buttons return); console queue shows every member with the right status; every Dev tools tab; no console errors.
- `task retro`: finding raised and merged into the member's open case (one case per member).

**Regression I caused (found and fixed)**: the iteration 4 lookup refactor used a regex that also rewrote the helpers' own bodies (`scen = (id) => scen(id)`), so the app rendered a blank page (stack overflow). `node --check` and the API smoke test cannot catch this; loading the page in Chrome did. Fixed and re-verified in Chrome. Lesson recorded below.

**Other fixes this iteration**
- `task retro` ran without `HARBOR_PROVIDER`, so on its own it never called the model and always used the plain fallback sentence. It now defaults to Ollama like `task chat`.
- Docs: `README.md` (checks), `harbor/README.md` (guardrails, `http.js`, eval), `backend/ARCHITECTURE.md` (first-message design).

**Known, not changed**
- Under load (tagger backlog after a bulk replay) the 14B first message took 12-13 s and the 9 s timeout used the template 4/7 times in the last smoke run. The text was fine, so this is capacity, not quality. Options: run the tagger on a separate Ollama, set `OLLAMA_NUM_PARALLEL`, or raise `COMPOSE_TIMEOUT_MS`.
- The 14B analyst still says "shortly after" for a 25-hour gap; code caps its risk for look-alikes.
- The 3B tagger still writes odd notes (e.g. "$83 is 5.1x baseline"); tags are advisory, and the review queue is now guarded by data checks.
- `docs/` (GitHub Pages copy) was deliberately not synced (paused per project memory). Run `task pages` when you want it updated.
- A vim swap file `.Taskfile.yml.swp` appeared during the session (not created by me); left untouched.

---

## Summary for a human

**What I did**: 5 iterations over the Harbor prototype and pipeline: ran the full stack locally (Colima, Redpanda, Postgres, Ollama `qwen2.5:14b` + `qwen2.5:3b`), walked every story for each user (member, employee, developer) through the real API and in Chrome, judged the local models' output, and fixed what I found. Nothing is committed.

**Biggest wins**
1. **The chat agent now works for legitimate members.** Before, the model never recognised "I verified it" or "it's my own plan", so the code-gated "This looks fine. Please continue" button could never appear, and it kept asking members who already explained themselves "who asked you to send this?". New prompt plus code-enforced reply rules: **7/26 -> 60/60** on a new scripted eval, with faster replies (~5.0 s -> ~3.2 s).
2. **Safety lines are guaranteed by code, not hoped for.** "Officials never ask you to move money, hang up and call back", "Sound never asks you to log in from a text", the stop button for a denied takeover, and a private-conversation offer on red flags are inserted if the model leaves them out. A guardrail false positive that deleted exactly the right warning for the government-impersonation story is fixed.
3. **First messages**: 3/7 -> 14/14 written by the model in isolation, with correct paused / light-check wording, the amount, and the Planned Big Payment acknowledged. **Staff wording no longer leaks to members** (analyst assessment and rule reasons with ratios used to reach the member's message and chat context).
4. **Pipeline models are tamed by data checks**: the 3B tagger no longer floods the human review queue with incoming deposits and tiny payments, and no longer invents junk tags; the analyst gets the rules' findings and look-alike context.
5. **Real bugs fixed**: the employee console lost the analyst / tagger / timing data the moment a chat ended; a 500 on resolving a reset case; wrong status codes; "released" shown while the member was still answering; duplicate person buttons; reset never cleared model-made tags; `task retro` never used the model; dev files served by the static server.

**Simpler code**: one shared HTTP helper, one Ollama call path, compose extracted, unused code and CSS removed. Tracked files: +299 / -300 lines, while adding the eval, smoke test and guardrails in new files.

**New tools**: `task eval` (agent quality, repeatable, compares versions) and `task smoke` (end-to-end API check of every story and route).

**Lesson for next time**: neither `node --check` nor the API smoke test loads the UI. A blank-page regression I introduced was only caught in the browser. Adding a headless browser check (e.g. Playwright loading the page and running one story) would close that gap.

**Files changed**: `harbor/agent.js`, `app.js`, `engine.js`, `server.js`, `style.css`, `README.md`; `backend/lib/llm.js`, `demo.js`, `db.js`; `backend/services/agent-service.js`, `tagger.js`, `analyst.js`; `backend/scripts/reset.js`; `backend/ARCHITECTURE.md`; `Taskfile.yml`; `README.md`. New: `harbor/eval_agent.js`, `harbor/http.js`, `backend/lib/compose.js`, `backend/scripts/smoke.js`, `review.md`.

## Follow-up: architecture updated

- `backend/ARCHITECTURE.md`: flow diagram labels refreshed; new **"Where the models sit, and what code enforces"** table (scorer, tagger, analyst, composer, chat agent: inputs and the code checks after each); new **code map**; two new rows in "What changed and why" (code shapes every chat reply; data checks overrule the small model); checks (`task test` / `smoke` / `eval`) and the tag reset under "Run it"; known gaps updated (3B notes, analyst time gaps, shared Ollama capacity, no browser test).
- In-app **Dev tools > Architecture**: tagger, agent and analyst boxes and the intro paragraph describe the code checks. Verified in Chrome: no text overflows its box.
- In-app **Dev tools > Architecture** now has a second card, **"Flow: one story, step by step"**: 15 lifelines (member app, API server, every topic, scorer, Postgres, tagger, analyst, agent, Ollama, delivery, employee console) and 38 numbered steps in four sections (pick a story, send payment, parallel tagging/analyst, conversation/takeover/timeout). Same flow added to `ARCHITECTURE.md` as a Mermaid sequence diagram, next to the deployment diagram. Checked by rendering the SVG to PNG (the connected Chrome is on another machine and cannot reach localhost).
- Correction after feedback: the separate flow card was removed. The **existing** Dev tools > Architecture diagram is expanded in place instead: process file names, consumer groups, workers and timers on every service; partitions and groups on every topic (`analysis.requests` is now a real topic pill); which service writes each Postgres table; Ollama and which model each service uses; a "Where it runs" legend (Docker containers and ports, start-all.sh, logs, trace log). The shared text helper now keeps continuation indents (SVG collapsed them before). Checked by rendering the SVG to PNG in quadrants.

---

# Round 2 (2026-10-18, afternoon): the features added since Round 1

## Plan

**New since Round 1** (all uncommitted except the FTC flow commit `2976226` on branch `ftc-report-flow`):
Claude-style collapsible composer, mic beside Send, member and employee 1-5 feedback, close-out verdict, interaction log, secret masking, ask-a-person-to-join, FTC report flow (questions, agent draft, form-matched fields), screenshot service (`qwen2.5vl:7b`), API gateway (:8787 public, agent :8790, screenshots :8791), MFA tip, glanceable step timeline, 4-row live events, lock-screen preview clamp, Ollama parallel requests.

**Baselines to protect**: `task test` (48/48, 7/70, byte-identical output), `task eval` (Round 1 ended at 60/60; 14/14 with the push-back case), `task smoke` (all good), every story playable in both modes.

**Users and what to walk**
| User | New surfaces to walk |
|---|---|
| Member | Live AI and Guided chat for all 7 stories; collapse and expand the composer; 📷 screenshot (bring it up, Harbor offers it); join-request note; MFA tip; 1-5 feedback; FTC follow-up (help / self / not now) |
| Employee | Join banner and Join chat; takeover; ask for a screenshot; screenshot step; verdict; FTC card (copy, open); rating; timeline and live events |
| Developer | Gateway routing, limits and health; screenshot service; Live pipeline feedback and interaction tiles; inspector traces for screenshots and FTC drafts; `task status`, `task stop`, `task smoke`, `task eval` |

**Iterations**
1. **Baseline on the new architecture.** Restart the stack with the current code (gateway + 3 services). Run test, smoke, eval. Drive every new API route and every story through the gateway. Play every UI flow in the stand-in browser (the connected Chrome is on another machine and cannot reach localhost). Dead-code sweep of everything added since Round 1.
2. **Model quality.** Extend the eval to the new model jobs: FTC drafts (facts, voice, categories) and screenshot reading (fixture images incl. benign ones). Judge every output as a reviewer, fix prompts and code checks.
3. **Bugs** from the walkthroughs (UI state, races, edge cases, error paths, accessibility).
4. **Simplification and a UI test.** `app.js` grew to ~1,500 lines; dedupe what repeats. Turn the throwaway stand-in-browser scripts into a committed `task test:ui` so a blank-page regression can never pass unnoticed again (the gap Round 1 named).
5. **Regression and summary.**

## Round 2, iteration 1: baseline on the new architecture, walkthroughs, dead code

**Environment**: restarted the stack on the current code (it was still the 05:16 pre-gateway build): gateway :8787, agent :8790, screenshot :8791, workers, Kafka, Postgres, Ollama with 3 models.

**New tool: `harbor/test_ui.js` (`task test:ui`)**. Loads the real `app.js` in a stand-in browser, renders all six tabs and plays every story to the end: phone result, lock screen, chat, Live AI reply or guided path, join request, takeover and employee message, outcome, MFA tip, feedback, verdict, the member's FTC follow-up and the analyst panel's FTC card. Offline it uses the browser engine and guided script (fast, deterministic); `--live` runs the same flows through the real gateway and models. This closes the gap Round 1 named (nothing loaded the UI, so a blank page passed every check). Replaces five throwaway scripts.

**Results**: `task test` identical; `task smoke` all good (7/8 first messages by the model); UI test offline 7/7, live 6/7 then 7/7 after the fixes below; chat eval 28/28; first messages 4/14 (timeouts, see Ollama below).

**Bugs found and fixed**
1. **A light-check chat had no case in the analyst panel** until it ended (found by the live UI test, contractor story): staff could not follow or take over, and a join request raised during a light check could not be answered. A light check now gets a case as soon as its chat starts, with its own wording ("Light check: the payment waits for the member's answer", "Waiting for the member (light check)", timeline "Light check" instead of "Payment held").
2. **The analyst started a check-in with a legitimate look-alike** (the real mover M1039 received "a quick check before your payment goes out"). Round 1 only capped the analyst's risk at medium for look-alikes, and medium still passed the gate. A look-alike judged by the rules now never gets analyst outreach; the read is kept as context.
3. **An analyst check-in's first message talked about a pending payment** ("before your payment goes out"; nothing was pending). The composer brief now has its own facts and question for analyst check-ins, and code rejects pending-payment wording for them.
4. **The agent's API was down for 30-40 s after every restart**: it only started listening after its Kafka consumer groups rebalanced, so the gateway answered "agent service unavailable". The API now listens as soon as Postgres and the producer are ready (2 s).
5. **`GET /api/screenshot` (no trailing slash) went to the agent and 404'd**: the gateway route matched only `/api/screenshot/`. Fixed for both forms and for the rate limit.
6. **Ollama limit I set earlier was wrong**: `OLLAMA_MAX_LOADED_MODELS=2`, but Harbor now uses three models (14B, 3B, 7B vision), so Ollama would keep unloading one to load another. Now 3 in `run.sh` and the saved setting. Separately, the running Ollama app has still not been restarted since parallel mode was saved, so every 14B request queues behind the others: that is why 10/14 first messages timed out in the eval while the live UI test ran. Needs a manual Ollama restart (quit and reopen from the menu bar).
7. Smoke test printed its gateway line before its header.

**Checked, not a bug**: Sarah's case disappeared during one live UI run. Cause: my harness started her story while the app's own boot-time start of the same story was still in flight, and the late request reset her. A user cannot hit this (the app starts one story once on load); the harness now waits for the boot-time start.

**Rename (user request)**: "Employee console" is now **"Security analyst panel"** in the tab, the architecture diagram, `ARCHITECTURE.md`, `README.md` and `SUBMISSION.md`. Member-facing "a Sound employee" is unchanged.

**Dead code removed**: `decideCard()` (never called since the live feed was rebuilt); unused `VERDICTS`; unused exports in `agent.js` (`TONES`, `SAFE_FALLBACK`, `SIGNALS`, `systemPrompt`, `sanitize`), `ftc.js` (`QUESTIONS`, `CATEGORIES`), `feedback.js` (`EVENTS`, `DIR`), `lib/screenshot.js` (`defang`, `KINDS`, `ASKS`); CSS left from thumbs feedback (`.fbrow`, `.fbbtn`).

## Round 2, iteration 2: the new model jobs (FTC drafts, screenshot reading)

**Eval extended** (`task eval`, new `--section chat,compose,ftc,shots`):
- **FTC drafts**: 4 cases (Linda, Michael, James, Sarah). Checks a reviewer would make: right form and category, payment amount present, no payment time used as the time they were contacted, Sound never named as where the money went, a fake Sound text described as an impersonation, the true ending stated, the member's own voice.
- **Screenshots**: 5 committed fixtures in `harbor/fixtures/screenshots/` (fake Sound text asking for a code, "attorney" asking for gift cards and secrecy, Instagram crypto DM, a contractor invoice, a genuine Sound password-change notice). Checks expected risk, flags, no false flags and no wrong advice.

**What was wrong, judged as a reviewer**
- **The FTC story invented what happened after the payment**: "I noticed this and stopped the payment", "I immediately contacted Sound to report it", James "followed their instructions and took out the money". In a report to a federal agency these are false statements. Code now owns the ending: the model is told not to describe it, code drops any sentence that does (and any claim that money moved when nothing was lost), then appends the true ending with the amount ("Sound Credit Union stopped the $7,000 cash withdrawal before any money left my account", or the exact loss and recovery).
- **Impersonators described as the real thing**: "A federal agent called me". Code rewrites impersonated roles to "someone claiming to be a federal agent" unless the text already says so. "I want to remain anonymous" no longer leaks into the story (the form's About you section covers it).
- **A genuine Sound notice was "medium risk"** just for claiming to be Sound. A Sound message that asks for nothing (no link, money, code or number to call) is now low risk with reassuring advice ("This looks like a normal notice: it asks for nothing. If you didn't make that change, tell me"). "Call the number on the back of your card" is never treated as a lure.
- One fix of mine broke a case and was caught by the eval in the same iteration: removing the model's ending sentence also removed the amount when both were in one sentence; the code-written ending now carries the amount.

**Results**: FTC 7/8 -> 12/12 (3 runs each); screenshots 10/10 (2 runs each); full eval **60/60** (chat 28, first messages 14, FTC 8, screenshots 10).

## Round 2, iteration 3: bugs

**Service logs** after all the walkthroughs: no errors (the only "bad request" is the smoke test's deliberate one).

**Bugs found and fixed**
1. **Ending a chat wiped what staff had done on the case.** `finish()` replaced the case with a fresh summary, dropping the analyst's verdict, 1-5 rating and "Done so far" actions (the same class of bug Round 1 fixed for the pipeline data). It also dropped the employee's own messages from the ended conversation. The summary now keeps the staff state and every message.
2. **A verdict saved while the member was still chatting started the FTC follow-up mid-conversation**: its messages appeared, but its buttons only show after the chat ends. The follow-up now waits for the chat to end, then starts from the up-to-date case.
3. **The tagger still sent a legitimate look-alike to the human review queue** (the real mover's payment, "high"). The scorer now tells the tagger when the rules judged a look-alike, and the tagger caps it at medium. Verified: M1039's payment is tagged medium, review queue 0 (was 1).
4. **Tapping a link in a chat message collapsed the reply panel** (e.g. reportfraud.ftc.gov in Harbor's follow-up). Links no longer collapse it.

**Regression tests added to `task test:ui`**: a verdict saved mid-chat waits; verdict, rating and actions survive the end of the chat; the employee's messages stay; the FTC follow-up starts once the chat ends.

## Round 2, iteration 4: simplification and the UI test

- **`task test:ui`** (built in iteration 1, extended in 3) is the main simplification: one committed test replaces five throwaway stand-in-browser scripts, and covers every tab, every story in Guided (offline) and Live AI (`--live`), and the staff-state regressions.
- **`caseNote(k, note, toServer)`**: one helper for the six places that recorded a staff action ("Done so far", the case log, and for two of them the real case on the server, each with its own case-id lookup).
- **One microphone icon** (`MIC_ICON`) instead of two copies of the SVG.
- The employee action handler is one line.
- Dead-code scan after the changes: no unused top-level names; no leftovers from the removed drag sheet. `app.js` 1,551 -> 1,524 lines while adding the light-check case, the deferred FTC follow-up and the staff-state fixes.
- Left as is, deliberately: the 14 `recOf(...).chat` lookups (they differ enough that a helper would hide intent), and the duplicated feedback / FTC routes in `harbor/server.js` (file store) and `agent-service.js` (Postgres): two storage back ends, a few lines each.

## Round 2, iteration 5: regression

| Check | Result |
|---|---|
| `node --check` / `bash -n` on every source and script | clean |
| `task test` (rules on 118 members) | byte-identical to the Round 1 baseline (48/48, 7/70) |
| `task test:ui` offline | every tab renders; 7/7 stories to an outcome; staff work survives the end of a chat |
| `task test:ui -- --live` (real gateway and models) | 7/7 stories in Live AI incl. takeover, MFA, feedback, verdict and the full assisted FTC draft |
| `task smoke` | all good (first messages: 6/8 by the model, 2 template under load) |
| `task eval -- --repeat 2` | **60/60**: chat 28, first messages 14, FTC drafts 8, screenshots 10 |
| `task chat` (no Docker) | app, chat and FTC questions answer |

**Still to do by hand**: quit and reopen the Ollama app once. Parallel requests and the 3-model limit are saved but the running Ollama predates them; until then 14B requests queue behind each other and some first messages fall back to the template under load.

---

## Round 2 summary for a human

**What I did**: a second 5-iteration pass over everything added since Round 1 (feedback, verdicts, interaction log, join requests, FTC flow, screenshot service, gateway, MFA, composer, timeline), on the restarted stack. Nothing is committed.

**Biggest fixes**
1. **Legitimate look-alikes are left alone end to end.** The analyst had started a check-in with the real mover (a legitimate member) because Round 1 only capped its risk; the tagger also still sent that member's payment to the human review queue. Both now respect the rules' look-alike judgment.
2. **FTC reports no longer contain false statements.** The model invented what happened after the payment ("I noticed and stopped it", "I took out the cash", "I called Sound") and described impersonators as the real thing ("a federal agent called"). Code now writes the true ending with the amount and rewrites impersonated roles ("someone claiming to be a federal agent"). FTC drafts 7/8 -> 12/12.
3. **Staff work is never lost.** Ending a chat used to wipe the analyst's verdict, rating, actions and their own chat messages; a verdict saved mid-chat started the FTC follow-up in the wrong place. Both fixed and covered by tests.
4. **Light checks are visible to staff.** A light-check conversation had no case in the analyst panel until it ended, so nobody could take over or answer a join request.
5. **Screenshots judged like a person would.** A genuine Sound notice that asks for nothing is now low risk with reassuring advice (it was "medium, claims to be Sound").
6. **Operations**: the agent API is up 2 s after a restart (was 30-40 s behind Kafka rebalancing); `GET /api/screenshot` routes correctly; Ollama keeps all 3 models loaded (the limit I set earlier was 2).

**New**: `task test:ui` (the real app in a stand-in browser, offline and `--live`), screenshot fixtures and FTC / screenshot sections in `task eval` (`--section`), "Security analyst panel" (renamed from Employee console, as asked).

**Lesson**: the live UI test found the two worst bugs of this round (light checks invisible to staff, staff work wiped on chat end) within minutes; neither the API smoke test nor the model eval could have. Keep running `task test:ui -- --live` before a demo.
