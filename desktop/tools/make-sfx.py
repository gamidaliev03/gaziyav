#!/usr/bin/env python3
# Gaziyav's own sound effects, synthesised here with ffmpeg (no recordings, nobody else's work): CC0 — made for
# Gaziyav. Each one: a synthesis graph → loudness matched (−16 LUFS, peaks ≤ −1 dBFS; very short ones by peak) →
# AAC 48 kHz → a library.json row (title, group, tag, length, preview wave, size, checksum, licence).
#   python3 tools/make-sfx.py <ffmpeg> <out dir (…/Sound Effects)>
import base64, hashlib, json, math, os, re, subprocess, sys

FF, OUT = sys.argv[1], sys.argv[2]
LICENSE = "CC0 1.0 — synthesised for Gaziyav (no third-party audio)"
os.makedirs(OUT, exist_ok=True)


def sweep(name, param, points, step=0.02):
    """asendcmd lines moving `name`'s `param` (several names: «a|b») through (time, value) points, exponentially
    between points (a pitch-like glide: equal steps per octave)."""
    cmds, t = [], 0.0
    end = points[-1][0]
    while t <= end + 1e-9:
        for (t0, v0), (t1, v1) in zip(points, points[1:]):
            if t0 <= t <= t1:
                k = (t - t0) / (t1 - t0) if t1 > t0 else 1
                v = v0 * (v1 / v0) ** k if v0 > 0 and v1 > 0 else v0 + (v1 - v0) * k
                for n in name.split("|"):
                    cmds.append(f"{t:.3f} {n} {param} {v:.1f}")
                break
        t += step
    return "asendcmd=c='" + ";".join(cmds) + "'"


def noise(d, color="pink", a=0.8, seed=1):
    return f"anoisesrc=d={d}:c={color}:r=48000:a={a}:s={seed}"


def tone(expr, d):
    return f"aevalsrc='{expr}':s=48000:d={d}"


def pan_lr(d, rev=False):
    """A mono [m] becomes stereo moving left → right (or back)."""
    l, r = (f"1-0.8*t/{d}", f"0.2+0.8*t/{d}") if not rev else (f"0.2+0.8*t/{d}", f"1-0.8*t/{d}")
    return f"asplit[pl][pr];[pl]volume='{l}':eval=frame[l];[pr]volume='{r}':eval=frame[r];[l][r]amerge=inputs=2"


