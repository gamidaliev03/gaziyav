// Safari up to 18 has no AudioDecoder for pages: AAC goes through the system decoder there (a no-op elsewhere)
import "@/media/aac-fallback";
import type { EditorCore } from "@/core";
import { playbackTracks } from "@/montage/compositions";
import { TICKS_PER_SECOND } from "@/wasm";
import { LruBytes } from "@/platform/lru-bytes";
import { joinBudget, noteUse, type BudgetMember } from "@/platform/memory-budget";
import { clampRetimeRate, shouldMaintainPitch } from "@/retime/rate";
import type { AudioClipSource } from "@/media/audio";
import { createAudioContext, collectAudioClips, fxRenderVersion, prepareSpeech, subscribeFxRendered } from "@/media/audio";
import { stereoChannel } from "@/media/audio-gather";
import { fileSource } from "@/media/file-source";
import {
	buildAudioGainAutomation,
	hasAnimatedVolume,
	resolveEffectiveAudioGain,
	type AudioCapableElement,
} from "@/timeline/audio-state";
import { readMixSettings } from "@/sounds/mix/fades";
import { createAudioMasteringChain } from "@/media/audio-mastering";
import { buildEnvelopeAutomation, envelopeGainAt, scheduleEnvelopeOnGain } from "@/sounds/mix/envelope";
import { buildPanAutomation, hasAnimatedPan, PAN_PATH, readPan } from "@/sounds/mix/pan";
import { createPanStage, type PanStage, schedulePanStage, setPanStage } from "@/sounds/mix/pan-stage";
import { masterOf } from "@/sound/master";
import { type LoudnessBlock, type LoudnessTap, type MasterStage, acquireLoudnessTap, createMasterStage } from "@/sound/player";
import { isTrackSilent, ownTrackOf, setSoloScope, silencedBySolo } from "@/sound/solo";
import {
	getClipTimeAtSourceTime,
	getSourceTimeAtClipTime,
	renderRetimedBuffer,
} from "@/retime";
import {
	ALL_FORMATS,
	AudioBufferSink,
	Input,
	type WrappedAudioBuffer,
} from "mediabunny";

/** ~43 ms at 48 kHz: longer than a frame even at 30 fps, so no sample peak falls between reads. */
const METER_WINDOW_SAMPLES = 2048;

interface MeterTapNodes {
	input: GainNode;
	splitter: ChannelSplitterNode;
	analysers: [AnalyserNode, AnalyserNode];
}

export interface MeterTap {
	/** Left and right channel of the mix bus. */
	analysers: readonly [AnalyserNode, AnalyserNode];
	release: () => void;
}

/** One track's sum (its clips after their own gain and pan), for the mixer's meters. */
interface TrackBus {
	gain: GainNode;
	tap: MeterTapNodes | null;
	users: number;
}

/** A scheduled piece of a clip and its gain: a volume or fade change during playback retunes it in place. */
interface LiveGain {
	gain: GainNode;
	contextTime: number;
	fromLocal: number;
	toLocal: number;
	prepared: boolean;
}

/** Fade in/out of the whole mix on start/stop: a cut in the middle of a wave is the click heard on Play. */
const BUS_FADE_SECONDS = 0.012;
/** Paused this long, the audio context is suspended (see suspendWhenIdle). */
const IDLE_SUSPEND_MS = 3000;
/** Edits quiet this long before the speech analysis warms up (see warmUpSpeechSoon). */
const SPEECH_WARM_UP_DELAY_MS = 400;
/**
 * How far ahead of the playhead a clip's sound is decoded and queued. The decoding loop runs on the page's thread:
 * with only 1 s queued, any moment the page was busy longer than that (a heavy frame, a save) ran the queue dry and
 * the video went silent for the rest of it. 4 s of queued sound is ~1.5 MB per clip.
 */
const AUDIO_AHEAD_SECONDS = 4;
/** How much sound the decoder adds in one go once the queue ahead is down by this much (perf, 13.11). */
const AUDIO_REFILL_SECONDS = 0.5;
/** The longest a wait for the playback to catch up goes without looking (a pause is seen within it). */
const CATCH_UP_CHECK_MS = 600;

/** A gain change on a sounding piece glides this long (no zipper or click while a slider moves). */
const RETUNE_GLIDE_SECONDS = 0.03;

/**
 * Freezes a param at what is heard now (mid-ramp too): the next ramp starts here. Always an explicit value at `time`:
 * cancelAndHoldAtTime inserts nothing once the last ramp has ended, so the next ramp started back at that old event
 * and the gain fell at once (the click on Pause).
 */
function holdAt(param: AudioParam, time: number): void {
	const value = param.value;
	param.cancelScheduledValues(time);
	param.setValueAtTime(value, time);
}

/**
 * Moves a param to `value` from whatever is heard now, called as often as a slider moves. setTarget starts from the
 * live value by itself; a hold + ramp per move dropped to silence and faded back (the crackle under a dragged slider).
 */
function glideTo(param: AudioParam, value: number, now: number): void {
	param.cancelScheduledValues(now);
	param.setTargetAtTime(value, now, RETUNE_GLIDE_SECONDS / 3);
}

