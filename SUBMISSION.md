## Inspiration
Putting myself in the shoes of the victims, the first loud emotion I felt was fear: fear from the threats, and fear of the unknown. In that moment, more than any notification, I knew that having an expert at my side would reassure me immediately. That is what we set out to build.

## What it does
Harbor is a personal security analyst for Sound Credit Union members. It protects against authorized scams and account takeover.

- **Spots the moment of risk.** Account events (password resets, contact changes, new recipients) quietly build a picture. When a payment starts, transparent rules decide: do nothing, ask a light question, or pause it.
- **Talks like a calm expert.** The member types anything in their own words. Harbor is honest, never blames, and keeps them in control. Takeover check-ins go to the phone on file before the changes.
- **The AI never controls the money.** The model reads the conversation and flags risk. Our code decides what options appear, so the model can't release, cancel or hold a payment.
- **Hands off to a real person** with the full context, so the member never repeats their story.
- **Treats legitimate members fairly.** Look-alike checks and a "Planned Big Payment" turn likely false holds into a light check or quick callback.

## How we built it
- **Trigger engine:** Arm and Decide stages in JavaScript, tested on all 118 synthetic members in a live simulator.
- **Prototype:** a member phone app, an employee console, and a chart showing every rule check.
- **Agent:** a local Qwen 2.5 14B model (Ollama) behind a prompt, a reply filter, and code-controlled options.
- **Backend:** Kafka-compatible events, a rules scorer (about 1 ms), an advisory LLM tagger, a notification agent, Postgres, and a retro job for longer-window patterns.

## Challenges we ran into
- **Look-alikes.** A simple takeover rule flagged all 4 legitimate "real move" members. They changed only their address and paid a day later.
- **Amount alone can't tell scams from real payments.** A $51K home-closing wire looks like a scam on the numbers.
- **Making an LLM safe.** Testing exposed shared passwords, pressure from relatives, and prompt injection. We fixed them in code, not just prompts.
- **Honest evaluation.** We tuned on the same synthetic data we tested on, so our results are in-sample.

## Accomplishments that we're proud of
- Every anchor and look-alike story works end to end, including a scam we miss and a false positive.
- In-sample, the rules paused all 48 scam and takeover members and held 7 of 70 legitimate ones, all large wires or cash purchases. These are not real fraud rates.
- A working streaming pipeline, not just mockups.
- Safeguards for relatives or caregivers who may be the exploiter.

## What we learned
- A quiet pause often beats a louder warning. In our data, warnings were clicked through every time.
- Honesty beats reassurance: members need to know they're in control.
- Use the LLM for understanding and writing, and keep money decisions in plain, testable code.

## What's next for Harbor
- Run in shadow mode on real data to measure true false positives.
- Evaluate on held-out data.
- Add real SMS and push delivery, plus phone and branch channels.
- Test tone and accessibility with real members.

## Built with
JavaScript, Node.js, Redpanda (Kafka API), PostgreSQL, Docker, Ollama, Qwen 2.5
