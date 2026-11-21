# Claude inside Gaziyav

[← Manual](README.md)

**What it is for.** Editing by telling Claude what you want. Claude works in your open project with the editor's own tools. Every step lands on the timeline you see and can be undone.

There are two ways to talk to Claude: the **chat inside Gaziyav** (Mac app, at the right of the editor) or the **Claude app** through Gaziyav's connector. Both edit the same open project the same way.

## The chat in the editor

**Connect**

1. Install Claude Code from [claude.com/download](https://claude.com/download) and sign in to your Claude account there.
2. Open Gaziyav. If the chat is hidden, choose **View → Claude Chat** (<kbd>⌃⌘K</kbd>).
3. Press **Connect** in the chat. Then open a project and write what you want.

**Use it**

- Show or hide the chat with **View → Claude Chat** (<kbd>⌃⌘K</kbd>) or the collapse button on the column. With the chat hidden, the editor keeps its layout.
- Conversations are kept per project. Start a new one, or go back to an earlier one, from the chat's top bar.
- Pick the model and the effort for each conversation.
- Attach files, and type <kbd>@</kbd> to point Claude at a file or a skill.
- On an empty chat, starter cards give you a first request in one click.

**Skills.** The **Skills** button on the chat's top bar lists 10 skills in three groups (Editing · Script & ideas · SMM & packaging), each with an on/off switch. A skill switched off is not offered to Claude; the base editing skill always stays on. Add your own skill from a GitHub link or a folder.

**Posting from the chat.** Ask for it, and one message edits, exports and posts to YouTube Shorts, TikTok and Reels through Zernio (your own Zernio key, formerly Late). Claude writes the title, description and hashtags for each site and puts the links in the chat. It posts only when your message asks for posting.

**Gaziyav AI.** The text buttons in the app — **Create with Gaziyav AI**, **Write with Gaziyav AI** in the Post sheet, titles, caption styling and translation, scripts — run on the Claude you connected. Until it is connected, they say in one line how to connect.

## The Claude app

1. Install the Claude app for Mac (or Claude Code). Anthropic's help pages say desktop extensions are available to all users of Claude Desktop.
2. In Gaziyav: Settings → **Services** → **Claude** → **Connect Claude**. One press sets it all up: Claude for Mac opens the Gaziyav extension and installs it; for Claude Code, the editing skill and the server are added. The status line shows what is connected; **Connect again** repairs the connection.
3. Open a project in Gaziyav and talk to Claude in its own window. If Gaziyav is closed, Claude starts it in the background.

When Gaziyav updates, Claude's skill is updated on the next start.

## What it costs

The chat and the connector are free and need no API key. Claude's messages count toward your Claude plan, like any chat. Paid generation (a voice, a picture, a video, lipsync) runs only on your own key, and only when you ask for it ([Paid AI](extras.md)).

## What to ask

- «Remove the pauses and the ums in the first clip.»
- «Captions in a bold style, two lines at most.»
- «A title "Day one" at 0:02, and make it bigger.»
- «Make it vertical for Reels and keep it under 30 seconds.»
- «Lower my music under the voice and fade it out at the end.»
- «Put this YouTube piece after the second clip: <link>, from 1:10 to 1:25.»
- «Find the scenes of this film; move scene 4 before scene 2; give me YouTube chapters.»
- «Look at the cut at 0:05 and 0:12 and tell me what's off.»
- «Export it for TikTok.» · «Cut a 30-second Reel, export it and post it to TikTok and Shorts.»

What Claude can work with: projects; import (your files, a YouTube piece, web pictures); music and sound effects from the library; cutting by words and times; trims, moves, speed, freeze, reverse; captions, titles and text designs; transitions, effects, filters, auto colour; keyframes and camera moves; sound levels and voice clean-up; scenes and chapters; looking at frames; export per platform; posting when you ask for it; paid generation on your key.

## Undo

Every call is ordinary editing: one <kbd>⌘Z</kbd> per step in Gaziyav, or ask Claude to undo. You can also change anything it did by hand. Claude sees your changes on its next call and keeps them.

## What it cannot do

- Work without Gaziyav. It edits the open project in the app on this Mac; the browser edition has no chat and no connector.
- Post when you did not ask for posting, or spend on paid models beyond the limit you set.
- In the Claude app: see pictures you paste there. Save them to a folder and ask Claude to import them, or attach them in Gaziyav's chat.