export class AudioManager {
	private audioContext: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	/** Sum of every clip, before the timeline's master. */
	private mixBus: GainNode | null = null;
	/** The timeline's master (sound/player.ts): fader and limiter, after the mix bus; the meters read its output. */
	private master: MasterStage | null = null;
	/** The mixer's per-track sums, by the open timeline's track id. */
	private trackBuses = new Map<string, TrackBus>();
	private meterTap: MeterTapNodes | null = null;
	private meterTapUsers = 0;
	private playbackStartTime = 0;
	private playbackStartContextTime = 0;
	private scheduleTimer: number | null = null;
	private lookaheadSeconds = AUDIO_AHEAD_SECONDS;
	private scheduleIntervalMs = 500;
	private clips: AudioClipSource[] = [];
	private sinks = new Map<string, AudioBufferSink>();
	private sinkGeneration = 0;
	private inputs = new Map<string, Input>();
	private activeClipIds = new Set<string>();
	private clipIterators = new Map<
		string,
		AsyncGenerator<WrappedAudioBuffer, void, unknown>
	>();
	private queuedSources = new Set<AudioBufferSourceNode>();
	// The memory budget («audio.prepared» / «audio.decoded»: 64 / 128 MB on an 8 GB Mac, 256 / 512 MB on 16 GB), least
	// recently used first. A piece already playing keeps its buffer; a dropped one is decoded again when next played.
	private preparedClipBuffers = new LruBytes<string, Promise<AudioBuffer | null>>();
	private decodedBuffers = new LruBytes<string, Promise<AudioBuffer | null>>();
	private readonly budgets: BudgetMember[] = [
		{ name: "audio.prepared", used: () => this.preparedClipBuffers.bytes, shrink: (limit) => void this.preparedClipBuffers.shrinkTo(limit) },
		{ name: "audio.decoded", used: () => this.decodedBuffers.bytes, shrink: (limit) => void this.decodedBuffers.shrinkTo(limit) },
	];
	private playbackSessionId = 0;
	private lastIsPlaying = false;
	private lastVolume = 1;
	private playbackLatencyCompensationSeconds = 0;
	private unsubscribers: Array<() => void> = [];
	private liveGains = new Map<string, Set<LiveGain>>();
	/** One gain per clip after its pieces: a volume change is one glide here, the pieces are not touched. */
	private clipTrims = new Map<string, GainNode>();
	/** After each trim: the clip's Pan (sounds/mix/pan.ts), a matrix of gains into the mix. */
	private clipPans = new Map<string, PanStage>();
	/** The newest version of a clip for its pan (a pan edit made before the clip's first piece is scheduled). */
	private panElements = new Map<string, AudioCapableElement>();
	/** The volume baked into a clip's pieces; its trim plays (new volume ÷ this). */
	private baseVolumes = new Map<string, number>();
	/** Sources, timing, speed and mute of the audio being played (not gain): only a change there restarts it. */
	private audioLayoutKey = "";
	private retuning: Promise<void> | null = null;
	private retunePending = false;
	/** The mix opens (fades in) with the first piece that starts on time, so late first pieces are never heard. */
	private busOpen = false;
	/** When the open mix fades in (context time). */
	private busOpenAt = 0;
	private busOpenTimer: number | null = null;
	private idleSuspendTimer: number | null = null;
	private speechWarmUpTimer: number | null = null;

	constructor(private editor: EditorCore) {
		this.lastVolume = this.editor.playback.getVolume();

		this.unsubscribers.push(
			...this.budgets.map(joinBudget),
			this.editor.playback.subscribe(this.handlePlaybackChange),
			this.editor.timeline.subscribe(this.handleTimelineChange),
			this.editor.media.subscribe(this.handleMediaChange),
			// a clip's effects rendered again (a setting changed): its new sound replaces the one playing
			subscribeFxRendered(this.handleTimelineChange),
			this.editor.playback.onSeek(this.handleSeek),
			// another timeline opened: its own master
			this.editor.scenes.subscribe(this.syncMaster),
		);
		// Solo is asked about the open timeline's own tracks (sound/solo.ts)
		setSoloScope(() => ({ own: this.editor.scenes.getActiveSceneOrNull()?.tracks ?? null, scenes: this.editor.scenes.getScenes() }));
		this.warmUpAudioContext();
	}

	/** The open timeline's master onto the player's stage (a glide when the fader moved; nothing when it is the same). */
	private syncMaster = (): void => {
		if (!this.master) return;
		this.master.set(masterOf(this.editor.scenes.getActiveSceneOrNull()?.tracks));
	};

	/** The master fader while it is dragged: heard at once, stored by the release (null: back to the stored one). */
	previewMaster(gainDb: number | null): void {
		this.ensureAudioContext();
		this.master?.preview(gainDb);
	}

	/** How deep the player's limiter went since the last ask, dB ≤ 0. */
	takeLimiterReduction(): number {
		return this.master?.takeReduction() ?? 0;
	}

