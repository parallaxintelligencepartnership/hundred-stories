Title: I built Hundred Stories, a free browser tower sim, solo with Claude Code in nine days

I've been building a tower sim called Hundred Stories. You build a lobby, offices, condos, shops and elevators, then watch the place fill up with people over the years. It's free at https://hundredstories.xyz. No sign-up, no ads, it saves in your browser and plays offline. All the pixel art is drawn in code.

First commit was September 18. Today I shipped 0.6.0. That's 443 commits and about 2,140 automated tests, all built with Claude Code. Here's what I actually learned.

One agent plans, others build. I run one Claude session as the orchestrator. It writes a spec for each package of work and hands it to an implementer agent. For the engine round, four agents worked in separate git worktrees at the same time so nobody's test run saw another agent's half-finished edit. The orchestrator commits each package by explicit file path. The one night it ran `git commit -a` we had to undo it.

Tests are the gate, not vibes. I had Claude run a full audit with one reviewer agent per area and a second agent verifying each finding. It confirmed 9 critical, 30 important and 52 advisory issues. Every one got closed with a test that fails if you revert the fix. Nothing ships with an open finding.

Now the stuff that went wrong. The first build looked nothing like what I had in my head. My exact words in the log were "THAT CHROME VIEW DOESNT LOOK ANYTHING LIKE SIM TOWER USED TO." Later I noticed nobody used the elevator. Boarding cost 10 in the route planner and stairs cost 4 a floor, so everyone just walked. And I had to tell it "I DO NOT DEPLOY YOU DEPLOY" because it kept handing the last step back to me.

The biggest mistake was process creep. I ended up with two review layers and a fix round for every tiny advisory. It was slow and most of it was noise. I told it to "cut the junk processes." Now it's one review per package, small stuff gets batched, and the implementer decides small things on its own.

If you're starting out, here's what I'd tell you:

- Keep a decision log with your own words in it. New sessions read it and stop re-asking.
- Keep the game sim pure and seeded. Same inputs, same result, so it's actually testable.
- Play it yourself every day. Claude can't tell you the stairs look hideous.

That last one is real. I did call the old stairs "hideous, abysmal even." They're modern now.

Here's my ask. Play it and tell me what breaks. Phones especially. Most of my phone testing has been emulated, so real devices are where I expect problems. If you have a feature idea, the Requests link on the site goes straight to GitHub issues. Source is public to read at https://github.com/parallaxintelligencepartnership/hundred-stories.

Thanks for looking.

Matt

------------------------------------------------------------

Alternative titles:

1. Hundred Stories: a tower sim I built with Claude Code, 443 commits and 2,140 tests later
2. What I learned building a SimTower-style browser game solo with Claude Code
3. Free tower-building sim made with Claude Code, looking for people to break it on phones
