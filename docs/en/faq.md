# FAQ

**English** · [Русский](../ru/faq.md)

<details>
<summary><b>Is it really free?</b></summary>

Yes. The editor is free, and its own code is MIT-licensed (bundled third-party parts keep their own licences — see [THIRD-PARTY-NOTICES](../../THIRD-PARTY-NOTICES.md)): no plan, no trial, no watermark, no feature behind a paywall. The editing AI (captions, pause removal, voice clean-up and more) runs free on your Mac, and Claude edits inside Gaziyav through the Claude app you already use — Gaziyav sells no credits and needs no API key for it. Only the optional paid models (lipsync, voice, generation) cost money, because the models do: you pay the provider (fal.ai) directly at its list price, with your own key, and Gaziyav takes nothing.

Motion-graphics layers are rendered with [Remotion](https://www.remotion.dev/license), which has its own licence: free for individuals, organisations of up to three people and non-profits; larger companies need Remotion's company licence.
</details>

<details>
<summary><b>Is it a CapCut clone?</b></summary>

No code, assets or designs of CapCut are used. Gaziyav offers a keymap that matches CapCut's keys, so people coming from it feel at home, and another that matches Final Cut Pro. The editor itself grew from the open-source OpenCut.
</details>

<details>
<summary><b>How is it different from OpenCut?</b></summary>

Gaziyav started from OpenCut's earlier codebase ([opencut-classic](https://github.com/opencut-app/opencut-classic)), which is MIT-licensed. On top of it: a desktop app with native helpers, lipsync as a full pipeline, AI on your own key with exact prices, frame-exact export, a timeline grammar checked by automated tests, local captions and models, looks, and a Russian interface. OpenCut itself is now being rewritten from the ground up — follow it at [opencut-app/opencut](https://github.com/opencut-app/opencut).
</details>

<details>
<summary><b>Is importing from YouTube legal?</b></summary>

The link import is a tool, like a browser's «Save video as». Use it for material you have the right to use — your own videos, footage licensed to you, or what the law where you live allows (quotation, review, parody). You are responsible for what you import and publish; the platforms' own terms apply too.
</details>

<details>
<summary><b>What is sent to servers?</b></summary>

Nothing, until you press a button that needs the internet. Then only what that button needs goes to the service it names. The full list, read from the code: [Privacy](privacy.md).
</details>

<details>
<summary><b>Why is the Mac app not notarised?</b></summary>

Notarisation needs a paid Apple Developer membership. It is on the roadmap. Until then, macOS asks you to confirm the first open once — [here is how](install.md#macos), safely.
</details>

<details>
<summary><b>Windows / Linux?</b></summary>

Use Gaziyav in your browser: [open the editor](https://gamidaliev03.github.io/gaziyav/editor/) — nothing to install, it runs on your own computer. There is no separate Windows or Linux app; the downloadable app is for the Mac. What the browser edition has and what only the Mac app has: [Install](install.md#any-other-computer-the-browser-edition).
</details>

<details>
<summary><b>Intel Macs?</b></summary>

The Mac app is built for Apple silicon (M1 and later). On an Intel Mac, use [Gaziyav in your browser](https://gamidaliev03.github.io/gaziyav/editor/).
</details>

<details>
<summary><b>How much does lipsync really cost?</b></summary>

On the default model, 20 ¢ for a line up to 40 s, then half a cent per second, plus about half a cent for the voice. A 3-minute clip that is mostly pauses: about 60 ¢, because silence is never sent. The exact price is on the button before you press. [Lipsync →](lipsync.md#what-it-costs)
</details>

<details>
<summary><b>Can I use another AI provider?</b></summary>

fal.ai is the main one and covers every feature. kie.ai and ArgoLink keys add their models. The agent can use any model available through OpenRouter on fal.
</details>

<details>
<summary><b>Does the result carry a watermark or an «AI» stamp?</b></summary>

No. Nothing is added to your video, ever. Whether to label AI-made content is your decision and, on some platforms, their rule.
</details>

<details>
<summary><b>Where are my projects?</b></summary>

In `~/Library/Application Support/Gaziyav` on your Mac; in the browser edition, in that browser's storage. Nothing is in a cloud.
</details>