	/**
	 * Loudness of the programme (after the master) by BS.1770, measured on the audio thread: `onBlocks` gets every
	 * finished 100 ms. Null when this device cannot run it.
	 */
	async acquireLoudnessTap(onBlocks: (blocks: LoudnessBlock[]) => void): Promise<LoudnessTap | null> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext || !this.master) return null;
		return acquireLoudnessTap(audioContext, this.master.output, onBlocks);
	}

	/** The mixer's meter of one track: the sum of its clips after their gain and pan. Released like the master's tap. */
	acquireTrackMeter(trackId: string): MeterTap | null {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) return null;
		const bus = this.trackBus(trackId);
		if (!bus) return null;
		if (!bus.tap) bus.tap = this.makeTap(audioContext, bus.gain);
		bus.users++;
		const tap = bus.tap;
		let released = false;
		return {
			analysers: tap.analysers,
			release: () => {
				if (released) return;
				released = true;
				bus.users = Math.max(0, bus.users - 1);
				if (bus.users > 0 || bus.tap !== tap) return;
				try {
					bus.gain.disconnect(tap.input);
				} catch {}
				tap.input.disconnect();
				tap.splitter.disconnect();
				bus.tap = null;
			},
		};
	}

	/** Explicit stereo with "speakers" up-mix: a mono clip lights both bars, like it plays. */
	private makeTap(audioContext: AudioContext, source: AudioNode): MeterTapNodes {
		const input = audioContext.createGain();
		input.channelCount = 2;
		input.channelCountMode = "explicit";
		input.channelInterpretation = "speakers";
		const splitter = audioContext.createChannelSplitter(2);
		const analysers = [0, 1].map(() => {
			const analyser = audioContext.createAnalyser();
			analyser.fftSize = METER_WINDOW_SAMPLES;
			analyser.smoothingTimeConstant = 0;
			return analyser;
		}) as [AnalyserNode, AnalyserNode];
		source.connect(input);
		input.connect(splitter);
		splitter.connect(analysers[0], 0);
		splitter.connect(analysers[1], 1);
		return { input, splitter, analysers };
	}

	/** The bus of a track of the open timeline (a compound clip's inner tracks sum into their clip's track). */
	private trackBus(trackId: string): TrackBus | null {
		const audioContext = this.audioContext;
		if (!audioContext || !this.mixBus) return null;
		const id = ownTrackOf(trackId);
		let bus = this.trackBuses.get(id);
		if (!bus) {
			const gain = audioContext.createGain();
			gain.connect(this.mixBus);
			bus = { gain, tap: null, users: 0 };
			this.trackBuses.set(id, bus);
		}
		return bus;
	}

	/** Buses of tracks that are gone (and that no meter reads) leave the graph. */
	private pruneTrackBuses(): void {
		const tracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!tracks || this.trackBuses.size === 0) return;
		const alive = new Set([tracks.main.id, ...tracks.overlay.map((t) => t.id), ...tracks.audio.map((t) => t.id)]);
		for (const [id, bus] of this.trackBuses) {
			if (alive.has(id) || bus.users > 0) continue;
			bus.gain.disconnect();
			this.trackBuses.delete(id);
		}
	}

	/**
	 * The first AudioContext of the app blocks the main thread for ~110 ms while macOS opens the audio device
	 * (the next ones are free). Made at the first Play, that delayed the first picture by as much: it is made
	 * ahead, when the app is idle, and suspended until Play (resume costs nothing).
	 */
	private warmUpAudioContext(): void {
		if (typeof window === "undefined") return;
		const warm = () => {
			if (this.audioContext || this.editor.playback.getIsPlaying()) return;
			const context = this.ensureAudioContext();
			if (context && context.state === "running") void context.suspend().catch(() => {});
		};
		if (typeof window.requestIdleCallback === "function") {
			window.requestIdleCallback(warm, { timeout: 4000 });
		} else {
			window.setTimeout(warm, 1500);
		}
	}

	dispose(): void {
		this.stopPlayback();
		for (const unsub of this.unsubscribers) {
			unsub();
		}
		this.unsubscribers = [];
		this.disposeSinks();
		this.preparedClipBuffers.clear();
		this.decodedBuffers.clear();
		if (this.audioContext) {
			void this.audioContext.close();
			this.audioContext = null;
			this.masterGain = null;
			this.mixBus = null;
			this.master = null;
			this.trackBuses.clear();
			this.meterTap = null;
			this.meterTapUsers = 0;
		}
		setSoloScope(null);
	}

	/**
	 * Level-meter tap after the timeline's master: the program before preview volume and the safety limiter, so
	 * the meter shows what the export carries, overs above 0 dBFS included. Nothing is connected
	 * until a meter asks; `release()` disconnects it again when the last meter lets go.
	 */
	acquireMeterTap(): MeterTap | null {
		const audioContext = this.ensureAudioContext();
		const source = this.master?.output ?? this.mixBus;
		if (!audioContext || !source) return null;
		if (!this.meterTap) this.meterTap = this.makeTap(audioContext, source);
		this.meterTapUsers++;
		const tap = this.meterTap;
		let released = false;
		return {
			analysers: tap.analysers,
			release: () => {
				if (released) return;
				released = true;
				this.meterTapUsers = Math.max(0, this.meterTapUsers - 1);
				if (this.meterTapUsers > 0 || this.meterTap !== tap) return;
				try {
					source.disconnect(tap.input);
				} catch {}
				tap.input.disconnect();
				tap.splitter.disconnect();
				this.meterTap = null;
			},
		};
	}

	private handlePlaybackChange = (): void => {
		const isPlaying = this.editor.playback.getIsPlaying();
		const volume = this.editor.playback.getVolume();

		if (volume !== this.lastVolume) {
			this.lastVolume = volume;
			this.updateGain();
		}

		if (isPlaying !== this.lastIsPlaying) {
			this.lastIsPlaying = isPlaying;
			if (isPlaying) {
				void this.startPlayback({
					time: this.editor.playback.getCurrentTime() / TICKS_PER_SECOND,
				});
			} else {
				this.stopPlayback();
				this.suspendWhenIdle();
			}
		}
	};

	private handleSeek = (time: number): void => {
		if (this.editor.playback.getIsScrubbing()) {
			this.stopPlayback();
			return;
		}

		if (this.editor.playback.getIsPlaying()) {
			void this.startPlayback({ time: time / TICKS_PER_SECOND });
			return;
		}

		this.stopPlayback();
	};

	private handleMediaChange = (): void => {
		this.decodedBuffers.clear();
		this.handleTimelineChange();
	};

	private handleTimelineChange = (): void => {
		this.warmUpSpeechSoon();
		this.syncMaster();

		// Volume, fades, ducking changed while playing (a slider being dragged sends dozens of these a second):
		// the playing pieces change their gain in place. Restarting dropped and re-decoded everything each time —
		// the crackle and stutter heard while dragging. The layout is read from the committed tracks, so a clip
		// being dragged (a preview) restarts the sound once, on release, not on every move.
		if (this.editor.playback.getIsPlaying() && this.audioLayoutKey && this.layoutKey() === this.audioLayoutKey) {
			this.retuneGains();
			return;
		}
		this.disposeSinks();
		this.preparedClipBuffers.clear();
		// Decoded sound is per file (sourceKey) and stays valid across edits.

		if (!this.editor.playback.getIsPlaying()) return;

		void this.startPlayback({
			time: this.editor.playback.getCurrentTime() / TICKS_PER_SECOND,
		});
	};

	/** Everything the scheduled audio depends on except gain. */
	private layoutKey(): string {
		const t = playbackTracks(this.editor);
		const parts: string[] = [`fx:${fxRenderVersion()}`];
		// not heard: muted, or silenced by another track's Solo
		const silenced = silencedBySolo(t);
		for (const track of [t.main, ...t.overlay, ...t.audio]) {
			parts.push(`${track.id}:${isTrackSilent(track, silenced) ? 1 : 0}`);
			for (const el of track.elements as Array<Record<string, any>>) {
				if (el.type !== "video" && el.type !== "audio") continue;
				parts.push(
					[el.id, el.type, el.mediaId ?? el.sourceUrl ?? "", el.startTime, el.duration, el.trimStart, el.trimEnd, el.params?.muted ? 1 : 0, el.isSourceAudioEnabled === false ? 0 : 1, el.retime ? JSON.stringify(el.retime) : ""].join(","),
				);
			}
		}
		return parts.join("|");
	}

	/**
	 * Gain changes while playing, read straight from the (preview) tracks — no clip collection, no decoding (that ran
	 * 50 times a second under a dragged slider and starved the audio). A volume change glides the clip's trim; a
	 * fade or keyframe change re-schedules its pieces' envelopes. Turning ducking on needs the voice analysis: the
	 * slower path.
	 */
	private retuneGains(): void {
		const ctx = this.audioContext;
		if (!ctx) return;
		const tracks = playbackTracks(this.editor, this.editor.timeline.getPreviewTracks() ?? undefined);
		const byId = new Map<string, AudioCapableElement>();
		for (const t of [tracks.main, ...tracks.overlay, ...tracks.audio]) for (const e of t.elements) byId.set(e.id, e as AudioCapableElement);
		const now = ctx.currentTime;
		for (const clip of this.clips) {
			const element = byId.get(clip.id);
			if (!element) continue;
			this.panElements.set(clip.id, element);
			const stage = this.clipPans.get(clip.id);
			if (stage) this.schedulePan(clip, stage, element, RETUNE_GLIDE_SECONDS);
		}
		for (const clip of this.clips) {
			const element = byId.get(clip.id);
			const old = clip.envelope;
			if (!element || !old) continue;
			const volume = resolveEffectiveAudioGain({ element, trackMuted: false, localTime: 0 });
			const settings = readMixSettings(element);
			if (settings.duck && !old.settings.duck) {
				this.retuneGainsFromClips();
				return;
			}
			const base = this.baseVolumes.get(clip.id) ?? clip.volume;
			const sameShape =
				settings.fadeIn === old.settings.fadeIn &&
				settings.fadeOut === old.settings.fadeOut &&
				settings.duck === old.settings.duck &&
				!hasAnimatedVolume({ element }) &&
				!hasAnimatedVolume({ element: old.element });
			const trim = this.clipTrims.get(clip.id);
			if (sameShape && base > 0 && trim) {
				glideTo(trim.gain, volume / base, now);
				continue;
			}
			if (sameShape && !trim) {
				// Nothing of it scheduled yet (it starts later): its pieces are made with the new volume.
				clip.volume = volume;
				clip.timelineElement = element;
				clip.envelope = { ...old, element };
				this.baseVolumes.set(clip.id, volume);
				continue;
			}
			// The shape changed: new envelopes on the pieces (the new volume baked in), the trim back to 1.
			clip.volume = volume;
			clip.timelineElement = element;
			clip.envelope = { ...old, element, settings, duckRanges: settings.duck ? old.duckRanges : [] };
			this.baseVolumes.set(clip.id, volume);
			if (trim) glideTo(trim.gain, 1, now);
			for (const live of this.liveGains.get(clip.id) ?? []) this.retune(clip, live);
		}
	}

	/** The slower path (ducking turned on: voice ranges needed): clips collected again, then retuned. */
	private retuneGainsFromClips(): void {
		if (this.retuning) {
			this.retunePending = true;
			return;
		}
		const session = this.playbackSessionId;
		this.retuning = (async () => {
			try {
				const preview = this.editor.timeline.getPreviewTracks();
				const fresh = await collectAudioClips({ tracks: playbackTracks(this.editor, preview ?? undefined), mediaAssets: this.editor.media.getAssets() });
				if (session !== this.playbackSessionId || !this.audioContext) return;
				const byId = new Map(fresh.map((c) => [c.id, c]));
				const now = this.audioContext.currentTime;
				for (const clip of this.clips) {
					const next = byId.get(clip.id);
					if (!next) continue;
					// The clip object is the one the schedulers hold: later pieces get the new gain too.
					clip.volume = next.volume;
					clip.envelope = next.envelope;
					clip.timelineElement = next.timelineElement;
					this.baseVolumes.set(clip.id, next.volume);
					const trim = this.clipTrims.get(clip.id);
					if (trim) glideTo(trim.gain, 1, now);
					for (const live of this.liveGains.get(clip.id) ?? []) this.retune(clip, live);
				}
			} catch {}
		})().finally(() => {
			this.retuning = null;
			if (this.retunePending) {
				this.retunePending = false;
				this.retuneGainsFromClips();
			}
		});
	}

	/** The clip's trim (created on its first piece), into the mix. */
	private clipOut(clip: AudioClipSource): AudioNode {
		const ctx = this.audioContext!;
		let trim = this.clipTrims.get(clip.id);
		if (!trim) {
			trim = ctx.createGain();
			// into its track's bus (the mixer's meter reads it), which sums into the mix
			const stage = createPanStage(ctx, trim, (clip.trackId ? this.trackBus(clip.trackId)?.gain : null) ?? this.mixBus ?? this.masterGain ?? ctx.destination);
			this.clipPans.set(clip.id, stage);
			this.schedulePan(clip, stage, this.panElements.get(clip.id) ?? clip.timelineElement, 0);
			this.clipTrims.set(clip.id, trim);
			if (!this.baseVolumes.has(clip.id)) this.baseVolumes.set(clip.id, clip.volume);
		}
		return trim;
	}

	/**
	 * The clip's pan on its stage: a fixed one set (glided while it sounds), a keyframed one scheduled from now to
	 * the clip's end in context time (timeline time → context time as the pieces are). Unchanged pan: nothing to do.
	 */
	private schedulePan(clip: AudioClipSource, stage: PanStage, element: AudioCapableElement, glide: number): void {
		const ctx = this.audioContext;
		if (!ctx) return;
		const animated = hasAnimatedPan(element);
		const key = animated ? `k${JSON.stringify((element.animations as Record<string, unknown> | undefined)?.[PAN_PATH] ?? null)}|${clip.startTime}` : `p${readPan(element)}`;
		if (stage.key === key) return;
		stage.key = key;
		const now = ctx.currentTime;
		if (!animated) {
			setPanStage(stage, readPan(element), now, glide);
			return;
		}
		const toContext = (local: number) => this.playbackStartContextTime + (clip.startTime + local - this.playbackStartTime);
		const fromLocal = Math.max(0, this.getPlaybackTime() - clip.startTime);
		const points = buildPanAutomation(element, fromLocal, clip.duration).map((p) => ({ at: toContext(p.localTime), pan: p.pan }));
		schedulePanStage(stage, points, now);
	}

	private retune(clip: AudioClipSource, live: LiveGain): void {
		const audioContext = this.audioContext;
		if (!audioContext) return;
		const now = audioContext.currentTime;
		// Not sounding yet: schedule it fresh, as if it had been made with the new values.
		if (live.contextTime > now + RETUNE_GLIDE_SECONDS) {
			if (live.prepared) this.scheduleClipGainAutomation({ audioContext, clip, clipGain: live.gain, startTimestamp: live.contextTime, startLocalTime: live.fromLocal });
			else if (clip.envelope) scheduleEnvelopeOnGain({ gain: live.gain.gain, env: clip.envelope, contextTime: live.contextTime, fromLocal: live.fromLocal, toLocal: live.toLocal, now });
			else {
				live.gain.gain.cancelScheduledValues(0);
				live.gain.gain.setValueAtTime(clip.volume, live.contextTime);
			}
			return;
		}
		// Sounding: glide from where it is to the new level (a jump in gain is a click), then follow the new envelope.
		const g = live.gain.gain;
		const at = now + RETUNE_GLIDE_SECONDS;
		const local = live.fromLocal + (at - live.contextTime);
		const env = clip.envelope;
		holdAt(g, now);
		g.linearRampToValueAtTime(env ? envelopeGainAt(env, local) : clip.volume, at);
		if (env) {
			for (const p of buildEnvelopeAutomation(env, live.fromLocal, live.toLocal)) {
				const when = live.contextTime + (p.localTime - live.fromLocal);
				if (when > at) g.linearRampToValueAtTime(p.gain, when);
			}
		}
	}

	private trackGain(clipId: string, live: LiveGain, node: AudioBufferSourceNode): void {
		let set = this.liveGains.get(clipId);
		if (!set) this.liveGains.set(clipId, (set = new Set()));
		set.add(live);
		node.addEventListener("ended", () => set.delete(live));
	}

	/**
	 * Opens the mix with a short fade at `at` (context time), once per playback, or sooner when a piece that starts
	 * earlier turns up. The next clip's first piece is scheduled seconds ahead and could come first: the mix then
	 * stayed shut until that cut, the sound "dropping out" for up to the look-ahead after Play, undo or redo.
	 */
	private openBus(at: number): void {
		if (!this.mixBus || !this.audioContext) return;
		const start = Math.max(at, this.audioContext.currentTime);
		if (this.busOpen && this.busOpenAt <= start) return;
		this.busOpen = true;
		this.busOpenAt = start;
		const g = this.mixBus.gain;
		g.cancelScheduledValues(start);
		g.setValueAtTime(0, start);
		g.linearRampToValueAtTime(1, start + BUS_FADE_SECONDS);
	}

	private ensureAudioContext(): AudioContext | null {
		if (this.audioContext) return this.audioContext;
		if (typeof window === "undefined") return null;

		this.audioContext = createAudioContext();
		const { input } = createAudioMasteringChain({
			audioContext: this.audioContext,
			destination: this.audioContext.destination,
		});
		this.masterGain = input;
		this.masterGain.gain.value = this.lastVolume;
		this.mixBus = this.audioContext.createGain();
		// Closed until the first on-time piece opens it with a fade: a late first piece (its seam with the next one
		// ticks) stays under the closed bus, on the very first Play too.
		this.mixBus.gain.value = 0;
		// mix → the timeline's master (fader, limiter) → preview volume
		this.master = createMasterStage(this.audioContext, this.mixBus, this.masterGain);
		this.syncMaster();
		return this.audioContext;
	}

	private updateGain(): void {
		if (!this.masterGain || !this.audioContext) return;
		// A glide, not a jump (a jump clicks).
		glideTo(this.masterGain.gain, this.lastVolume, this.audioContext.currentTime);
	}

	private getPlaybackTime(): number {
		if (!this.audioContext) return this.playbackStartTime;
		const elapsed =
			this.audioContext.currentTime - this.playbackStartContextTime;
		return this.playbackStartTime + elapsed;
	}

	/**
	 * Context time at which timeline `time` (seconds) must be heard so audio
	 * lines up with the video clock (PlaybackManager runs on performance.now()).
	 * Setup awaits (resume, clip collection) no longer delay the audio: clips
	 * that should already be playing start late with an offset instead.
	 */
	private getContextTimeForTimelineTime({
		audioContext,
		time,
	}: {
		audioContext: AudioContext;
		time: number;
	}): number {
		const clock = this.editor.playback.getPlaybackClock();
		if (!clock || typeof audioContext.getOutputTimestamp !== "function") {
			return audioContext.currentTime;
		}
		const timestamp = audioContext.getOutputTimestamp();
		const wallTimeForTime =
			clock.wallTime + (time - clock.time / TICKS_PER_SECOND) * 1000;
		// Right after resume() (first play) the output timestamp is still 0:
		// map through currentTime ~ now instead of giving up on the anchor.
		const hasOutputTimestamp =
			timestamp.contextTime !== undefined &&
			timestamp.performanceTime !== undefined &&
			timestamp.performanceTime > 0;
		const contextNow = hasOutputTimestamp
			? (timestamp.contextTime as number)
			: audioContext.currentTime;
		const performanceNow = hasOutputTimestamp
			? (timestamp.performanceTime as number)
			: performance.now();
		// The output timestamp already maps context time to when it is heard
		// (spec: performanceTime is when contextTime reaches the output), so no
		// extra outputLatency here: subtracting it made later plays ~28 ms early.
		const latency = hasOutputTimestamp ? 0 : audioContext.outputLatency || 0;
		return contextNow + (wallTimeForTime - performanceNow) / 1000 - latency;
	}

	/**
	 * Warm up voice-activity analysis so ducking follows speech from the first Play — once the edits have paused:
	 * run on every edit it cost ~1.1 ms of each delete/undo on a 264-clip timeline.
	 */
	private warmUpSpeechSoon(): void {
		if (typeof window === "undefined") return;
		if (this.speechWarmUpTimer) window.clearTimeout(this.speechWarmUpTimer);
		this.speechWarmUpTimer = window.setTimeout(() => {
			this.speechWarmUpTimer = null;
			try {
				void prepareSpeech({
					tracks: this.editor.scenes.getActiveScene().tracks,
					mediaAssets: this.editor.media.getAssets(),
				}).catch(() => {});
			} catch {}
		}, SPEECH_WARM_UP_DELAY_MS);
	}

	/**
	 * A running context keeps the Mac's audio device busy doing nothing: the idle editor used ~30 % more CPU
	 * after the first Play. Paused for a few seconds, it is suspended; Play resumes it (that costs nothing).
	 */
	private suspendWhenIdle(): void {
		if (typeof window === "undefined") return;
		if (this.idleSuspendTimer) window.clearTimeout(this.idleSuspendTimer);
		this.idleSuspendTimer = window.setTimeout(() => {
			this.idleSuspendTimer = null;
			if (!this.editor.playback.getIsPlaying() && this.audioContext?.state === "running") {
				void this.audioContext.suspend().catch(() => {});
			}
		}, IDLE_SUSPEND_MS);
	}

	private async startPlayback({ time }: { time: number }): Promise<void> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) return;
		if (this.idleSuspendTimer && typeof window !== "undefined") {
			window.clearTimeout(this.idleSuspendTimer);
			this.idleSuspendTimer = null;
		}

		this.stopPlayback();
		const session = ++this.playbackSessionId;
		this.playbackLatencyCompensationSeconds = 0;
		this.audioLayoutKey = this.layoutKey();
		this.syncMaster();
		this.pruneTrackBuses();

		const tracks = playbackTracks(this.editor);
		const mediaAssets = this.editor.media.getAssets();
		const duration = this.editor.timeline.getTotalDuration();

		if (duration <= 0) return;

		if (audioContext.state === "suspended") {
			await audioContext.resume();
		}
		// First play: the output clock needs a moment after resume() before
		// getOutputTimestamp() is valid; anchoring earlier was ~130-290 ms off.
		await waitForOutputClock(audioContext);

		const clips = await collectAudioClips({ tracks, mediaAssets });
		// A newer start (an undo right after a redo) owns the sound now: this one's clips and timers are stale.
		if (!this.editor.playback.getIsPlaying() || session !== this.playbackSessionId) return;
		this.clips = clips;

		this.playbackStartTime = time;
		this.playbackStartContextTime = this.getContextTimeForTimelineTime({
			audioContext,
			time,
		});

		this.scheduleUpcomingClips();

		if (typeof window !== "undefined") {
			this.scheduleTimer = window.setInterval(() => {
				this.scheduleUpcomingClips();
			}, this.scheduleIntervalMs);
			// Nothing started on time yet (slow first decode), or only a later clip has: open now, faded, rather than
			// stay silent until then.
			this.busOpenTimer = window.setTimeout(() => {
				if (session === this.playbackSessionId && this.audioContext) this.openBus(this.audioContext.currentTime);
			}, 350);
		}
	}

	private scheduleUpcomingClips(): void {
		if (!this.editor.playback.getIsPlaying()) return;

		const currentTime = this.getPlaybackTime();
		const windowEnd = currentTime + this.lookaheadSeconds;

		for (const clip of this.clips) {
			if (clip.muted) continue;
			if (this.activeClipIds.has(clip.id)) continue;

			const clipEnd = clip.startTime + clip.duration;
			if (clipEnd <= currentTime) continue;
			if (clip.startTime > windowEnd) continue;

			this.activeClipIds.add(clip.id);
			if (this.shouldUsePreparedClipBuffer({ clip })) {
				void this.schedulePreparedClip({
					clip,
					startTime: currentTime,
					sessionId: this.playbackSessionId,
				});
			} else {
				void this.runClipIterator({
					clip,
					startTime: currentTime,
					sessionId: this.playbackSessionId,
				});
			}
		}
	}

	private stopPlayback(): void {
		if (this.scheduleTimer && typeof window !== "undefined") {
			window.clearInterval(this.scheduleTimer);
		}
		this.scheduleTimer = null;
		if (this.busOpenTimer && typeof window !== "undefined") window.clearTimeout(this.busOpenTimer);
		this.busOpenTimer = null;
		this.busOpen = false;
		this.liveGains.clear();
		const trims = [...this.clipTrims.values()];
		const pans = [...this.clipPans.values()];
		this.clipTrims.clear();
		this.clipPans.clear();
		this.panElements.clear();
		this.baseVolumes.clear();
		if (typeof window !== "undefined") window.setTimeout(() => { for (const t of trims) t.disconnect(); for (const p of pans) p.dispose(); }, 100);
		// Fade the mix out instead of cutting the waves (the click on Pause / seek).
		const ctx = this.audioContext;
		const stopAt = ctx ? ctx.currentTime + BUS_FADE_SECONDS : 0;
		if (ctx && this.mixBus) {
			const g = this.mixBus.gain;
			holdAt(g, ctx.currentTime);
			g.linearRampToValueAtTime(0, stopAt);
		}

		for (const iterator of this.clipIterators.values()) {
			void iterator.return();
		}
		this.clipIterators.clear();
		this.activeClipIds.clear();

		for (const source of this.queuedSources) {
			try {
				source.stop(stopAt);
			} catch {}
			// Disconnected when it has stopped (after the fade), not now.
			source.addEventListener("ended", () => source.disconnect());
		}
		this.queuedSources.clear();
	}

	private async runClipIterator({
		clip,
		startTime,
		sessionId,
	}: {
		clip: AudioClipSource;
		startTime: number;
		sessionId: number;
	}): Promise<void> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) return;

		const sink = await this.getAudioSink({ clip });
		if (!sink || !this.editor.playback.getIsPlaying()) return;
		if (sessionId !== this.playbackSessionId) return;

		const clipStart = clip.startTime;
		const clipEnd = clip.startTime + clip.duration;
		const playbackTimeAfterSinkReady = this.getPlaybackTime();
		const iteratorStartTime = Math.max(
			startTime,
			clipStart,
			playbackTimeAfterSinkReady,
		);
		if (iteratorStartTime >= clipEnd) {
			return;
		}
		const sourceStartTime =
			clip.trimStart +
			getSourceTimeAtClipTime({
				clipTime: iteratorStartTime - clip.startTime,
				retime: clip.retime,
				duration: clip.duration,
			});

		const iterator = sink.buffers(sourceStartTime);
		this.clipIterators.set(clip.id, iterator);
		let consecutiveDroppedBufferCount = 0;

		try {
		for await (const { buffer, timestamp } of iterator) {
			if (!this.editor.playback.getIsPlaying()) return;
			if (sessionId !== this.playbackSessionId) return;

			const timelineTime =
				clip.startTime +
				getClipTimeAtSourceTime({
					sourceTime: timestamp - clip.trimStart,
					retime: clip.retime,
					duration: clip.duration,
				});
			if (timelineTime >= clipEnd) break;

			const node = audioContext.createBufferSource();
			node.buffer = buffer;
			if (clip.retime) {
				node.playbackRate.value = clampRetimeRate({ rate: clip.retime.rate });
			}
			const clipGain = audioContext.createGain();
			clipGain.gain.value = clip.volume;
			node.connect(clipGain);
			clipGain.connect(this.clipOut(clip));

			const startTimestamp =
				this.playbackStartContextTime +
				this.playbackLatencyCompensationSeconds +
				(timelineTime - this.playbackStartTime);

			if (startTimestamp >= audioContext.currentTime) {
				node.start(startTimestamp);
				this.openBus(startTimestamp);
				consecutiveDroppedBufferCount = 0;
			} else {
				const offset = audioContext.currentTime - startTimestamp;
				const rate = node.playbackRate.value;
				if (offset * rate < buffer.duration) {
					// A late piece really starts at the next render quantum, a little after `currentTime`, so it would
					// run that much into the next piece: both played at once for a few ms, a bump and a click as the
					// mix opened. It ends where it should have ended. The offset is in the buffer's own seconds.
					node.start(audioContext.currentTime, offset * rate);
					node.stop(startTimestamp + buffer.duration / rate);
					consecutiveDroppedBufferCount = 0;
				} else {
					consecutiveDroppedBufferCount += 1;
					if (consecutiveDroppedBufferCount >= 5) {
						const nextCompensationSeconds = Math.max(
							this.playbackLatencyCompensationSeconds,
							Math.min(0.25, offset + 0.01),
						);
						if (
							nextCompensationSeconds >
							this.playbackLatencyCompensationSeconds + 0.001
						) {
							this.playbackLatencyCompensationSeconds = nextCompensationSeconds;
						}
						const resyncStartTime = this.getPlaybackTime();
						this.clipIterators.delete(clip.id);
						void this.runClipIterator({
							clip,
							startTime: resyncStartTime,
							sessionId,
						});
						return;
					}
					continue;
				}
			}

			if (clip.envelope) {
				// Fades / ducking / keyframed volume for this piece of the clip.
				const fromLocal = timelineTime - clip.startTime;
				scheduleEnvelopeOnGain({
					gain: clipGain.gain,
					env: clip.envelope,
					contextTime: startTimestamp,
					fromLocal,
					toLocal: fromLocal + buffer.duration / node.playbackRate.value,
					now: audioContext.currentTime,
				});
			}

			const fromLocal = timelineTime - clip.startTime;
			this.trackGain(clip.id, { gain: clipGain, contextTime: startTimestamp, fromLocal, toLocal: fromLocal + buffer.duration / node.playbackRate.value, prepared: false }, node);
			this.queuedSources.add(node);
			node.addEventListener("ended", () => {
				node.disconnect();
				clipGain.disconnect();
				this.queuedSources.delete(node);
			});

			const aheadTime = timelineTime - this.getPlaybackTime();
			if (aheadTime >= AUDIO_AHEAD_SECONDS) {
				// perf, 13.11: decoding resumes when the sound queued ahead is down to AUDIO_AHEAD_SECONDS − AUDIO_REFILL_SECONDS,
				// then fills it in one go: one wait per half second of sound, not one per decoded buffer (~21 ms each).
				await this.waitUntilCaughtUp({ timelineTime, targetAhead: AUDIO_AHEAD_SECONDS - AUDIO_REFILL_SECONDS });
				if (sessionId !== this.playbackSessionId) return;
			}
		}

		} catch (error) {
			// An edit, seek or stop during playback disposes the decoder this loop was reading
			// (InputDisposedError): that session is over and a new one already took its place.
			if (sessionId === this.playbackSessionId && this.editor.playback.getIsPlaying()) {
				console.warn("Audio clip playback stopped:", error);
			}
			return;
		}

		this.clipIterators.delete(clip.id);
		// don't remove from activeClipIds - prevents scheduler from restarting this clip
		// the set is cleared on stopPlayback anyway
	}

	private async schedulePreparedClip({
		clip,
		startTime,
		sessionId,
	}: {
		clip: AudioClipSource;
		startTime: number;
		sessionId: number;
	}): Promise<void> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) return;

		const buffer = await this.getPreparedClipBuffer({ clip });
		if (!buffer || !this.editor.playback.getIsPlaying()) return;
		if (sessionId !== this.playbackSessionId) return;

		const clipStart = clip.startTime;
		const clipEnd = clip.startTime + clip.duration;
		const playbackTimeAfterReady = this.getPlaybackTime();
		const effectiveStartTime = Math.max(
			startTime,
			clipStart,
			playbackTimeAfterReady,
		);
		if (effectiveStartTime >= clipEnd) {
			return;
		}

		const node = audioContext.createBufferSource();
		node.buffer = buffer;
		const clipGain = audioContext.createGain();
		node.connect(clipGain);
		clipGain.connect(this.clipOut(clip));

		const startTimestamp =
			this.playbackStartContextTime +
			this.playbackLatencyCompensationSeconds +
			(effectiveStartTime - this.playbackStartTime);
		const clipOffset = effectiveStartTime - clipStart;
		let actualStartTimestamp = startTimestamp;
		let actualClipOffset = clipOffset;

		if (startTimestamp >= audioContext.currentTime) {
			node.start(startTimestamp, clipOffset);
			this.openBus(startTimestamp);
		} else {
			const lateOffset = audioContext.currentTime - startTimestamp;
			actualStartTimestamp = audioContext.currentTime;
			actualClipOffset = clipOffset + lateOffset;
			node.start(actualStartTimestamp, actualClipOffset);
		}

		this.scheduleClipGainAutomation({
			audioContext,
			clip,
			clipGain,
			startTimestamp: actualStartTimestamp,
			startLocalTime: actualClipOffset,
		});
		this.trackGain(clip.id, { gain: clipGain, contextTime: actualStartTimestamp, fromLocal: actualClipOffset, toLocal: clip.duration, prepared: true }, node);

		this.queuedSources.add(node);
		node.addEventListener("ended", () => {
			node.disconnect();
			clipGain.disconnect();
			this.queuedSources.delete(node);
		});
	}

	private waitUntilCaughtUp({
		timelineTime,
		targetAhead,
	}: {
		timelineTime: number;
		targetAhead: number;
	}): Promise<void> {
		// perf, 13.11: one timer for the time the playback needs to catch up (the audio clock runs in real time), checked
		// again when it fires — not a 100 ms poll per wait (58 intervals were set in 3 s of playing a talk with music).
		// A pause is seen within CATCH_UP_CHECK_MS.
		return new Promise((resolve) => {
			const check = () => {
				if (!this.editor.playback.getIsPlaying()) {
					resolve();
					return;
				}
				const ahead = timelineTime - this.getPlaybackTime();
				if (ahead < targetAhead) {
					resolve();
					return;
				}
				setTimeout(check, Math.min(CATCH_UP_CHECK_MS, Math.max(10, (ahead - targetAhead) * 1000 + 5)));
			};
			check();
		});
	}

	private disposeSinks(): void {
		for (const iterator of this.clipIterators.values()) {
			void iterator.return();
		}
		this.clipIterators.clear();
		this.activeClipIds.clear();

		for (const input of this.inputs.values()) {
			input.dispose();
		}
		this.inputs.clear();
		this.sinks.clear();
		this.pendingSinks.clear();
		this.sinkGeneration++;
	}

	private shouldUsePreparedClipBuffer({
		clip,
	}: {
		clip: AudioClipSource;
	}): boolean {
		return (
			this.hasCurveRetime({ clip }) ||
			hasAnimatedVolume({ element: clip.timelineElement }) ||
			shouldMaintainPitch({
				rate: clip.retime?.rate ?? 1,
				maintainPitch: clip.retime?.maintainPitch,
			})
		);
	}

	private hasCurveRetime({ clip }: { clip: AudioClipSource }): boolean {
		const mode = (clip.retime as { mode?: unknown } | undefined)?.mode;
		return mode === "curve";
	}

	private scheduleClipGainAutomation({
		audioContext,
		clip,
		clipGain,
		startTimestamp,
		startLocalTime,
	}: {
		audioContext: AudioContext;
		clip: AudioClipSource;
		clipGain: GainNode;
		startTimestamp: number;
		startLocalTime: number;
	}): void {
		if (clip.envelope) {
			scheduleEnvelopeOnGain({
				gain: clipGain.gain,
				env: clip.envelope,
				contextTime: startTimestamp,
				fromLocal: startLocalTime,
				toLocal: clip.duration,
				now: audioContext.currentTime,
			});
			return;
		}

		clipGain.gain.cancelScheduledValues(startTimestamp);
		clipGain.gain.setValueAtTime(clip.volume, startTimestamp);

		if (!hasAnimatedVolume({ element: clip.timelineElement })) {
			return;
		}

		const points = buildAudioGainAutomation({
			element: clip.timelineElement,
			fromLocalTime: startLocalTime,
			toLocalTime: clip.duration,
		});

		if (points.length === 0) {
			return;
		}

		clipGain.gain.setValueAtTime(points[0].gain, startTimestamp);
		for (let index = 1; index < points.length; index++) {
			const point = points[index];
			const pointTimestamp =
				startTimestamp + (point.localTime - startLocalTime);
			if (pointTimestamp < audioContext.currentTime) {
				continue;
			}

			clipGain.gain.linearRampToValueAtTime(point.gain, pointTimestamp);
		}
	}

	private buildPreparedClipCacheKey({
		clip,
	}: {
		clip: AudioClipSource;
	}): string {
		return JSON.stringify({
			id: clip.id,
			sourceKey: clip.sourceKey,
			startTime: clip.startTime,
			duration: clip.duration,
			trimStart: clip.trimStart,
			trimEnd: clip.trimEnd,
			retime: clip.retime ?? null,
		});
	}

	private async getPreparedClipBuffer({
		clip,
	}: {
		clip: AudioClipSource;
	}): Promise<AudioBuffer | null> {
		const cacheKey = this.buildPreparedClipCacheKey({ clip });
		const existing = this.preparedClipBuffers.get(cacheKey);
		if (existing) {
			return existing;
		}

		const promise = (async () => {
			const audioContext = this.ensureAudioContext();
			if (!audioContext) {
				return null;
			}

			const decodedBuffer = await this.getDecodedBuffer({ clip });
			if (!decodedBuffer) {
				return null;
			}

			return await renderRetimedBuffer({
				audioContext,
				sourceBuffer: decodedBuffer,
				trimStart: clip.trimStart,
				clipDuration: clip.duration,
				retime: clip.retime,
				maintainPitch: clip.retime?.maintainPitch === true,
			});
		})();

		this.keepSized(this.preparedClipBuffers, cacheKey, promise, this.budgets[0]);
		return promise;
	}

	private async getDecodedBuffer({
		clip,
	}: {
		clip: AudioClipSource;
	}): Promise<AudioBuffer | null> {
		const existing = this.decodedBuffers.get(clip.sourceKey);
		if (existing) {
			return existing;
		}

		const promise = this.decodeClipBuffer({ clip });
		this.keepSized(this.decodedBuffers, clip.sourceKey, promise, this.budgets[1]);
		return promise;
	}

	/** Kept with its size once decoded (the budget counts float samples: length × channels × 4 bytes). */
	private keepSized(cache: LruBytes<string, Promise<AudioBuffer | null>>, key: string, promise: Promise<AudioBuffer | null>, member: BudgetMember): void {
		cache.set(key, promise, 0);
		void promise.then(
			(buffer) => {
				if (!buffer || !cache.has(key)) return;
				cache.resize(key, buffer.length * buffer.numberOfChannels * 4);
				noteUse(member);
			},
			() => {},
		);
	}

	private async decodeClipBuffer({
		clip,
	}: {
		clip: AudioClipSource;
	}): Promise<AudioBuffer | null> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) {
			return null;
		}

		const input = new Input({
			source: fileSource(clip.file),
			formats: ALL_FORMATS,
		});

		try {
			const audioTrack = await input.getPrimaryAudioTrack();
			if (!audioTrack) {
				return null;
			}

			const sink = new AudioBufferSink(audioTrack);
			const chunks: AudioBuffer[] = [];
			let totalSamples = 0;

			for await (const { buffer } of sink.buffers(0)) {
				chunks.push(buffer);
				totalSamples += buffer.length;
			}

			if (chunks.length === 0) {
				return null;
			}

			const targetSampleRate = audioContext.sampleRate;
			const nativeSampleRate = chunks[0].sampleRate;
			const numChannels = Math.min(2, chunks[0].numberOfChannels);
			const nativeChannels = Array.from(
				{ length: numChannels },
				() => new Float32Array(totalSamples),
			);

			let offset = 0;
			for (const chunk of chunks) {
				for (let channel = 0; channel < numChannels; channel++) {
					// a 5.1 source heard in stereo (its centre kept), as the export mixes it (media/audio-gather.ts)
					nativeChannels[channel].set(
						numChannels === 2 ? stereoChannel(chunk, channel as 0 | 1) : chunk.getChannelData(Math.min(channel, chunk.numberOfChannels - 1)),
						offset,
					);
				}
				offset += chunk.length;
			}

			const outputSamples = Math.ceil(
				totalSamples * (targetSampleRate / nativeSampleRate),
			);
			const offlineContext = new OfflineAudioContext(
				numChannels,
				outputSamples,
				targetSampleRate,
			);
			const nativeBuffer = audioContext.createBuffer(
				numChannels,
				totalSamples,
				nativeSampleRate,
			);

			for (let channel = 0; channel < numChannels; channel++) {
				nativeBuffer.copyToChannel(nativeChannels[channel], channel);
			}

			const sourceNode = offlineContext.createBufferSource();
			sourceNode.buffer = nativeBuffer;
			sourceNode.connect(offlineContext.destination);
			sourceNode.start(0);

			return await offlineContext.startRendering();
		} catch (error) {
			console.warn("Failed to decode clip audio:", error);
			return null;
		} finally {
			input.dispose();
		}
	}

	private pendingSinks = new Map<string, Promise<AudioBufferSink | null>>();

	private async getAudioSink({
		clip,
	}: {
		clip: AudioClipSource;
	}): Promise<AudioBufferSink | null> {
		const existingSink = this.sinks.get(clip.sourceKey);
		if (existingSink) return existingSink;
		// Many clips of one source (a cut-up video) start together: they share one decoder
		// instead of each opening its own (the extra ones were never disposed).
		const pending = this.pendingSinks.get(clip.sourceKey);
		if (pending) return pending;
		const created = this.createAudioSink({ clip }).finally(() => {
			if (this.pendingSinks.get(clip.sourceKey) === created) this.pendingSinks.delete(clip.sourceKey);
		});
		this.pendingSinks.set(clip.sourceKey, created);
		return created;
	}

	private async createAudioSink({
		clip,
	}: {
		clip: AudioClipSource;
	}): Promise<AudioBufferSink | null> {
		const generation = this.sinkGeneration;
		try {
			const input = new Input({
				source: fileSource(clip.file),
				formats: ALL_FORMATS,
			});
			const audioTrack = await input.getPrimaryAudioTrack();
			if (!audioTrack) {
				input.dispose();
				return null;
			}

			const sink = new AudioBufferSink(audioTrack);
			if (generation !== this.sinkGeneration) {
				// The timeline changed while this decoder opened: it belongs to a dead session.
				input.dispose();
				return null;
			}
			this.inputs.set(clip.sourceKey, input);
			this.sinks.set(clip.sourceKey, sink);
			return sink;
		} catch (error) {
			console.warn("Failed to initialize audio sink:", error);
			return null;
		}
	}
}

/** Resolves once the context reports a real output timestamp (max ~300 ms). */
async function waitForOutputClock(audioContext: AudioContext): Promise<void> {
	if (typeof audioContext.getOutputTimestamp !== "function") return;
	const deadline = performance.now() + 300;
	while (performance.now() < deadline) {
		const { contextTime, performanceTime } = audioContext.getOutputTimestamp();
		if ((contextTime ?? 0) > 0 && (performanceTime ?? 0) > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