def bands(d, pts, q=3.0, color="pink", seed=1, n=8, a=0.9):
    """A narrow noise band that glides along `pts` (time, Hz): n fixed bands crossfading in time — no filter
    coefficients change while it plays (that clicks)."""
    def f_at(t):
        for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
            if t0 <= t <= t1:
                k = (t - t0) / (t1 - t0) if t1 > t0 else 1
                return v0 * (v1 / v0) ** k
        return pts[-1][1]
    sigma = d / n * 0.9
    outs = "".join(f"[s{i}]" for i in range(n))
    g = f"{noise(d, color, a, seed)},asplit={n}{outs}"
    for i in range(n):
        tk = d * (i + 0.5) / n
        g += f";[s{i}]bandpass=f={f_at(tk):.0f}:t=q:w={q},bandpass=f={f_at(tk):.0f}:t=q:w={q},asetnsamples=n=64:p=0,volume='exp(-pow((t-{tk:.3f})/{sigma:.3f},2))':eval=frame[b{i}]"
    g += ";" + "".join(f"[b{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0"
    return g


def whoosh(d, f0, fpeak, f1, q=3.0, color="pink", rev=False, seed=1):
    # A narrow band that flies by (up to the peak, then away), louder in the middle, left → right.
    env = f"pow(sin(PI*t/{d}),2)" if not rev else f"pow(t/{d},2.5)"
    return f"{bands(d, [(0, f0), (d * 0.55, fpeak), (d, f1)], q, color, seed)},volume='{env}*5':eval=frame,{pan_lr(d)}"


def riser(d, f0=200, f1=2400, rev=False):
    chirp = f"0.45*sin(2*PI*({f0}*t+({f1}-{f0})*t*t/(2*{d})))*pow(t/{d},1.5)"
    n = f"{noise(d, 'white', 0.5)},{sweep('highpass@h', 'f', [(0, 300), (d, 5000)])},highpass@h=f=300,volume='pow(t/{d},2)':eval=frame[n]"
    g = f"{tone(chirp, d)}[c];{n};[c][n]amix=inputs=2:normalize=0,aecho=0.8:0.6:80|160:0.3|0.2"
    return g + (",areverse" if rev else "")


def kick(f_end=48, f_start=180, decay=6.0, d=0.6):
    return tone(f"0.9*sin(2*PI*({f_end}*t+({f_start}-{f_end})*(1-exp(-28*t))/28))*exp(-{decay}*t)", d)


def boom(d=2.5, sub=42):
    body = tone(f"0.9*sin(2*PI*({sub}*t+120*(1-exp(-9*t))/9))*exp(-1.6*t)", d)
    burst = f"{noise(d, 'brown', 0.9)},lowpass=f=900,volume='exp(-9*t)':eval=frame"
    return f"{body}[a];{burst}[b];[a][b]amix=inputs=2:normalize=0,aecho=0.8:0.7:60|130:0.35|0.2,lowpass=f=6000"


def bell(freqs, d=1.2, k=3.5, amp=0.35):
    return tone("+".join(f"{amp / (i + 1):.3f}*sin(2*PI*{f}*t)*exp(-{k * (1 + i * 0.6):.2f}*t)" for i, f in enumerate(freqs)), d)


def notes(seq, gap, d_each, k=6.0, wave="sin", amp=0.5):
    """Notes one after another: seq of frequencies (0 = rest)."""
    parts = []
    for i, f in enumerate(seq):
        if not f:
            continue
        t0 = i * gap
        w = f"sin(2*PI*{f}*(t-{t0:.3f}))" if wave == "sin" else f"(2/PI)*asin(sin(2*PI*{f}*(t-{t0:.3f})))" if wave == "tri" else f"sgn(sin(2*PI*{f}*(t-{t0:.3f})))*0.6"
        parts.append(f"{amp}*{w}*exp(-{k}*(t-{t0:.3f}))*gte(t,{t0:.3f})*lt(t,{t0 + d_each:.3f})")
    return tone("+".join(parts), len(seq) * gap + d_each)


def clicks(times, d, hp=2500, a=0.9, seed=3):
    """Short noise ticks at `times` (s)."""
    gate = "+".join(f"exp(-900*abs(t-{x:.3f}))" for x in times)
    return f"{noise(d, 'white', a, seed)},highpass=f={hp},volume='{gate}':eval=frame"


# (title, group, tag, filter graph)
S = []
add = lambda title, group, tag, graph: S.append((title, group, tag, graph))

# ── Transitions: whoosh & swoosh ──
add("Whoosh fast", "Transitions", "whoosh", whoosh(0.45, 500, 3200, 900))
add("Whoosh slow", "Transitions", "whoosh", whoosh(1.4, 250, 1800, 400, q=0.9))
add("Whoosh deep", "Transitions", "whoosh", whoosh(0.9, 120, 700, 160, q=0.8, color="brown"))
add("Air whoosh", "Transitions", "whoosh", whoosh(0.7, 900, 5200, 1500, q=0.7, color="white", seed=2))
add("Swoosh up", "Transitions", "swoosh", whoosh(0.6, 300, 2600, 4800, q=1.5, seed=4))
add("Swoosh down", "Transitions", "swoosh", whoosh(0.6, 4200, 2200, 260, q=1.5, seed=5))
add("Swipe left", "Transitions", "swipe", f"{bands(0.35, [(0, 3000), (0.35, 900)], 3, 'white', 6, 6)},volume='pow(sin(PI*t/0.35),2)*5':eval=frame,{pan_lr(0.35, rev=True)}")
add("Swipe right", "Transitions", "swipe", f"{bands(0.35, [(0, 900), (0.35, 3000)], 3, 'white', 7, 6)},volume='pow(sin(PI*t/0.35),2)*5':eval=frame,{pan_lr(0.35)}")
add("Reverse whoosh", "Transitions", "whoosh", whoosh(1.0, 300, 1200, 4000, q=1.0, rev=True, seed=8))
add("Wind gust", "Transitions", "whoosh", f"{noise(2.0, 'pink', 0.9, 9)},{sweep('lowpass@l', 'f', [(0, 300), (0.9, 2200), (2.0, 400)])},lowpass@l=f=300,tremolo=f=5:d=0.3,volume='pow(sin(PI*t/2),2)':eval=frame,{pan_lr(2.0)}")
add("Fast pass by", "Transitions", "whoosh", f"{whoosh(0.8, 400, 2400, 300, q=1.1, seed=10)},vibrato=f=3:d=0.2")
add("Page turn", "Transitions", "swoosh", f"{noise(0.4, 'white', 0.8, 11)},highpass=f=1800,volume='pow(sin(PI*t/0.4),3)*(1+0.6*sin(2*PI*40*t))':eval=frame")

# ── Risers & drops ──
add("Riser short", "Risers", "riser", riser(2.0))
add("Riser tension", "Risers", "riser", riser(4.0, 120, 1800))
add("Noise riser", "Risers", "riser", f"{noise(3.0, 'white', 0.8, 12)},{sweep('highpass@h', 'f', [(0, 200), (3.0, 7000)])},highpass@h=f=200,volume='pow(t/3,2.2)':eval=frame,aecho=0.8:0.5:90:0.3")
add("Shimmer riser", "Risers", "riser", tone("+".join(f"0.18*sin(2*PI*{m}*(220*t+660*t*t/6))*pow(t/3,1.6)" for m in (1, 1.5, 2, 3)), 3.0) + ",aecho=0.8:0.6:70|140|210:0.3|0.25|0.2")
add("Downlifter", "Risers", "drop", riser(2.0, 1800, 120) + ",areverse,afade=t=out:st=1.4:d=0.6")
add("Reverse cymbal", "Risers", "riser", f"{noise(2.0, 'white', 0.9, 13)},highpass=f=4000,volume='exp(-2.4*(2-t))':eval=frame,aecho=0.8:0.4:40:0.25")
add("Suck back", "Risers", "riser", whoosh(0.6, 200, 3000, 6000, rev=True, seed=14))

# ── Impacts ──
add("Cinematic boom", "Impacts", "boom", boom(3.0, 38))
add("Sub drop", "Impacts", "drop", tone("0.9*sin(2*PI*(30*t+90*(1-exp(-1.8*t))/1.8))*exp(-0.9*t)", 3.0))
add("Punch hit", "Impacts", "hit", f"{kick(60, 220, 9, 0.5)}[k];{noise(0.5, 'white', 0.7, 15)},bandpass=f=1800:t=q:w=0.8,volume='exp(-28*t)':eval=frame[n];[k][n]amix=inputs=2:normalize=0")
add("Thud", "Impacts", "hit", f"{kick(45, 110, 11, 0.45)},lowpass=f=600")
add("Trailer hit", "Impacts", "boom", f"{boom(3.0, 45)}[a];{bell([180, 271, 403, 590], 3.0, 1.4, 0.25)}[b];[a][b]amix=inputs=2:normalize=0")
add("Bass drop", "Impacts", "drop", tone("0.8*sin(2*PI*(40*t+260*(1-exp(-3*t))/3))*exp(-0.8*t)*(1+0.3*sin(2*PI*8*t))", 2.5))
add("Explosion", "Impacts", "boom", f"{noise(3.0, 'brown', 0.9, 16)},lowpass=f=1500,volume='exp(-1.4*t)*(1-exp(-60*t))':eval=frame[n];{kick(35, 140, 2.0, 3.0)}[k];[n][k]amix=inputs=2:normalize=0,aecho=0.8:0.6:90|200:0.3|0.25")
add("Door slam", "Impacts", "hit", f"{kick(70, 160, 18, 0.5)}[k];{noise(0.5, 'brown', 0.8, 17)},lowpass=f=1200,volume='exp(-20*t)':eval=frame[n];[k][n]amix=inputs=2:normalize=0,aecho=0.6:0.5:25|55:0.35|0.2")

# ── Pops & clicks ──
add("Pop", "Pops & clicks", "pop", tone("0.8*sin(2*PI*(380*t+900*(1-exp(-60*t))/60))*exp(-38*t)", 0.18))
add("Pop high", "Pops & clicks", "pop", tone("0.8*sin(2*PI*(700*t+1500*(1-exp(-70*t))/70))*exp(-45*t)", 0.14))
add("Bubble pops", "Pops & clicks", "pop", tone("+".join(f"0.7*sin(2*PI*({f}*(t-{x})+800*(1-exp(-60*(t-{x})))/60))*exp(-40*(t-{x}))*gte(t,{x})" for f, x in ((420, 0), (560, 0.12), (480, 0.22))), 0.45))
add("Mouse click", "Pops & clicks", "click", clicks([0.01, 0.07], 0.15, 3000))
add("Soft click", "Pops & clicks", "click", clicks([0.01], 0.08, 1200, 0.6) + ",lowpass=f=4000")
add("Tick", "Pops & clicks", "click", tone("0.8*sin(2*PI*2600*t)*exp(-120*t)", 0.06))
add("Tap", "Pops & clicks", "click", tone("0.8*sin(2*PI*900*t)*exp(-80*t)+0.3*sin(2*PI*2400*t)*exp(-140*t)", 0.1))
add("Toggle switch", "Pops & clicks", "click", clicks([0.01, 0.05], 0.12, 2000) + ",equalizer=f=1500:t=q:w=1:g=6")
add("Camera shutter", "Pops & clicks", "camera", f"{clicks([0.01, 0.09], 0.25, 1500, 0.9, 18)}[c];{noise(0.25, 'white', 0.5, 19)},bandpass=f=3500:t=q:w=1,volume='exp(-30*t)':eval=frame[n];[c][n]amix=inputs=2:normalize=0")
add("Typewriter key", "Pops & clicks", "typing", f"{clicks([0.005, 0.03], 0.18, 1800, 0.9, 20)}[c];{tone('0.25*sin(2*PI*1900*t)*exp(-60*t)', 0.18)}[b];[c][b]amix=inputs=2:normalize=0")
add("Typing", "Pops & clicks", "typing", clicks([0.02, 0.15, 0.24, 0.41, 0.5, 0.66, 0.79, 0.88, 1.02, 1.16, 1.27, 1.43], 1.6, 2200, 0.8, 21))

# ── UI ──
add("Notification", "UI", "notification", bell([1318.5, 2637], 1.0, 4.0))
add("Message received", "UI", "notification", notes([880, 1318.5], 0.11, 0.6, 6, "sin", 0.45))
add("Success", "UI", "success", notes([523.3, 659.3, 784, 1046.5], 0.08, 0.5, 5.5, "tri", 0.4))
add("Error", "UI", "error", notes([220, 175], 0.16, 0.3, 4, "sq", 0.35) + ",lowpass=f=2500")
add("Alert beep", "UI", "beep", notes([1000, 0, 1000], 0.12, 0.1, 1, "sin", 0.45))
add("Level up", "UI", "game", notes([392, 523.3, 659.3, 784, 1046.5, 1318.5], 0.06, 0.3, 6, "sq", 0.3) + ",lowpass=f=6000")
add("Coin", "UI", "game", notes([987.8, 1318.5], 0.07, 0.4, 7, "sq", 0.3) + ",lowpass=f=7000")
add("Like", "UI", "pop", tone("0.7*sin(2*PI*(600*t+1200*t*t))*exp(-14*t)", 0.3) + ",aecho=0.6:0.4:40:0.3")
add("Countdown", "UI", "beep", notes([880, 0, 0, 0, 880, 0, 0, 0, 880, 0, 0, 0, 1760], 0.25, 0.18, 3, "sin", 0.45))
add("Pop up", "UI", "pop", tone("0.7*sin(2*PI*(300*t+2400*t*t))*exp(-10*t)", 0.25))

# ── Glitch & tech ──
add("Glitch short", "Glitch", "glitch", f"{noise(0.4, 'white', 0.8, 22)},acrusher=bits=4:mode=log:samples=40,volume='gt(sin(2*PI*23*t),0.2)':eval=frame,bandpass=f=2000:t=q:w=0.6")
add("Digital stutter", "Glitch", "glitch", tone("0.6*sgn(sin(2*PI*330*t))*gt(sin(2*PI*16*t),0)+0.4*sin(2*PI*1760*t)*gt(sin(2*PI*9*t),0.5)", 0.8) + ",acrusher=bits=5:samples=8,lowpass=f=6000")
add("Bitcrush noise", "Glitch", "glitch", f"{noise(0.7, 'pink', 0.9, 23)},acrusher=bits=3:mode=lin:samples=70,highpass=f=300,afade=t=out:st=0.4:d=0.3")
add("Data corrupt", "Glitch", "glitch", tone("0.5*sin(2*PI*(200+1800*random(1))*t)*gt(random(2),0.6)", 0.9) + ",acrusher=bits=6:samples=20,lowpass=f=5000")
add("TV static", "Glitch", "static", f"{noise(1.2, 'white', 0.7, 24)},highpass=f=500,tremolo=f=30:d=0.4,afade=t=in:d=0.03,afade=t=out:st=1:d=0.2")
add("Tape stop", "Glitch", "tape", tone("0.5*sin(2*PI*(440*t-440*t*t/(2*1.2)))*(1-t/1.3)+0.3*sin(2*PI*(660*t-660*t*t/2.4))*(1-t/1.3)", 1.2) + ",lowpass=f=3000")
add("Rewind", "Glitch", "tape", tone("0.4*sin(2*PI*(800+600*sin(2*PI*14*t))*t)*(0.6+0.4*sin(2*PI*3*t))", 1.4) + ",acrusher=bits=8:samples=4,bandpass=f=1500:t=q:w=0.5")
add("Power down", "Glitch", "tech", tone("0.6*sin(2*PI*(600*t-560*t*t/(2*1.5)))*exp(-0.6*t)+0.2*sgn(sin(2*PI*(300*t-280*t*t/3)))*exp(-1.4*t)", 1.5) + ",lowpass=f=2500")
add("Scanner beep", "Glitch", "tech", tone("0.45*sin(2*PI*(1200+400*sin(2*PI*6*t))*t)", 1.0) + ",tremolo=f=12:d=0.6")

# ── Fun & memes (our own takes) ──
add("Boing", "Fun", "cartoon", tone("0.7*sin(2*PI*(180*t+60*sin(2*PI*14*t)/(2*PI*14)*14+300*t*t))*exp(-3*t)", 0.9))
add("Slide whistle up", "Fun", "cartoon", tone("0.5*sin(2*PI*(500*t+1100*t*t/1.6)+0.3*sin(2*PI*7*t))", 0.8) + ",afade=t=out:st=0.6:d=0.2")
add("Slide whistle down", "Fun", "cartoon", tone("0.5*sin(2*PI*(1600*t-1100*t*t/1.6)+0.3*sin(2*PI*7*t))", 0.8) + ",afade=t=out:st=0.6:d=0.2")
add("Sad trombone", "Fun", "fail", tone("+".join(f"0.4*(2/PI)*asin(sin(2*PI*{f}*(t-{x})+0.15*sin(2*PI*6*(t-{x}))))*gte(t,{x})*lt(t,{x}+{d})*(1-exp(-30*(t-{x})))" for f, x, d in ((311, 0, 0.4), (294, 0.45, 0.4), (277, 0.9, 0.4), (262, 1.35, 1.2))), 2.6) + ",lowpass=f=1800,afade=t=out:st=2.1:d=0.5")
add("Rimshot", "Fun", "drums", f"{kick(55, 160, 10, 1.4)}[k];{noise(1.4, 'white', 0.6, 25)},bandpass=f=1800:t=q:w=1,volume='exp(-40*(t-0.25))*gte(t,0.25)+exp(-3*(t-0.5))*gte(t,0.5)*0.8':eval=frame,highpass=f=1500[n];[k][n]amix=inputs=2:normalize=0")
add("Bonk", "Fun", "cartoon", tone("0.8*sin(2*PI*(260*t+500*(1-exp(-50*t))/50))*exp(-14*t)+0.3*sin(2*PI*780*t)*exp(-25*t)", 0.4))
add("Dun dun dunnn", "Fun", "dramatic", notes([146.8, 0, 146.8, 0, 0, 138.6], 0.28, 0.9, 1.6, "sq", 0.35) + ",lowpass=f=1400,aecho=0.8:0.6:80|160:0.3|0.2")
add("Record scratch", "Fun", "scratch", f"{bands(0.6, [(0, 600), (0.15, 2400), (0.3, 500), (0.45, 2000), (0.6, 400)], 4, 'white', 26, 12)},volume='pow(sin(PI*t/0.6),0.5)*5':eval=frame")
add("Spring", "Fun", "cartoon", tone("0.6*sin(2*PI*(300+250*sin(2*PI*18*t))*t)*exp(-3.5*t)", 1.0))
add("Correct answer", "Fun", "quiz", bell([1046.5, 1568, 2093], 1.0, 3.0, 0.45))
add("Wrong answer", "Fun", "quiz", tone("0.45*sgn(sin(2*PI*120*t))+0.3*sgn(sin(2*PI*123*t))", 0.7) + ",lowpass=f=1800,afade=t=out:st=0.55:d=0.15")
add("Clown horn", "Fun", "cartoon", notes([392, 0, 392], 0.18, 0.16, 1.5, "sq", 0.35) + ",lowpass=f=2400,vibrato=f=7:d=0.15")
add("Deep boom", "Fun", "boom", f"{kick(38, 95, 1.4, 2.4)},aecho=0.8:0.5:70:0.2")

# ── Drums ──
add("Kick", "Drums", "drums", kick())
add("Snare", "Drums", "drums", f"{tone('0.5*sin(2*PI*190*t)*exp(-20*t)', 0.4)}[t];{noise(0.4, 'white', 0.8, 27)},highpass=f=1200,volume='exp(-14*t)':eval=frame[n];[t][n]amix=inputs=2:normalize=0")
add("Clap", "Drums", "drums", f"{noise(0.4, 'white', 0.9, 28)},bandpass=f=1300:t=q:w=0.9,volume='exp(-400*abs(t-0.005))+exp(-400*abs(t-0.018))+exp(-18*(t-0.03))*gte(t,0.03)':eval=frame")
add("Hi-hat", "Drums", "drums", f"{noise(0.15, 'white', 0.8, 29)},highpass=f=7000,volume='exp(-45*t)':eval=frame")
add("Drum roll", "Drums", "drums", f"{noise(2.2, 'white', 0.8, 30)},highpass=f=1500,volume='(0.4+0.6*t/2)*(0.5+0.5*sin(2*PI*28*t))':eval=frame,afade=t=out:st=2:d=0.2")
add("Cymbal crash", "Drums", "drums", f"{noise(2.5, 'white', 0.9, 31)},highpass=f=3500,volume='exp(-1.5*t)':eval=frame,aecho=0.8:0.5:30:0.3")
add("Heartbeat", "Drums", "heartbeat", f"{kick(40, 70, 14, 1.6)}[a];{kick(40, 70, 14, 1.6)},adelay=220|220[b];[a][b]amix=inputs=2:normalize=0,lowpass=f=300")
add("Clock ticking", "Drums", "clock", tone("+".join(f"0.7*sin(2*PI*{2200 if i % 2 else 1800}*(t-{i * 0.5}))*exp(-90*(t-{i * 0.5}))*gte(t,{i * 0.5})" for i in range(8)), 4.0))

# ── Crowd ──
add("Applause", "Crowd", "applause", f"{noise(4.0, 'white', 0.9, 32)},bandpass=f=1600:t=q:w=0.5,asetnsamples=n=480:p=0,volume='(0.55+0.45*random(0))*gt(random(1),0.55)':eval=frame,lowpass=f=6000,aecho=0.8:0.7:40|90:0.3|0.25,afade=t=in:d=0.4,afade=t=out:st=3.2:d=0.8")
add("Small applause", "Crowd", "applause", f"{noise(2.5, 'white', 0.9, 33)},bandpass=f=1400:t=q:w=0.6,asetnsamples=n=480:p=0,volume='gt(random(3),0.8)':eval=frame,aecho=0.7:0.6:30:0.25,afade=t=out:st=1.8:d=0.7")
add("Cheering crowd", "Crowd", "crowd", f"{noise(3.0, 'pink', 0.9, 34)},bandpass=f=900:t=q:w=0.7,tremolo=f=6:d=0.5,vibrato=f=4:d=0.3,afade=t=in:d=0.5,afade=t=out:st=2.3:d=0.7")

# ── Nature & ambience ──
add("Rain", "Ambience", "rain", f"{noise(8.0, 'pink', 0.7, 35)},highpass=f=600,lowpass=f=9000,afade=t=in:d=1,afade=t=out:st=7:d=1")
add("Wind", "Ambience", "wind", f"{noise(8.0, 'brown', 0.9, 36)},{sweep('lowpass@l', 'f', [(0, 300), (2, 900), (4, 400), (6, 1100), (8, 350)], 0.05)},lowpass@l=f=300,afade=t=in:d=1,afade=t=out:st=7:d=1")
add("Ocean waves", "Ambience", "ocean", f"{noise(10.0, 'pink', 0.8, 37)},lowpass=f=2500,volume='0.35+0.65*pow(sin(PI*t/5),2)':eval=frame,afade=t=in:d=1,afade=t=out:st=9:d=1")
add("Fire crackle", "Ambience", "fire", f"{noise(6.0, 'brown', 0.7, 38)},lowpass=f=800[b];{noise(6.0, 'white', 0.9, 39)},highpass=f=2000,volume='gt(random(4),0.985)':eval=frame[c];[b][c]amix=inputs=2:normalize=0,afade=t=in:d=0.5,afade=t=out:st=5.4:d=0.6")
add("Night crickets", "Ambience", "night", tone("0.25*sin(2*PI*4400*t)*gt(sin(2*PI*30*t),0.3)*gt(sin(2*PI*0.7*t),-0.2)+0.2*sin(2*PI*4700*t)*gt(sin(2*PI*27*t),0.4)*gt(sin(2*PI*0.5*t+1),0)", 8.0) + ",afade=t=in:d=1,afade=t=out:st=7:d=1")
add("Room tone", "Ambience", "room", f"{noise(8.0, 'brown', 0.4, 40)},lowpass=f=400,afade=t=in:d=1,afade=t=out:st=7:d=1")


def run(args, **kw):
    return subprocess.run([FF, "-hide_banner", "-nostats", *args], capture_output=True, text=True, **kw)


def slug(s):
    return re.sub(r"[^\w\- ]", "", s).strip()


rows, failed = [], []
for i, (title, group, tag, graph) in enumerate(S, start=1):
    folder = os.path.join(OUT, group)
    os.makedirs(folder, exist_ok=True)
    raw = os.path.join(folder, f".{slug(title)}.wav")
    out = os.path.join(folder, f"{slug(title)}.m4a")
    graph = re.sub(r"(?<!p=0,)volume='", "asetnsamples=n=64:p=0,volume='", graph)
    r = run(["-y", "-filter_complex", f"{graph},aformat=sample_rates=48000:channel_layouts=stereo[o]", "-map", "[o]", "-c:a", "pcm_s16le", raw])
    if r.returncode != 0:
        failed.append((title, r.stderr.strip().splitlines()[-1:]))
        continue
    # Loudness: −16 LUFS integrated, peaks ≤ −1 dBFS; sounds too short to measure go by their peak (−3 dBFS).
    m = run(["-i", raw, "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
    integ = re.findall(r"I:\s+(-?[\d.]+) LUFS", m)
    peak = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", m)
    lufs = float(integ[-1]) if integ else -70.0
    pk = float(peak[-1]) if peak else -20.0
    gain = min(-16 - lufs, -1 - pk) if lufs > -60 else -3 - pk
    r = run(["-y", "-i", raw, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:level=false", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out])
    os.remove(raw)
    if r.returncode != 0:
        failed.append((title, r.stderr.strip().splitlines()[-1:]))
        continue
    pcm = subprocess.run([FF, "-v", "error", "-i", out, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], capture_output=True).stdout
    import array
    a = array.array("f")
    a.frombytes(pcm[: len(pcm) // 4 * 4])
    n = len(a)
    dur = n / 8000
    win = max(1, n // 48)
    hs = [max((abs(x) for x in a[k * win:(k + 1) * win]), default=0) for k in range(48)]
    top = max(hs) or 1
    peaks = base64.b64encode(bytes(int(255 * h / top) for h in hs)).decode()
    data = open(out, "rb").read()
    rows.append({"id": f"pc{i:03d}", "title": title, "group": group, "tag": tag, "file": f"{group}/{slug(title)}.m4a", "dur": round(dur, 2),
                 "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "peaks": peaks, "artist": "Gaziyav", "license": LICENSE})
    print(f"ok  {group:14} {title:22} {dur:5.2f} s  {lufs:6.1f} LUFS → gain {gain:+.1f} dB")

json.dump(rows, open(os.path.join(OUT, "library.json"), "w"), ensure_ascii=False, indent=1)
print(f"{len(rows)} sounds, {len(failed)} failed")
for t, e in failed:
    print("FAILED", t, e)
