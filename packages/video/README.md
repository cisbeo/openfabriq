# Product video

The openfabriq presentation video, written as HTML and rendered with [HyperFrames](https://github.com/heygen-com/hyperframes). Not a pnpm package: nothing here is built or tested with the rest of the repository.

Needs Node 24+ and `ffmpeg`. From this folder:

```bash
npx hyperframes@0.9.23 preview     # live preview in the browser
npx hyperframes@0.9.23 check       # lint, layout and motion checks
npx hyperframes@0.9.23 snapshot --at 2,8,18   # frames to look at
npx hyperframes@0.9.23 render -o renders/mix.mp4
```

The render's mix sits around -20 LUFS: bring the delivered file to -16 LUFS, the usual level online, with ffmpeg's two-pass `loudnorm` (measure with `-af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`, then apply the measured values with `linear=true`, copying the video stream).

Set `DO_NOT_TRACK=1` to turn off the CLI's usage telemetry.

`index.html` mounts one scene per file in `compositions/`. Colors and fonts are the landing page's (`packages/docs/app/global.css`, Geist under the OFL). The voice-over comes from ElevenLabs' free plan: put `ELEVENLABS_API_KEY` in `.env` here (ignored by git). The free plan allows non-commercial use only and asks for "elevenlabs.io" in the title of what is published: the end card credits it, and so must the video's title wherever it is posted. `renders/`, `auditions/` and `assets/voice/` are ignored too.

## Storyboard

Voice-over in English by ElevenLabs' Eric (`cjVigY5qzO86Huf0OWal`, model `eleven_multilingual_v2`, stability 0.6, similarity 0.75), one clip per scene; the captions on screen carry the story when the video plays muted. The text sent to ElevenLabs writes the name "OpenFabric", the way it is said.

One request is followed from Slack to the merge: the same issue #44 and pull request #45 as the studio's screenshots, and a path at the top of the screen (`rail.html`: Slack, Issue, Triage, Implement, Review, Merge) lights the step on screen.

| # | Scene | Voice-over |
| --- | --- | --- |
| 1 | `title`: the logo from the first frame (the thumbnail), then the line | This is your software factory. As code. |
| 2 | `define`: the hero's tabs over `examples/00-at-a-glance`: Factory, Agents, Automations (with `reviewed_by: reviewer` marked), Skills | One folder in your repository describes it all: the factory's settings, its agents, the automations that start them, and the skills they share. |
| 3 | `plan`: a terminal rises over the folder (`assets/images/define-end.png`, the define scene's last frame: recapture it with `snapshot --at 13.75` when that scene changes); `openfabriq plan`, security first, the reviewer and `reviewed by reviewer`, the review's labels, then `apply` | Before anything changes, OpenFabric plan shows you what will, new rights first. Apply, and the factory is live. |
| 4 | `where`: your machine and your Claude subscription, or a server for the team and a Claude API key | It runs on your machine, with your Claude subscription. Or on a server for the whole team, with an API key. |
| 5 | `slack`: a request in Slack, the issue's link in the thread | Here's what that looks like. Someone asks for a fix in Slack. The factory turns it into a GitHub issue. |
| 6 | `issue`: triage labels issue #44 | Triage sorts it, and marks it ready for an agent. |
| 7 | `run`: the run's log, the pull request proposed, the reviewer's two rounds (changes, then approved at risk low) | The implementer writes a test and makes it pass. Before anything leaves your machine, a reviewer reads the change, and sends it back until it's right. |
| 8 | `result`, then `review`: the checks, pull request #45 opened with `ready-to-merge` and `risk:low`, then merged on its own or handed to a human | Then the engine runs your checks, and opens the pull request. Low risk, in files you allowed? It merges on its own. Anything else waits for a human. |
| 9 | `principle`: the whole path, centre stage | Agents propose. The engine writes only what you allowed. |
| 10 | `integrations`: GitHub, Slack, Linear, Sentry (Simple Icons marks, as in the studio), webhooks, MCP | Start work from Slack, Linear, Sentry, or any webhook. |
| 11 | `studio`: the studio itself, from its demo at twice the pixels (`studio-shots.js` captures `assets/images/studio-*.png`): the board, the run of #44 with its reviewer and cost marked, the wiki's page, the chat's answer, each framed close with a slow camera move; then a Claude Code session asks the factory through `openfabriq mcp` | And follow it all in the studio: every run and its cost, a wiki that maps your code, written for you, and a chat with your factory. Even from Claude Code. |
| 12 | `end`: logo and install command | OpenFabric. Open source. Your factory, your rules. |

No example runs this whole path alone: Slack to issue is `03-team-chat`, triage to review is `02-sdlc`, and the merge under conditions is `merge_pull_request` (see the Automations page). 84.6 s, with motion blur and a dot-grid ground. Sound effects come from HyperFrames' bundled library, from Pixabay (`assets/sfx/CREDITS.md`: commercial use, no attribution needed), placed on the visible actions in `index.html`. The music is "The Warm Minimal" by Pumpupthemind ([Pixabay](https://pixabay.com/music/ambient-the-warm-minimal-468458/), Pixabay Content License: commercial use, no attribution needed, but no redistribution of the file as is, so `assets/music/` stays out of git). Download it as `assets/music/the-warm-minimal.mp3`, then cut it to the film on its 100 BPM grid (a bar is 2.4 s): its soft intro under the title and the tabs, the full part from `apply` on, a cut at 48.1 s to the same point of its second full part, and its soft ending under the end card:

```bash
ffmpeg -i assets/music/the-warm-minimal.mp3 -filter_complex "[0:a]atrim=0:48.115,asetpts=PTS-STARTPTS[a];[0:a]atrim=105.635:142.24,asetpts=PTS-STARTPTS[b];[a][b]acrossfade=d=0.08:c1=tri:c2=tri,afade=t=out:st=83.1:d=1.5,atrim=0:84.6[out]" -map "[out]" -c:a libmp3lame -b:a 192k assets/music/bed.mp3
```
