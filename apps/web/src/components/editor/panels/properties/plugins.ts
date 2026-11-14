// Inspector plug-ins: one import per feature; each module calls registerInspectorSection() from ./slots.
// Tabs: "speed" (video/audio), "tracking" (hidden until something registers), "ai" (AI tools for a clip),
// "animation", "effects" (shown as Adjust), "basic"… — see InspectorTabId in ./slots.ts.
//
// motion: Tracker → tab "tracking"; Speed ramps, Optical flow → tab "speed" (order > 100 = under Speed).
// neural: AI effects → tab "ai".
import "@/neural/inspector";
import "@/motion/inspector";
// studio: Lipsync / voice → tab "lipsync" (the tool for the selected clip; not in the left panel).
import "@/studio/components/lipsync-inspector";
// faceswap: Face swap → tab "ai" (before AI effects).
import "@/faceswap/inspector";
import "@/cleanup/inspector";
// transitions: the transition on an adjustment layer → the effect layer's tab ("effects").
import "@/transitions/components/layer-transition-section";
// shadow: the drop shadow of a video, photo, sticker, shape or AI layer → Basic (after Blend).
import "@/shadow/shadow-section";
