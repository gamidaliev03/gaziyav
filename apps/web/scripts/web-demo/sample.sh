#!/bin/zsh
# The demo's sample media: three abstract 4 s clips (1280×720, 30 fps, H.264 + silent AAC), a voice line in each language
# (the Mac's own voices) and a soft music bed (sines). Nothing downloaded, nothing of anyone's.
set -e
O="${1:-.}"
V=(-c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -profile:v high -movflags +faststart -r 30)
A=(-f lavfi -i anullsrc=r=48000:cl=stereo -c:a aac -b:a 32k -shortest)
ffmpeg -y -v error -f lavfi -i "gradients=s=1280x720:c0=0x1d2b64:c1=0xf8cdda:c2=0x7f53ac:c3=0x00d2ff:x0=0:y0=0:x1=1280:y1=720:speed=0.02:d=4:r=30" $A $V "$O/clip-1.mp4"
ffmpeg -y -v error -f lavfi -i "life=s=320x180:mold=8:r=30:ratio=0.12:life_color=0x7f53ac:death_color=0x0b1033:mold_color=0x00d2ff,scale=1280:720:flags=bicubic,gblur=sigma=6,eq=saturation=1.4,trim=duration=4" $A $V "$O/clip-2.mp4"
ffmpeg -y -v error -f lavfi -i "gradients=s=1280x720:c0=0xff512f:c1=0xdd2476:c2=0xf09819:c3=0x1a2a6c:n=4:type=radial:speed=0.03:d=4:r=30,vignette=PI/5" $A $V "$O/clip-3.mp4"
say -v Samantha -o /tmp/gzdemo-en.aiff "Hi! This is Gaziyav, running right in your browser. Cut me, trim me, add a title."
say -v Milena -o /tmp/gzdemo-ru.aiff "Привет! Это Газияв, прямо в вашем браузере. Режьте, подрезайте, добавьте титр."
ffmpeg -y -v error -i /tmp/gzdemo-en.aiff -ac 1 -ar 44100 -c:a aac -b:a 48k "$O/voice-en.m4a"
ffmpeg -y -v error -i /tmp/gzdemo-ru.aiff -ac 1 -ar 44100 -c:a aac -b:a 48k "$O/voice-ru.m4a"
rm -f /tmp/gzdemo-en.aiff /tmp/gzdemo-ru.aiff
# a slow two-chord pad with a soft pulse, faded in and out
ffmpeg -y -v error -f lavfi -i "aevalsrc='0.08*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*(0.6+0.4*sin(2*PI*2*t))*(lt(mod(t,4),2))+0.08*(sin(2*PI*196*t)+sin(2*PI*246.94*t)+sin(2*PI*293.66*t))*(0.6+0.4*sin(2*PI*2*t))*(gte(mod(t,4),2))|0.08*(sin(2*PI*220.5*t)+sin(2*PI*277.6*t)+sin(2*PI*330*t))*(0.6+0.4*sin(2*PI*2*t))*(lt(mod(t,4),2))+0.08*(sin(2*PI*196.4*t)+sin(2*PI*247.3*t)+sin(2*PI*294*t))*(0.6+0.4*sin(2*PI*2*t))*(gte(mod(t,4),2))':s=44100:d=12,afade=t=in:d=1.5,afade=t=out:st=10:d=2,lowpass=f=2500" -c:a aac -b:a 64k "$O/music.m4a"
