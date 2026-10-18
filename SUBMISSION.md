## Inspiration
Putting myself in the shoes of the victims, the first loud emotion I felt was fear: fear from the threats, and fear of the unknown. In that moment, more than any notification, I knew that having an expert at my side would reassure me immediately. That is what we set out to build.

Research backs the instinct. Under stress or while multitasking, people run on fast, automatic thinking, so calm, timely nudges protect them better than loud alerts or technical logic. Scammers win with fear, urgency and secrecy. Harbor answers with a pause, a calm voice and a person who stays.

## What it does
Harbor is a personal security analyst for Sound Credit Union members. It protects against authorized scams and account takeover.

- **Spots the moment of risk.** Account events (password resets, contact changes, new recipients) quietly build a picture. When a payment starts, transparent rules decide: do nothing, ask a light question, or pause it.
- **Talks like a calm expert.** The member types or speaks in their own words. Harbor is honest, never blames, and keeps them in control. Large text by default. Takeover check-ins go to the phone on file before the changes.
- **Reads what the member was sent.** The member can share a screenshot of a text or email. A vision model reads it, and code flags what matters (gift cards, secrecy, look-alike links, requests for codes). The image is never stored.
- **The AI never controls the money.** The model reads the conversation and flags risk. Our code decides what options appear, so the model can't release, cancel or hold a payment.
- **Calls in a person at the right moment.** Code, not the model, asks a Sound employee to join when the member is distressed, pushes back, shares a code or shows several red flags. The Security Analyst Panel shows why Harbor paused, the full timeline, the AI analyst's read and the live chat, with suggested replies the employee can edit, so the member never repeats their story.
- **Helps after a scam.** Once an employee confirms a scam, Harbor asks the member how they want to report it and drafts the FTC report field for field (IdentityTheft.gov for a takeover) for the employee to file with them. Nothing is submitted automatically. It also suggests a passkey or authenticator app.
- **Treats legitimate members fairly.** Look-alike checks and a "Planned Big Payment" turn likely false holds into a light check or quick callback.
- **Learns from every case.** The member and the employee both rate Harbor; the employee's rating is required before a case can be closed. The close-out verdict, money lost and recovered, employee replies and every model call are saved for tuning.

## How we built it
- **Trigger engine:** two stages in JavaScript (flag the account, then check each payment), tested on all 118 synthetic members in a live simulator.
- **Prototype:** a Member App (phone mock, voice or text), a Security Analyst Panel, and dev tools: simulator, architecture diagram, live pipeline and model inspector.
- **Streaming backend:** one API gateway in front; Kafka-compatible topics keyed by member; a rules scorer (about 1 ms, no model) with an outbox into Postgres; retries and a dead-letter queue.
- **Agents, each model picked for its job, all local on Ollama:**
  - **Tagger (Qwen 2.5 3B):** tags every event, with tools to read and extend a tag table. Data checks cap its risk.
  - **Analyst (Qwen 2.5 14B):** reads a member's tagged history when something looks risky; may suggest a light check-in only if code gates pass.
  - **Composer and chat (Qwen 2.5 14B):** writes the first message from a brief and replies to the member. Code checks every message and picks the buttons.
  - **Screenshot reader (Qwen 2.5 VL 7B):** describes the image; code decides the red flags and risk.
  - **Retro job:** SQL finds longer-window patterns; the model writes one sentence.
- **Privacy:** passwords, codes, card and Social Security numbers are masked before anything is stored.

## Challenges we ran into
- **Look-alikes.** A simple takeover rule flagged all 4 legitimate "real move" members. They changed only their address and paid a day later.
- **Amount alone can't tell scams from real payments.** A $51K home-closing wire looks like a scam on the numbers.
- **Making an LLM safe.** Testing exposed shared passwords, pressure from relatives, and prompt injection. We fixed them in code, not just prompts.
- **Small models are noisy.** The 3B tagger rated deposits and $20 payments "high", so data checks overrule it and only plausible items reach a person.
- **Honest evaluation.** We tuned on the same synthetic data we tested on, so our results are in-sample.

## Accomplishments that we're proud of
- Every anchor and look-alike story works end to end, including a scam we miss and a false positive.
- In-sample, the rules paused all 48 scam and takeover members and held 7 of 70 legitimate ones, all large wires or cash purchases. These are not real fraud rates.
- A working streaming pipeline with several cooperating agents, not just mockups.
- A feedback loop built in from day one: ratings, verdicts and employee replies tied to the agent version.
- Safeguards for relatives or caregivers who may be the exploiter.

## What we learned
- A quiet pause often beats a louder warning. In our data, warnings were clicked through every time.
- Honesty beats reassurance: members need to know they're in control.
- Use the LLM for understanding and writing, and keep money decisions in plain, testable code.
- Pick the smallest model that does the job, and let code check its work.

## What's next for Harbor
- Run in shadow mode on real data to measure true false positives.
- Evaluate on held-out data.
- Turn saved verdicts, ratings and employee replies into rule tuning, eval sets and example replies for the agent.
- Add real SMS and push delivery, plus phone and branch channels.
- Test tone and accessibility with real members.

## Built with
JavaScript, Node.js, Redpanda (Kafka API), PostgreSQL, Docker, Ollama, Qwen 2.5 (3B, 14B, VL 7B)
