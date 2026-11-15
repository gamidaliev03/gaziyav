# Claude inside Gaziyav

[← Manual](README.md)

**What it is for.** Editing by telling Claude what you want. Claude works in your open project with the editor's own commands. Every step lands on the timeline you see and can be undone.

## Connect

1. Install Gaziyav and the Claude app for Mac (or Claude Code). Anthropic's help pages say desktop extensions are available to all users of Claude Desktop.
2. In Gaziyav: Settings → **AI** → **Claude** → **Connect Claude**. One press sets it all up: Claude for Mac opens the Gaziyav extension and installs it; for Claude Code, the editing skill and the server are added. The status line shows what is connected; **Connect again** repairs the connection.
3. Open a project in Gaziyav and talk to Claude in its own window. If Gaziyav is closed, Claude starts it in the background.

When Gaziyav updates, Claude's skill is updated on the next start.

## What it costs

The connector is free and needs no API key: it is part of the app and runs on your Mac. Claude's messages count toward your Claude plan, like any chat. Paid generation (a voice, a picture, a video, lipsync) runs only on your own key, and you see the price before it starts ([Paid AI](extras.md)).

## What to ask

- «Remove the pauses and the ums in the first clip.»
- «Captions in a bold style, two lines at most.»
- «A title "Day one" at 0:02, and make it bigger.»
- «Make it vertical for Reels and keep it under 30 seconds.»
- «Lower my music under the voice and fade it out at the end.»
- «Put this YouTube piece after the second clip: <link>, from 1:10 to 1:25.»
- «Find the scenes of this film; move scene 4 before scene 2; give me YouTube chapters.»
- «Look at the cut at 0:05 and 0:12 and tell me what's off.»
- «Export it for TikTok.» · «Post it to YouTube Shorts» (it asks before posting).

What Claude can work with: projects; import (your files, a YouTube piece, web pictures); music and sound effects from the library; cutting by words and times; trims, moves, speed, freeze, reverse; captions, titles and text designs; transitions, effects, filters, auto colour; keyframes and camera moves; sound levels and voice clean-up; scenes and chapters; looking at frames; export per platform; posting after your yes; paid generation on your key.

## Undo

Every call is ordinary editing: one <kbd>⌘Z</kbd> per step in Gaziyav, or ask Claude to undo. You can also change anything it did by hand. Claude sees your changes on its next call and keeps them.

## What it cannot do

- See pictures you paste into the chat. Save them to a folder and ask Claude to import them.
- Work without Gaziyav. It edits the open project in the app on this Mac; the browser edition has no connector.
- Post without your yes, or spend on paid models beyond the limit you set.
