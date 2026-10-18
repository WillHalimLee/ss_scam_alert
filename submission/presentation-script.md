# Harbor: 5-minute presentation script

About 830 words, roughly 5½ minutes at a calm pace. Stage cues are in *italics*. Don't read those aloud.

Deck: https://claude.ai/artifact/V4Zcn516x3vqqvqiDGeUcN

| Part | Time | Slides |
|---|---|---|
| Intro | 1:00 | 1 Harbor, 2 Why calm works |
| Demo | 2:20 | 3 Two sides of one conversation, then the live app |
| Architecture: the models | 1:50 | 4 The whole system, 5 Rules decide, 6 Every case makes the next one better |
| Close | 0:25 | 7 An agentic personal security workflow |

---

## Intro (1:00)

**[Slide 1: Harbor]**

When a scammer stirs up the waves, panic is their current. The first thing a victim feels isn't confusion, it's fear: fear of the threat, and fear of the unknown. In that moment, what helps most isn't another notification. It's an expert at your side.

That's Harbor: a personal security analyst for Sound Credit Union members. It answers right away, finds what's real, and stays with you until you're safe.

**[Slide 2: Why calm works]**

Research shows that under stress, people run on fast, automatic thinking. Loud warnings and walls of logic don't get read; they get dismissed. In our own data, members clicked through warnings every time.

Scammers win with fear, urgency and secrecy. So Harbor isn't another alert. It's a place to land, with gentle nudges: pause, breathe, verify together.

---

## Demo (1:45)

**[Slide 3: Two sides of one conversation, then switch to the app]**

Let me show you. This is Linda. She's about to send an $8,500 wire to a new recipient, minutes after a branch visit.

*Press Send payment.*

Harbor pauses it in milliseconds. That decision came from plain rules, not AI. Now Harbor checks in, calmly, with no blame.

*Type: "A man from the FBI called, said not to tell anyone."*

Watch what happens. Harbor tells her government agencies never ask you to move money, and that it's okay to hang up and call back. And notice the buttons: "This looks fine" is gone. The AI read the red flags, but our code decided what she's allowed to choose. The model can never release, hold or cancel money.

Harbor was built for the people scammers target most. The FBI's elder fraud report shows that people over 60 file the most complaints and lose the most money of any age group: nearly $4.9 billion in 2024. So nothing in this chat depends on typing or reading small print.

*Tap the mic and say: "He sent me a text. Can I show you?"*

She can simply talk. Her words become text that she checks before sending. The text is large by default, with an extra-large setting.

*Tap the camera and pick the lawyer's text from the recent screenshots.*

And if she isn't sure how to describe a message, she can just show us. A vision model reads the screenshot, and code flags what matters: gift cards, and being told to keep it secret. Harbor explains it in plain words. The image itself is never stored.

Harbor has also asked a person to join.

*Switch to the Security Analyst Panel.*

This is what the analyst sees: why Harbor paused, the full timeline, the AI's read of the case, and the live conversation. One click and they join, so Linda never has to repeat her story.

And when the case closes as a confirmed scam, Harbor offers to draft her FTC report field for field.

---

## Architecture: the models (1:50)

**[Slide 4: The whole system]**

Under the hood, this is one event stream with several agents on it. Every account event flows through Kafka. People reach it through one gateway.

**[Slide 5: Rules decide. AI advises.]**

The key choice: **rules decide, AI advises.** The fast path is plain rules, about one millisecond, with no model before a decision. An alert never waits on an LLM.

We picked each model for its job, and all of them run locally on Ollama, so member data stays inside the credit union:

- **A small 3B model tags every event.** It has to be cheap and fast enough to see everything. We give it the event, recent history, the rules' decision and a tag vocabulary it can grow through tool calls. Code caps its risk so noise never reaches a person.
- **A 14B analyst** wakes up only when something looks risky. It reads the member's tagged history and the rule findings, and writes a read for staff. It can suggest a light check-in, but only if every code gate passes.
- **The same 14B model talks to the member.** It only ever sees member-safe wording, never our internal rule reasons. Code checks every reply: one question, the safety line, the right buttons.
- **A vision model reads screenshots.** The image is never stored.

**[Slide 6: Every case makes the next one better]**

And this is how it gets better over time. We save every model call with the guardrails that fired. We save member and employee ratings, tied to the agent version, plus each employee's final verdict and the money lost or recovered. We also save what a real person said when they took over.

That gives us a loop. Verdicts tune the rules. Employee replies become examples for the agent. Ratings tell us which prompt version is better. Places where the model and the rules disagree show us where to tune next. Next, we run in shadow mode on real data and measure on held-out cases, so every improvement is earned, not assumed.

---

## Close (0:25)

**[Slide 7: An agentic personal security workflow]**

Harbor is an agentic personal security workflow. It **protects**: the payment pauses before the money moves. It **reassures**: a calm analyst, and a real person whenever it matters. And it **learns**: every case makes the next one better.

Thank you.

---

## Before you present

- Reset Linda from Config so the demo starts clean.
- Run in Live AI mode (`task run`) so the mic and camera buttons show. Pull the vision model first (`ollama pull qwen2.5vl:7b`) and send one screenshot before you present, so the model is already loaded.
- Use Chrome for the mic, and allow microphone access once before the talk.
- Confirm the elder fraud figures against the latest FBI IC3 Elder Fraud Report before you present.
- If you run long, cut the mic step in the demo (keep the screenshot), or shorten the screenshot bullet and the "next" line on slide 6. The demo is where time usually slips.
- Confirm "member data stays inside the credit union" matches why you chose local models.
- Confirm the Binghamton University citation on slide 2.
