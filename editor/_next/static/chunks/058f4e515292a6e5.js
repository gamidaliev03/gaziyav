(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,96714,e=>{"use strict";function t(...e){return e}let a=t("video","image","graphic"),r=t("video","audio"),o=t("video","image","text","sticker","graphic");e.s(["MASKABLE_ELEMENT_TYPES",0,a,"RETIMABLE_ELEMENT_TYPES",0,r,"VISUAL_ELEMENT_TYPES",0,o])},31996,e=>{"use strict";e.s([])},61383,e=>{"use strict";function t(e){return"audio"===e.type||"video"===e.type}function a(e){return"audio"!==e.type}e.s(["canTrackBeHidden",()=>a,"canTrackHaveAudio",()=>t])},56038,e=>{"use strict";function t({tracks:e,trackId:t}){return e.main.id===t?e.main:e.overlay.find(e=>e.id===t)??e.audio.find(e=>e.id===t)??null}function a({tracks:e,trackId:t,update:a}){if(e.main.id===t)return{...e,main:a(e.main)};let r=e.overlay.findIndex(e=>e.id===t);if(r>=0)return{...e,overlay:e.overlay.map((e,t)=>t===r?a(e):e)};let o=e.audio.findIndex(e=>e.id===t);return o>=0?{...e,audio:e.audio.map((e,t)=>t===o?a(e):e)}:e}function r({track:e,elementId:t,update:a,elementPredicate:r}){let o=e.elements.map(e=>e.id!==t||r&&!r(e)?e:a(e));return{...e,elements:o}}function o({tracks:e,trackId:t,elementId:a,update:o,elementPredicate:c}){if(e.main.id===t)return{...e,main:r({track:e.main,elementId:a,update:o,elementPredicate:c})};let i=e.overlay.findIndex(e=>e.id===t);if(i>=0)return{...e,overlay:e.overlay.map((e,t)=>t===i?r({track:e,elementId:a,update:o,elementPredicate:c}):e)};let n=e.audio.findIndex(e=>e.id===t);return n>=0?{...e,audio:e.audio.map((e,t)=>t===n?r({track:e,elementId:a,update:o,elementPredicate:c}):e)}:e}e.s(["findTrackInSceneTracks",()=>t,"updateElementInSceneTracks",()=>o,"updateTrackInSceneTracks",()=>a])},67157,e=>e.a(async(t,a)=>{try{var r=e.i(5087),o=t([r]);[r]=o.then?(await o)():o;let c={"pro.fx.handheld":"studio.handheld","pro.fx.pushIn":"studio.kenBurns","pro.fx.tiltShift":"kadr.effect.tiltShift","pro.fx.neonEdges":"kadr.effect.neon","pro.fx.filmGrain":"studio.grain","pro.fx.oldFilm":"kadr.effect.oldFilm","pro.fx.halftone":"kadr.effect.halftone","pro.fx.posterize":"kadr.effect.posterize","pro.fx.thermal":"kadr.effect.thermal","pro.fx.nightVision":"kadr.effect.nightVision","pro.fx.comic":"kadr.effect.comic","kadr.effect.chromatic":"studio.rgbSplit","kadr.effect.strobe":"studio.flash","pro.fx.leakWarm":"studio.lightLeak","pro.fx.leakPink":"studio.lightLeak","pro.fx.leakBlue":"studio.lightLeak","pro.fx.flashIn":"studio.flash","pro.fx.strobe":"studio.flash","pro.fx.colorFlash":"studio.flash","pro.fx.duotonePink":"kadr.effect.duotone","pro.fx.duotoneTeal":"kadr.effect.duotone","pro.fx.neonEdgesCyan":"kadr.effect.neon","pro.fx.mirrorH":"kadr.effect.mirror","pro.fx.mirrorV":"kadr.effect.mirror","pro.fx.kaleido6":"kadr.effect.kaleidoscope","pro.fx.kaleido8":"kadr.effect.kaleidoscope","pro.fx.letterbox239":"kadr.effect.letterbox","pro.fx.letterbox185":"kadr.effect.letterbox","pro.fx.vignetteSoft":"studio.vignette","pro.fx.chromaticAberration":"studio.rgbSplit","pro.fx.radialBlur":"studio.zoomBlur","pro.fx.earthquake":"studio.shake","pro.fx.vibrate":"studio.shake","pro.fx.impact":"studio.shake","pro.fx.motionBlurV":"pro.fx.motionBlur","pro.fx.tiles2":"pro.fx.tiles","pro.fx.tiles3":"pro.fx.tiles"};class i extends r.DefinitionRegistry{constructor(){super("effect")}has(e){return super.has(e)||e in c&&super.has(c[e])}get(e){return!super.has(e)&&e in c?super.get(c[e]):super.get(e)}}let n=new i;e.s(["effectsRegistry",0,n]),a()}catch(e){a(e)}},!1),71110,e=>{"use strict";let t="gaussian-blur";function a({sigmaX:e,sigmaY:a}){let r=Math.max(e,a);if(r<.001)return[];let o=Math.min(8,Math.max(1,Math.ceil(r*r/1600))),c=e/Math.sqrt(o),i=a/Math.sqrt(o),n=Math.max(1,c/10),s=Math.max(1,i/10),l=[];for(let e=0;e<o;e++)l.push({shader:t,uniforms:{u_sigma:c,u_step:n,u_direction:[1,0]}}),l.push({shader:t,uniforms:{u_sigma:i,u_step:s,u_direction:[0,1]}});return l}function r({intensity:e,resolution:t,reference:a}){return e/5*(t/a)}function o(e){let t=e.intensity;return"number"==typeof t?t:Number.parseFloat(String(t))}e.s(["blurEffectDefinition",0,{type:"blur",name:"Blur",category:"Style",keywords:["blur","soft","defocus"],params:[{key:"intensity",label:"Intensity",type:"number",default:15,min:0,max:100,step:1}],renderer:{passes:[{shader:t,uniforms:({effectParams:e,width:t})=>({u_sigma:Math.max(r({intensity:o(e),resolution:t,reference:1920}),.001),u_step:1,u_direction:[1,0]})},{shader:t,uniforms:({effectParams:e,height:t})=>({u_sigma:Math.max(r({intensity:o(e),resolution:t,reference:1080}),.001),u_step:1,u_direction:[0,1]})}],buildPasses:({effectParams:e,width:t,height:c})=>{let i=o(e);return a({sigmaX:r({intensity:i,resolution:t,reference:1920}),sigmaY:r({intensity:i,resolution:c,reference:1080})})}}},"buildGaussianBlurPasses",()=>a,"intensityToSigma",()=>r])},68207,e=>{"use strict";function t(e,r=33){let o=new Float32Array(r*r*r*3),c=0;for(let t=0;t<r;t++)for(let i=0;i<r;i++)for(let n=0;n<r;n++){let s=e(n/(r-1),i/(r-1),t/(r-1));o[c++]=a(s[0]),o[c++]=a(s[1]),o[c++]=a(s[2])}return{size:r,data:o}}function a(e){return e<0?0:e>1?1:Number.isFinite(e)?e:0}function r(e){let r=0,o=0,c=[0,0,0],i=[1,1,1],n=[];for(let t of e.split(/\r?\n/)){let e=t.trim();if(!e||e.startsWith("#"))continue;let a=e.split(/\s+/),s=a[0].toUpperCase();"LUT_3D_SIZE"===s?r=Number.parseInt(a[1],10):"LUT_1D_SIZE"===s?o=Number.parseInt(a[1],10):"DOMAIN_MIN"===s?c=a.slice(1,4).map(Number):"DOMAIN_MAX"===s?i=a.slice(1,4).map(Number):/^[-+0-9.]/.test(a[0])&&a.length>=3&&n.push(Number(a[0]),Number(a[1]),Number(a[2]))}let s=[0,1,2].map(e=>Number.isFinite(c[e])?c[e]:0),l=[0,1,2].map(e=>{let t=Number.isFinite(i[e])?i[e]:1;return t>s[e]?t:s[e]+1}),f=s.every(e=>0===e)&&l.every(e=>1===e),m=(e,t)=>a((e-s[t])/(l[t]-s[t]));if(r>=2&&r<=128){if(n.length<r*r*r*3)throw Error("The .cube file is incomplete (fewer values than LUT_3D_SIZE³).");let e={size:r,data:Float32Array.from(n.slice(0,r**3*3))};return 33===r&&f?e:t((t,r,o)=>(function(e,t,r,o){let c=e.size-1,i=a(t)*c,n=a(r)*c,s=a(o)*c,l=Math.floor(i),f=Math.floor(n),m=Math.floor(s),u=Math.min(l+1,c),d=Math.min(f+1,c),v=Math.min(m+1,c),h=i-l,p=n-f,g=s-m,y=e.size,b=(t,a,r,o)=>e.data[((r*y+a)*y+t)*3+o],x=[0,0,0];for(let e=0;e<3;e++){let t=b(l,f,m,e)*(1-h)+b(u,f,m,e)*h,a=b(l,d,m,e)*(1-h)+b(u,d,m,e)*h,r=b(l,f,v,e)*(1-h)+b(u,f,v,e)*h,o=b(l,d,v,e)*(1-h)+b(u,d,v,e)*h;x[e]=(t*(1-p)+a*p)*(1-g)+(r*(1-p)+o*p)*g}return x})(e,m(t,0),m(r,1),m(o,2)))}if(o>=2){if(n.length<3*o)throw Error("The .cube file is incomplete (1D LUT).");let e=(e,t)=>{let r=a(e)*(o-1),c=Math.floor(r),i=Math.min(c+1,o-1),s=r-c;return n[3*c+t]*(1-s)+n[3*i+t]*s};return t((t,a,r)=>[e(m(t,0),0),e(m(a,1),1),e(m(r,2),2)])}throw Error("Not a .cube LUT: LUT_3D_SIZE is missing.")}function o(e){let t=e.size,a=new Uint8ClampedArray(t*t*t*4);for(let r=0;r<t;r++)for(let o=0;o<t;o++)for(let c=0;c<t;c++){let i=((r*t+o)*t+c)*3,n=(o*t*t+r*t+c)*4;a[n]=Math.round(255*e.data[i]),a[n+1]=Math.round(255*e.data[i+1]),a[n+2]=Math.round(255*e.data[i+2]),a[n+3]=255}return a}function c(e){let t=new Uint8Array(e.data.length);for(let a=0;a<t.length;a++)t[a]=Math.round(255*e.data[a]);let a="";for(let e=0;e<t.length;e+=32768)a+=String.fromCharCode(...t.subarray(e,e+32768));return btoa(a)}function i(e){try{let t=atob(e),a=Math.round(Math.cbrt(t.length/3));if(a<2||a**3*3!==t.length)return null;let r=new Float32Array(t.length);for(let e=0;e<t.length;e++)r[e]=t.charCodeAt(e)/255;return{size:a,data:r}}catch{return null}}e.s(["LUT_SIZE",0,33,"buildCube",()=>t,"clamp01",()=>a,"cubeToStrip",()=>o,"decodeCube",()=>i,"encodeCube",()=>c,"parseCube",()=>r])},63144,e=>{"use strict";let t=new Set,a=0;function r(e){return t.add(e),()=>t.delete(e)}function o(){let e=0;for(let a of t)try{a(),e++}catch{}return a++,e}let c=new Set;function i(e){return c.add(e),()=>c.delete(e)}function n(e){for(let t of c)try{t(e)}catch{}("warning"===e||"critical"===e)&&o()}{let e=window.studioApp;e?.onMemoryPressure?.(n);let r=window;r.__studioMemory={...r.__studioMemory??{},relieve:o,signal:n,caches:()=>t.size,relieved:()=>a}}e.s(["onMemoryPressure",()=>r,"onPressureLevel",()=>i])},24978,e=>{"use strict";var t=e.i(68207);let a=e=>e<0?0:e>1?1:e,r=(e,t,a)=>e+(t-e)*a;function o([e,t,a]){let r=Math.max(e,t,a),o=r-Math.min(e,t,a),c=0;return o>1e-6&&(c=(r===e?(t-a)/o%6:r===t?(a-e)/o+2:(e-t)/o+4)*60)<0&&(c+=360),[c,r<=0?0:o/r,r]}let c=(e,t,a)=>{let r,o=((r=Math.abs(e-t)%360)>180?360-r:r)/Math.max(a,1);return o>=1?0:.5+.5*Math.cos(Math.PI*o)};function i(e,t,a){if(0===t)return e;let o=1+6*Math.abs(t),c=1/(1+Math.exp(-o*(0-a))),i=1/(1+Math.exp(-o*(1-a))),n=(1/(1+Math.exp(-o*(e-a)))-c)/(i-c);return t>0?r(e,n,t):r(e,a+(e-a)*(1+.6*t),1)}function n(e,t){if(e<=t)return e;let a=1-t,r=(e-t)/a,o=(1.3-t)/a;return r>=o?1:t+a*(1-Math.exp(-1.4*r))/(1-Math.exp(-1.4*o))}function s(e,t,r,o){let c=o.pivot??.45,s=o.contrast??0,l=i(a(e),s,c)+Math.max(0,e-1),f=i(a(t),s,c)+Math.max(0,t-1),m=i(a(r),s,c)+Math.max(0,r-1),u=o.crush??0;u>0&&(l=Math.max(0,(l-u)/(1-u)),f=Math.max(0,(f-u)/(1-u)),m=Math.max(0,(m-u)/(1-u)));let d=o.fade??0;d>0&&(l=d+l*(1-.6*d),f=d+f*(1-.6*d),m=d+m*(1-.6*d));let v=o.knee??.78,h=.2126*l+.7152*f+.0722*m;if(h>1e-4){let e=n(h,v)/h;l*=e,f*=e,m*=e}let p=Math.max(l,f,m);if(p>1){let e=.2126*l+.7152*f+.0722*m,t=e>=1?1:(p-1)/(p-e);l+=(e-l)*t,f+=(e-f)*t,m+=(e-m)*t}let g=v+(1-v)*.5;return[n(l,g),n(f,g),n(m,g)]}let l=[{id:"g.blockbuster",name:"Blockbuster",category:"Movies",theme:"action",contrast:.45,temp:.1,sat:1.05,shadows:[-.05,.03,.08],highs:[.07,.02,-.06],skin:.75},{id:"g.tealOrangePro",name:"Teal & Orange Pro",category:"Movies",theme:"city",contrast:.35,sat:1.1,hue:[[200,60,-10],[35,30,-5]],shadows:[-.06,.04,.09],highs:[.09,.03,-.07],skin:.8},{id:"g.noir",name:"Noir",category:"Movies",theme:"city-night",mono:[.35,.55,.1],contrast:.7,crush:.05,knee:.85},{id:"g.fincher",name:"Green Thriller",category:"Movies",theme:"city",contrast:.3,sat:.75,temp:-.1,tint:-.35,shadows:[-.02,.05,.02],highs:[.04,.05,-.03],fade:.03},{id:"g.pastelFrame",name:"Pastel Symmetry",category:"Movies",theme:"travel",contrast:-.2,fade:.08,sat:.9,temp:.15,mids:[.04,0,.03],hue:[[120,50,-15]],satAt:[[30,40,1.15],[200,50,.8]]},{id:"g.neonSciFi",name:"Neon Sci-Fi",category:"Movies",theme:"city-night",contrast:.4,sat:1.25,temp:-.3,tint:.3,shadows:[.02,-.02,.1],highs:[.08,-.02,.06],hue:[[30,40,-20]]},{id:"g.bleachBypass",name:"Bleach Bypass",category:"Movies",theme:"action",bleach:.8,contrast:.25,sat:.85},{id:"g.dayForNight",name:"Day for Night",category:"Movies",theme:"nature",night:.9,contrast:.2,crush:.02},{id:"g.desertEpic",name:"Desert Epic",category:"Movies",theme:"travel",contrast:.35,temp:.45,sat:.95,highs:[.06,.03,-.05],shadows:[.02,0,-.02],hue:[[200,50,15]]},{id:"g.matrix",name:"Code Green",category:"Movies",theme:"tech",contrast:.4,sat:.7,tint:-.7,shadows:[-.03,.04,-.01],highs:[-.02,.06,0],skin:.4},{id:"g.westernDust",name:"Western Dust",category:"Movies",theme:"travel",contrast:.3,temp:.55,sat:.7,fade:.05,highs:[.07,.03,-.04]},{id:"g.coldWar",name:"Cold Steel",category:"Movies",theme:"city",contrast:.35,temp:-.45,sat:.6,shadows:[-.03,0,.05],skin:.7},{id:"g.romance",name:"Romance",category:"Movies",theme:"wedding",contrast:.1,temp:.25,tint:.15,sat:.95,fade:.04,highs:[.05,.02,.01]},{id:"g.horror",name:"Dread",category:"Movies",theme:"city-night",contrast:.5,sat:.5,temp:-.2,tint:-.2,crush:.04,shadows:[-.02,.02,.03]},{id:"g.superhero",name:"Hero",category:"Movies",theme:"sports",contrast:.5,sat:1.25,vib:.3,highs:[.04,.02,-.03],skin:.8},{id:"g.indie",name:"Indie",category:"Movies",theme:"portrait",contrast:-.1,fade:.06,sat:.85,temp:.1,mids:[.02,.01,-.01]},{id:"g.landscapeCool",name:"Cool Landscape 100",category:"Film",theme:"nature",contrast:.3,temp:-.15,sat:1.1,satAt:[[120,50,1.15],[210,50,1.2]],hue:[[90,40,10]]},{id:"g.slide64",name:"Slide 64",category:"Film",theme:"travel",contrast:.45,sat:1.25,crush:.03,satAt:[[0,30,1.2],[210,50,1.15]],highs:[.02,.01,-.02]},{id:"g.tungsten800",name:"Tungsten 800 Night",category:"Film",theme:"city-night",contrast:.3,temp:-.35,sat:1.1,highs:[.1,0,-.04],shadows:[-.02,.02,.06],hue:[[0,30,8]]},{id:"g.crossProcess",name:"Cross Process",category:"Film",theme:"fashion",cross:.85,sat:1.1},{id:"g.expired",name:"Expired Film",category:"Film",theme:"travel",contrast:-.1,fade:.1,temp:.2,tint:.2,sat:.8,shadows:[.03,0,.05],highs:[.05,.04,-.04]},{id:"g.instant",name:"Instant Print",category:"Film",theme:"kids",contrast:-.15,fade:.09,temp:.15,sat:.85,mids:[.02,.03,0],highs:[.04,.04,0]},{id:"g.superEight",name:"Super 8",category:"Film",theme:"travel",contrast:.2,temp:.35,sat:.9,fade:.07,highs:[.06,.03,-.03],knee:.7},{id:"g.cineNeg",name:"Cine Negative",category:"Film",theme:"portrait",contrast:-.05,fade:.05,sat:.9,shadows:[-.02,.02,.04],highs:[.04,.02,-.01],skin:.85},{id:"g.goldenStock",name:"Gold 200",category:"Film",theme:"travel",contrast:.25,temp:.4,sat:1.05,highs:[.07,.04,-.03],satAt:[[50,30,1.2]]},{id:"g.chrome",name:"Chrome",category:"Film",theme:"cars",contrast:.4,sat:.9,temp:-.1,highs:[.02,.02,.04],satAt:[[0,40,1.15],[210,40,1.15]]},{id:"g.seventies",name:"70s",category:"Retro",theme:"music",contrast:.05,fade:.08,temp:.4,sat:.85,tint:.1,shadows:[.04,.02,-.02],highs:[.06,.04,-.05],hue:[[120,60,-20]]},{id:"g.eighties",name:"80s",category:"Retro",theme:"music",contrast:.3,sat:1.2,tint:.3,shadows:[.03,-.02,.08],highs:[.07,0,.05]},{id:"g.camcorder",name:"90s Camcorder",category:"Retro",theme:"kids",contrast:.15,sat:1.1,temp:-.05,tint:-.1,fade:.05,knee:.68,mids:[0,.02,.02]},{id:"g.y2k",name:"Y2K",category:"Retro",theme:"fashion",contrast:.2,sat:1.15,temp:-.2,tint:.25,highs:[.03,.03,.08],fade:.03},{id:"g.sixties",name:"60s Print",category:"Retro",theme:"fashion",contrast:.1,fade:.07,sat:.95,temp:.2,shadows:[0,.03,.04],satAt:[[0,30,1.2]]},{id:"g.vhsColor",name:"VHS Colour",category:"Retro",theme:"kids",contrast:.1,sat:1.2,fade:.06,knee:.66,tint:.15,shadows:[0,0,.05]},{id:"g.oldPhoto",name:"Old Photo",category:"Retro",theme:"portrait",mono:[.3,.59,.11],contrast:.1,fade:.1,shadows:[.06,.02,-.03],highs:[.1,.06,-.02]},{id:"g.technicolor",name:"Three-Strip",category:"Retro",theme:"fashion",contrast:.3,sat:1.35,satAt:[[0,30,1.25],[120,40,1.2],[220,40,1.2]]},{id:"g.moody",name:"Moody",category:"Mood",theme:"nature",contrast:.35,exposure:-.25,sat:.75,temp:-.1,crush:.02,shadows:[-.02,.01,.03],highs:[.03,.02,0],skin:.7},{id:"g.darkForest",name:"Dark Forest",category:"Mood",theme:"nature",contrast:.3,exposure:-.3,sat:.8,hue:[[100,50,25]],satAt:[[100,60,.7]],shadows:[-.02,.03,.02]},{id:"g.brightAiry",name:"Bright & Airy",category:"Life",theme:"wedding",exposure:.3,contrast:-.2,fade:.04,sat:.9,temp:.08,highs:[.02,.02,.02],knee:.72,skin:.9},{id:"g.dreamy",name:"Dreamy",category:"Mood",theme:"wedding",exposure:.15,contrast:-.25,fade:.08,sat:.85,tint:.15,highs:[.05,.03,.04]},{id:"g.melancholy",name:"Melancholy",category:"Mood",theme:"city",contrast:.1,sat:.55,temp:-.25,fade:.05,shadows:[-.01,.01,.04]},{id:"g.warmGlow",name:"Warm Glow",category:"Mood",theme:"portrait",contrast:.1,temp:.4,sat:1,highs:[.06,.03,-.02],knee:.7,skin:.85},{id:"g.coldMorning",name:"Cold Morning",category:"Mood",theme:"nature",contrast:.15,temp:-.4,sat:.85,fade:.04,highs:[0,.02,.05]},{id:"g.goldenHour",name:"Golden Hour",category:"Mood",theme:"nature",contrast:.2,temp:.55,sat:1.1,highs:[.08,.04,-.03],shadows:[.02,0,-.02],skin:.8},{id:"g.blueHour",name:"Blue Hour",category:"Mood",theme:"city-night",contrast:.25,temp:-.5,sat:1.05,shadows:[-.02,0,.06],highs:[.04,.02,0]},{id:"g.stormy",name:"Stormy",category:"Mood",theme:"nature",contrast:.45,exposure:-.2,sat:.6,temp:-.2,crush:.03},{id:"g.faded",name:"Faded",category:"Mood",theme:"fashion",contrast:-.15,fade:.12,sat:.8},{id:"g.muted",name:"Muted",category:"Mood",theme:"business",contrast:.05,sat:.65,fade:.04},{id:"g.lavender",name:"Lavender",category:"Mood",theme:"beauty",contrast:-.05,tint:.35,temp:-.05,fade:.05,sat:.9,highs:[.03,0,.05]},{id:"g.mint",name:"Mint",category:"Mood",theme:"beauty",contrast:-.05,tint:-.3,temp:-.1,fade:.05,sat:.9,highs:[0,.04,.03]},{id:"g.peach",name:"Peach",category:"Mood",theme:"beauty",contrast:-.1,temp:.25,tint:.15,fade:.05,sat:.95,highs:[.05,.03,.01]},{id:"g.cyberpunk",name:"Cyberpunk",category:"Mood",theme:"gaming",contrast:.45,sat:1.35,tint:.45,temp:-.25,shadows:[.03,-.03,.1],highs:[.1,-.02,.04],hue:[[60,40,-30]]},{id:"g.vaporwave",name:"Vaporwave",category:"Mood",theme:"music",contrast:.1,fade:.05,sat:1.2,tint:.5,temp:-.15,shadows:[.02,-.02,.08],highs:[.06,0,.06]},{id:"g.underwater",name:"Underwater",category:"Mood",theme:"travel",contrast:.1,temp:-.6,tint:-.2,sat:.95,shadows:[-.04,.03,.06]},{id:"g.weddingSoft",name:"Wedding Soft",category:"Life",theme:"wedding",exposure:.2,contrast:-.15,fade:.05,temp:.12,sat:.92,knee:.7,skin:.95},{id:"g.weddingFilm",name:"Wedding Film",category:"Life",theme:"wedding",contrast:.05,fade:.06,temp:.18,sat:.9,highs:[.04,.03,0],satAt:[[120,50,.8]],skin:.9},{id:"g.lifestyle",name:"Lifestyle",category:"Life",theme:"fashion",exposure:.1,contrast:.1,sat:1.05,vib:.2,temp:.08,skin:.85},{id:"g.cleanSkin",name:"Clean Skin",category:"Life",theme:"beauty",exposure:.1,contrast:.05,sat:1,satAt:[[25,25,.85]],skin:1},{id:"g.vlog",name:"Vlog",category:"Life",theme:"travel",contrast:.2,sat:1.12,vib:.25,temp:.05},{id:"g.minimal",name:"Minimal",category:"Life",theme:"business",exposure:.15,contrast:0,sat:.8,fade:.03},{id:"g.office",name:"Office",category:"Life",theme:"business",contrast:.15,temp:-.1,sat:.9,highs:[0,.01,.03]},{id:"g.realEstate",name:"Bright Interior",category:"Life",theme:"real-estate",exposure:.35,contrast:.1,temp:.05,sat:1.05,knee:.7,vib:.2},{id:"g.fitness",name:"Fitness",category:"Life",theme:"fitness",contrast:.45,sat:.9,temp:-.05,crush:.02,skin:.6},{id:"g.foodWarm",name:"Food Warm",category:"Food",theme:"food",contrast:.25,temp:.3,sat:1.15,vib:.3,satAt:[[10,30,1.15],[40,30,1.15]],skin:.3},{id:"g.foodFresh",name:"Food Fresh",category:"Food",theme:"food",exposure:.1,contrast:.2,sat:1.15,satAt:[[100,50,1.25],[0,25,1.1]],temp:.05},{id:"g.bakery",name:"Bakery",category:"Food",theme:"food",contrast:.15,temp:.4,sat:1.05,highs:[.05,.03,-.02],fade:.03},{id:"g.coffee",name:"Coffee",category:"Food",theme:"food",contrast:.3,temp:.3,sat:.85,exposure:-.1,shadows:[.03,.01,-.02]},{id:"g.dessert",name:"Dessert",category:"Food",theme:"food",exposure:.15,contrast:.05,tint:.15,sat:1.1,fade:.03},{id:"g.darkFood",name:"Dark Food",category:"Food",theme:"food",contrast:.45,exposure:-.25,sat:1.05,crush:.03,temp:.15},{id:"g.product",name:"Product Pop",category:"Food",theme:"tech",contrast:.3,sat:1.2,vib:.35,knee:.75},{id:"g.tropical",name:"Tropical",category:"Travel",theme:"travel",contrast:.25,temp:.1,sat:1.25,hue:[[200,40,-12]],satAt:[[180,50,1.35]]},{id:"g.mountain",name:"Mountain Air",category:"Travel",theme:"nature",contrast:.3,temp:-.15,sat:1.05,satAt:[[210,50,1.2]],highs:[0,.01,.03]},{id:"g.city",name:"City Day",category:"Travel",theme:"city",contrast:.3,sat:1,temp:-.05,shadows:[-.02,0,.03],highs:[.03,.02,0]},{id:"g.autumn",name:"Autumn",category:"Travel",theme:"nature",contrast:.2,temp:.3,sat:1.1,hue:[[90,50,-30]],satAt:[[30,40,1.3]]},{id:"g.winter",name:"Winter",category:"Travel",theme:"nature",exposure:.15,contrast:.15,temp:-.35,sat:.8,highs:[0,.02,.05]},{id:"g.safari",name:"Safari",category:"Travel",theme:"travel",contrast:.25,temp:.45,sat:.95,satAt:[[100,50,.8]],highs:[.05,.03,-.03]},{id:"g.seaside",name:"Seaside",category:"Travel",theme:"travel",exposure:.15,contrast:.1,temp:-.05,sat:1.1,satAt:[[195,40,1.3]],fade:.02},{id:"g.neonNight",name:"Neon Night",category:"Night",theme:"city-night",contrast:.35,sat:1.3,temp:-.2,tint:.25,shadows:[0,0,.06],highs:[.06,0,.05]},{id:"g.streetLights",name:"Street Lights",category:"Night",theme:"city-night",contrast:.3,temp:.2,sat:1.1,shadows:[-.02,.01,.05],highs:[.08,.04,-.02]},{id:"g.midnight",name:"Midnight",category:"Night",theme:"city-night",exposure:-.2,contrast:.35,temp:-.45,sat:.9,crush:.02},{id:"g.concert",name:"Concert",category:"Night",theme:"music",contrast:.45,sat:1.35,tint:.2,crush:.03,highs:[.05,0,.04]},{id:"g.party",name:"Party",category:"Night",theme:"music",contrast:.35,sat:1.3,tint:.35,temp:.1,highs:[.06,0,.05]},{id:"g.gamer",name:"Gamer RGB",category:"Night",theme:"gaming",contrast:.4,sat:1.4,tint:.3,temp:-.3,shadows:[.02,0,.08]},{id:"g.sportsNight",name:"Stadium",category:"Night",theme:"sports",contrast:.4,sat:1.15,temp:-.1,highs:[.02,.03,.04],crush:.02},{id:"g.bwSoft",name:"B&W Soft",category:"Mono",theme:"portrait",mono:[.3,.59,.11],contrast:-.1,fade:.05},{id:"g.bwHigh",name:"B&W High Contrast",category:"Mono",theme:"sports",mono:[.35,.55,.1],contrast:.8,crush:.04},{id:"g.bwRedFilter",name:"B&W Red Filter",category:"Mono",theme:"nature",mono:[.75,.25,0],contrast:.4},{id:"g.sepia",name:"Sepia",category:"Mono",theme:"portrait",mono:[.3,.59,.11],contrast:.1,shadows:[.05,.02,-.04],highs:[.08,.05,-.02],fade:.04},{id:"g.selenium",name:"Selenium",category:"Mono",theme:"city",mono:[.3,.6,.1],contrast:.3,shadows:[.02,-.01,.04],highs:[.02,.01,0]},{id:"g.cyanotype",name:"Cyanotype",category:"Mono",theme:"nature",mono:[.25,.55,.2],contrast:.2,shadows:[-.06,0,.08],highs:[-.02,.02,.06]},{id:"g.silverScreen",name:"Silver Screen",category:"Mono",theme:"fashion",mono:[.3,.6,.1],contrast:.45,knee:.85,fade:.02},{id:"g.duotoneNeon",name:"Duotone Neon",category:"Mono",theme:"gaming",mono:[.3,.6,.1],contrast:.4,shadows:[.1,-.05,.25],highs:[.05,.25,.2]},{id:"g.duotoneSunset",name:"Duotone Sunset",category:"Mono",theme:"music",mono:[.3,.6,.1],contrast:.35,shadows:[.2,-.02,.12],highs:[.15,.08,-.08]}].map(({id:e,name:t,category:n,theme:l,...f})=>({id:e,name:t,category:n,theme:l,fn:e=>(function(e,t){let n=2**(t.exposure??0),l=e[0]*n,f=e[1]*n,m=e[2]*n,u=t.temp??0,d=t.tint??0;if(l=l*(1+.09*u)*(1+.03*d),f*=1-.06*d,m=m*(1-.11*u)*(1+.03*d),t.gamma&&(l=a(l)**t.gamma[0],f=a(f)**t.gamma[1],m=a(m)**t.gamma[2]),t.hue?.length||t.satAt?.length){let[e,i,n]=o([a(l),a(f),a(m)]);for(let[a,r,o]of t.hue??[])e=(e+o*c(e,a,r)+360)%360;for(let[o,n,s]of t.satAt??[])i=a(i*r(1,s,c(e,o,n)));[l,f,m]=function([e,t,a]){let r=a*t,o=r*(1-Math.abs(e/60%2-1)),c=a-r,i=Math.floor(e/60)%6,[n,s,l]=0===i?[r,o,0]:1===i?[o,r,0]:2===i?[0,r,o]:3===i?[0,o,r]:4===i?[o,0,r]:[r,0,o];return[n+c,s+c,l+c]}([e,i,n])}let v=.2126*l+.7152*f+.0722*m,h=t.sat??1,p=a(l),g=a(f),y=a(m),b=Math.max(p,g,y),x=b<=0?0:(b-Math.min(p,g,y))/b,k=1+(t.vib??0)*(1-x);if(l=v+(l-v)*h*k,f=v+(f-v)*h*k,m=v+(m-v)*h*k,t.mono){let e=t.mono,r=a((l*e[0]+f*e[1]+m*e[2])/(e[0]+e[1]+e[2]));l=r,f=r,m=r}if(t.bleach){let e=.2126*l+.7152*f+.0722*m,a=t=>e<.5?2*t*e:1-2*(1-t)*(1-e),o=a(l),c=a(f),i=a(m);l=r(l,r(e,o,.55),t.bleach),f=r(f,r(e,c,.55),t.bleach),m=r(m,r(e,i,.55),t.bleach)}if(t.cross){let e=t.cross,o=(e,t)=>i(a(e),t,.5),c=r(l,o(l,.6),e),n=r(f,1.03*o(f,.35),e),s=r(m,.12+.7*o(m,-.6),e);l=c,f=n,m=s}if(t.night){let e=t.night,a=.2126*l+.7152*f+.0722*m,o=.45*a+.1*l,c=.6*a+.12*f,i=.9*a+.25*m;l=r(l,.62*o,e),f=r(f,.62*c,e),m=r(m,.62*i,e)}if(t.shadows||t.mids||t.highs){let e=a(.2126*l+.7152*f+.0722*m),r=(1-e)**2,o=e**2,c=Math.max(0,1-r-o),i=t.shadows??[0,0,0],n=t.mids??[0,0,0],s=t.highs??[0,0,0];l=l+i[0]*r+n[0]*c+s[0]*o,f=f+i[1]*r+n[1]*c+s[1]*o,m=m+i[2]*r+n[2]*c+s[2]*o}let P=s(l,f,m,t),w=(t.skin??.6)*function(e){let[t,r,i]=o(e);return c(t,25,25)*a((r-.08)/.12)*a((.75-r)/.2)*a((i-.18)/.15)}([a(e[0]),a(e[1]),a(e[2])]);if(w>0&&!t.mono){let a=s(e[0]*n,e[1]*n,e[2]*n,t);P[0]=r(P[0],a[0],.7*w),P[1]=r(P[1],a[1],.7*w),P[2]=r(P[2],a[2],.7*w)}return P[0]=a(P[0]),P[1]=a(P[1]),P[2]=a(P[2]),P})(e,f)}));var f=e.i(63144);let m=e=>.2126*e[0]+.7152*e[1]+.0722*e[2],u=(e,t)=>{let a=m(e);return[a+(e[0]-a)*t,a+(e[1]-a)*t,a+(e[2]-a)*t]},d=(e,a)=>{let r=(0,t.clamp01)(e);return r+(r*r*(3-2*r)-r)*a},v=(e,t)=>[d(e[0],t),d(e[1],t),d(e[2],t)],h=(e,t,a=1)=>e.map(e=>t+e*(a-t)),p=(e,t)=>[e[0]*t[0],e[1]*t[1],e[2]*t[2]],g=(e,t,a,r)=>{let o=m(e),c=Math.max(0,1-2*o),i=Math.max(0,2*o-1);return[e[0]+(t[0]*c+a[0]*i)*r,e[1]+(t[1]*c+a[1]*i)*r,e[2]+(t[2]*c+a[2]*i)*r]},y=[{id:"warmPhone",name:"Warm Phone",fn:e=>u(h(p(v(e,.15),[1.05,1,.92]),.02),1.08)},{id:"clean",name:"Clean",fn:e=>u(v(e,.25),1.06)},{id:"softContrast",name:"Soft Contrast",fn:e=>u(h(v(e,.35),.04,.97),.95)},{id:"coolTech",name:"Cool Tech",fn:e=>g(u(v(p(e,[.94,1,1.08]),.3),.9),[-.05,.02,.08],[0,.02,.04],1)},{id:"film90s",name:"90s Film",fn:e=>u(h(g(p(v(e,.2),[1.06,1.02,.9]),[0,.04,.02],[.05,.02,-.03],1),.06,.95),.85)},{id:"juicy",name:"Juicy Product",fn:e=>{let t,a=m(e),r=Math.max(e[0],e[1],e[2])-Math.min(e[0],e[1],e[2]),o=e[0]>e[1]&&e[1]>e[2]?.5:1,c=u(e,1+.45*(1-r)*o);return v([(t=[a,a,a])[0]+(c[0]-t[0])*1,t[1]+(c[1]-t[1])*1,t[2]+(c[2]-t[2])*1],.2)}},{id:"bwContrast",name:"B&W Contrast",fn:e=>{let t=d(.3*e[0]+.59*e[1]+.11*e[2],.6);return[t,t,t]}},{id:"night",name:"Night",fn:e=>u(p(v(e,.2),[.78,.88,1.12]).map(e=>.85*e),.7)},{id:"pastel",name:"Pastel",fn:e=>u(h(p(e,[1.02,1,1.04]),.08,.98),.8)},{id:"tealOrange",name:"Teal & Orange",fn:e=>g(v(e,.25),[-.06,.03,.07],[.08,.02,-.07],1)},...l],b=new Map,x=new Map;(0,f.onMemoryPressure)(()=>{b.clear(),x.clear()});let k=new Map;function P(e){let a=`lut:custom:${function(e){let t=0x811c9dc5,a=Math.max(1,Math.floor(e.length/4096));for(let r=0;r<e.length;r+=a)t^=e.charCodeAt(r),t=Math.imul(t,0x1000193);return`${(t>>>0).toString(36)}${e.length.toString(36)}`}(e)}`;if(!k.has(a)){let r=(0,t.decodeCube)(e);if(!r)return null;k.set(a,r)}return a}function w(e){return`lut:look:${e}`}function S(e){let a=e.startsWith("lut:look:")?function(e){let a=b.get(e);if(a)return a;let r=y.find(t=>t.id===e);if(!r)return null;let o=(0,t.buildCube)((e,t,a)=>r.fn([e,t,a]));return b.set(e,o),o}(e.slice(9)):e.startsWith("lut:custom:")?k.get(e)??null:null;if(!a)return null;let r=x.get(e);return r||(r=(0,t.cubeToStrip)(a),x.set(e,r)),{width:a.size*a.size,height:a.size,pixels:r}}e.s(["LOOKS",0,y,"customLutTextureId",()=>P,"getLutStrip",()=>S,"lookTextureId",()=>w],24978)},1364,e=>{"use strict";let t=new Map;function a({id:e,wgsl:a}){t.get(e)!==a&&t.set(e,a)}function r(e){return t.get(e)}e.s(["defineShaderSource",()=>a,"getShaderSource",()=>r])},66290,19549,e=>{"use strict";var t=e.i(24978),a=e.i(68207),r=e.i(1364);let o={time:0,duration:0,progress:0,frame:0};function c(e,t,a=0){let r=e[t],o="number"==typeof r?r:Number.parseFloat(String(r));return Number.isFinite(o)?o:a}function i(e,t){let a=e[t];return+(!0===a||"true"===a)}function n(e,t,a){let r=e[t];if("string"!=typeof r)return a;let o=/^#?([0-9a-f]{6})/i.exec(r.trim());if(!o)return a;let c=Number.parseInt(o[1],16);return[(c>>16&255)/255,(c>>8&255)/255,(255&c)/255]}function s({type:e,name:t,keywords:a,category:c,params:i,shader:n,wgsl:s,pack:l,hidden:f,textures:m,thumbnailParams:u}){let d=n??e;return(0,r.defineShaderSource)({id:d,wgsl:s}),{type:e,name:t,keywords:a,category:c,params:i,hidden:f,thumbnailParams:u,shaders:[{id:d,wgsl:s}],renderer:{passes:[],buildPasses:e=>{let t={...e,t:e.time??o,p:e.effectParams},a={shader:d,uniforms:{u_time:t.t.time,u_progress:t.t.progress,u_frame:t.t.frame,u_params:l(t).slice(0,32)}},r=m?.(t);return r&&r.length>0&&(a.textures=r),[a]}}}}function l(e,t,a,r,o,c,i={}){return{key:e,label:t,type:"number",default:a,min:r,max:o,step:c,keyframable:!0,...i}}e.s(["bool",()=>i,"defineShaderEffect",()=>s,"num",()=>c,"numberParam",()=>l,"rgb",()=>n],19549);let f="studio.color",m=[{id:f,wgsl:`
fn effect(uv: vec2f) -> vec4f {
    let src_c = src(uv);
    var c = src_c.rgb;
    let exposure = P0().x;
    let contrast = P0().y;
    let saturation = P0().z;
    let vibrance = P0().w;
    let temperature = P1().x;
    let tint = P1().y;
    let highlights = P1().z;
    let shadows = P1().w;
    let whites = P2().x;
    let blacks = P2().y;
    // exposure + white balance in linear light
    var lin = pow(max(c, vec3f(0.0)), vec3f(2.2));
    lin = lin * exp2(exposure);
    lin = lin * vec3f(1.0 + temperature * 0.3, 1.0 - tint * 0.25, 1.0 - temperature * 0.3);
    c = pow(max(lin, vec3f(0.0)), vec3f(1.0 / 2.2));
    // highlights / shadows, then whites / blacks (the far ends only)
    let y0 = luma(clamp(c, vec3f(0.0), vec3f(1.0)));
    c = c + vec3f(shadows * 0.35 * (1.0 - y0) * (1.0 - y0));
    c = c + vec3f(highlights * 0.35 * y0 * y0);
    c = c + vec3f(whites * 0.3 * y0 * y0 * y0);
    c = c + vec3f(blacks * 0.3 * (1.0 - y0) * (1.0 - y0) * (1.0 - y0));
    // contrast around mid grey
    c = (c - vec3f(0.5)) * contrast + vec3f(0.5);
    // saturation + vibrance
    let y = luma(c);
    c = mix(vec3f(y), c, saturation);
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    c = mix(vec3f(y), c, 1.0 + vibrance * (1.0 - clamp(mx - mn, 0.0, 1.0)));
    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), src_c.a);
}`},{id:`${f}.curves`,wgsl:`
fn curve5(x: f32, ys: array<f32, 5>) -> f32 {
    var y = ys;
    let t = clamp(x, 0.0, 1.0) * 4.0;
    let i = min(i32(floor(t)), 3);
    let f = t - f32(i);
    let p1 = y[i];
    let p2 = y[i + 1];
    let p0 = select(y[max(i - 1, 0)], 2.0 * p1 - p2, i == 0);
    let p3 = select(y[min(i + 2, 4)], 2.0 * p2 - p1, i == 3);
    let f2 = f * f;
    let f3 = f2 * f;
    let v = 0.5 * (2.0 * p1 + (p2 - p0) * f + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f2 + (3.0 * p1 - p0 - 3.0 * p2 + p3) * f3);
    return clamp(v, 0.0, 1.0);
}
fn effect(uv: vec2f) -> vec4f {
    let s = src(uv);
    let m = array<f32, 5>(P0().x, P0().y, P0().z, P0().w, P4().x);
    let r = array<f32, 5>(P1().x, P1().y, P1().z, P1().w, P4().y);
    let g = array<f32, 5>(P2().x, P2().y, P2().z, P2().w, P4().z);
    let b = array<f32, 5>(P3().x, P3().y, P3().z, P3().w, P4().w);
    var c = clamp(s.rgb, vec3f(0.0), vec3f(1.0));
    c = vec3f(curve5(c.r, m), curve5(c.g, m), curve5(c.b, m));
    c = vec3f(curve5(c.r, r), curve5(c.g, g), curve5(c.b, b));
    return vec4f(c, s.a);
}`},{id:`${f}.hsl`,wgsl:`
fn rgb2hsv(c: vec3f) -> vec3f {
    let k = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4f(c.bg, k.wz), vec4f(c.gb, k.xy), step(c.b, c.g));
    let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
fn hsv2rgb(c: vec3f) -> vec3f {
    let p = abs(fract(vec3f(c.x) + vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - vec3f(3.0));
    return c.z * mix(vec3f(1.0), clamp(p - vec3f(1.0), vec3f(0.0), vec3f(1.0)), c.y);
}
fn effect(uv: vec2f) -> vec4f {
    let s = src(uv);
    let c = clamp(s.rgb, vec3f(0.0), vec3f(1.0));
    let hsv = rgb2hsv(c);
    var hs = array<f32, 8>(P0().x, P0().y, P0().z, P0().w, P1().x, P1().y, P1().z, P1().w);
    var ss = array<f32, 8>(P2().x, P2().y, P2().z, P2().w, P3().x, P3().y, P3().z, P3().w);
    var ls = array<f32, 8>(P4().x, P4().y, P4().z, P4().w, P5().x, P5().y, P5().z, P5().w);
    var centers = array<f32, 8>(0.0, 30.0, 60.0, 120.0, 180.0, 230.0, 275.0, 320.0);
    var dh = 0.0;
    var ds = 0.0;
    var dl = 0.0;
    for (var i = 0; i < 8; i++) {
        let d = abs(fract(hsv.x - centers[i] / 360.0 + 0.5) - 0.5) * 360.0;
        let w = max(0.0, 1.0 - d / 45.0);
        dh = dh + hs[i] * w;
        ds = ds + ss[i] * w;
        dl = dl + ls[i] * w;
    }
    let chroma = smoothstep(0.0, 0.25, hsv.y);
    let h = fract(hsv.x + dh * chroma * 30.0 / 360.0);
    let sat = clamp(hsv.y * (1.0 + ds * chroma), 0.0, 1.0);
    var rgb = hsv2rgb(vec3f(h, sat, hsv.z));
    rgb = rgb * (1.0 + dl * 0.5 * chroma);
    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), s.a);
}`},{id:`${f}.wheels`,wgsl:`
fn wheel(v: vec2f) -> vec3f {
    // atan2(0, 0) is NaN on some GPUs: a centred wheel is no tint
    if (length(v) < 0.00001) { return vec3f(0.0); }
    let a = atan2(v.y, v.x);
    // twice Kadr's push: a wheel pulled to its edge is a clear grade, not a hint
    let r = min(1.0, length(v)) * 0.5;
    return vec3f(cos(a), cos(a - 2.094), cos(a + 2.094)) * r;
}
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let st = wheel(P0().xy);
    let mt = wheel(P1().xy);
    let ht = wheel(P2().xy);
    let sl = P0().z;
    let ml = P1().z;
    let hl = P2().z;
    let y = luma(c.rgb);
    let ws = max(0.0, 1.0 - y * 2.0);
    let wh = max(0.0, y * 2.0 - 1.0);
    let wm = 1.0 - ws - wh;
    var v = c.rgb + (st + vec3f(sl)) * ws + (ht + vec3f(hl)) * wh;
    let gamma = exp2(-(mt + vec3f(ml)) * 2.0);
    v = v + (pow(max(v, vec3f(0.0)), gamma) - v) * wm;
    return vec4f(clamp(v, vec3f(0.0), vec3f(1.0)), c.a);
}`},{id:`${f}.look`,wgsl:`
fn lut_sample(c: vec3f) -> vec3f {
    let size = P0().z;
    let cc = clamp(c, vec3f(0.0), vec3f(1.0)) * (size - 1.0);
    let b0 = floor(cc.b);
    let b1 = min(b0 + 1.0, size - 1.0);
    let fb = cc.b - b0;
    let w = size * size;
    let y = (cc.g + 0.5) / size;
    let s0 = aux0(vec2f((b0 * size + cc.r + 0.5) / w, y)).rgb;
    let s1 = aux0(vec2f((b1 * size + cc.r + 0.5) / w, y)).rgb;
    return mix(s0, s1, fb);
}
fn effect(uv: vec2f) -> vec4f {
    let src_c = src(uv);
    var c = clamp(src_c.rgb, vec3f(0.0), vec3f(1.0));
    if (P0().w > 0.5) {
        c = mix(c, lut_sample(c), P0().y);
    }
    let vig = P0().x;
    let a = aspect();
    let p = (uv - vec2f(0.5)) * vec2f(min(a, 1.0), min(1.0 / a, 1.0)) * 2.0;
    let k = smoothstep(0.35, 1.05, length(p) / 1.41421 * 1.25);
    c = c * (1.0 - vig * k);
    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), src_c.a);
}`}];for(let e of m)(0,r.defineShaderSource)(e);let u=[{value:"none",label:"None"},...t.LOOKS.map(e=>({value:e.id,label:e.name})),{value:"custom",label:"Imported LUT"}],d=["m","r","g","b"],v=[0,25,50,75,100],h=(e,t)=>`curve${e.toUpperCase()}${t}`,p=[{id:"red",label:"Red",swatch:"#ef4444"},{id:"orange",label:"Orange",swatch:"#f97316"},{id:"yellow",label:"Yellow",swatch:"#eab308"},{id:"green",label:"Green",swatch:"#22c55e"},{id:"aqua",label:"Aqua",swatch:"#06b6d4"},{id:"blue",label:"Blue",swatch:"#3b82f6"},{id:"purple",label:"Purple",swatch:"#e8a33d"},{id:"magenta",label:"Magenta",swatch:"#d946ef"}],g=(e,t)=>`hsl${e.toUpperCase()}_${t}`,y=[{id:"lift",label:"Shadows"},{id:"gamma",label:"Midtones"},{id:"gain",label:"Highlights"}],b=(e,t)=>`wheel${e[0].toUpperCase()}${e.slice(1)}${"level"===t?"Level":t.toUpperCase()}`,x=[l("exposure","Exposure",0,-3,3,.05),l("contrast","Contrast",0,-100,100,1),l("highlights","Highlights",0,-100,100,1),l("shadows","Shadows",0,-100,100,1),l("whites","Whites",0,-100,100,1),l("blacks","Blacks",0,-100,100,1),l("temperature","Temperature",0,-100,100,1),l("tint","Tint",0,-100,100,1),l("saturation","Saturation",0,-100,100,1),l("vibrance","Vibrance",0,-100,100,1),...d.flatMap(e=>v.map((t,a)=>l(h(e,a),`Curve ${e} ${t}`,t,0,100,1))),...["h","s","l"].flatMap(e=>p.map(t=>l(g(e,t.id),`${t.label} ${e}`,0,-100,100,1))),...y.flatMap(e=>[l(b(e.id,"x"),`${e.label} x`,0,-1,1,.01),l(b(e.id,"y"),`${e.label} y`,0,-1,1,.01),l(b(e.id,"level"),`${e.label} level`,0,-100,100,1)]),{key:"look",label:"Look",type:"select",default:"none",options:u},l("lookIntensity","Look intensity",100,0,100,1),l("vignette","Vignette",0,0,100,1)],k={basic:["exposure","contrast","highlights","shadows","whites","blacks"],balance:["temperature","tint"],saturation:["saturation","vibrance"],curves:d.flatMap(e=>v.map((t,a)=>h(e,a))),hsl:["h","s","l"].flatMap(e=>p.map(t=>g(e,t.id))),wheels:y.flatMap(e=>[b(e.id,"x"),b(e.id,"y"),b(e.id,"level")]),look:["look","lookIntensity","vignette","lutData","lutName"]},P=Object.fromEntries(x.map(e=>[e.key,e.default]));function w(e,t){return k[e].every(e=>{if("lutData"===e||"lutName"===e||"lookIntensity"===e)return!0;let a=P[e],r=t[e]??a;return"number"==typeof a?1e-6>Math.abs(c(t,e,a)-a):r===a})}function S(e,t){let a={...t};for(let t of k[e])t in P?a[t]=P[t]:delete a[t];return a}e.s(["COLOR_EFFECT_TYPE",0,f,"COLOR_GROUP_KEYS",0,k,"CURVE_CHANNELS",0,d,"CURVE_X",0,v,"HSL_RANGES",0,p,"WHEELS",0,y,"colorEffect",0,{type:f,name:"Color",keywords:["color","adjust","lut","look","curves","hsl","wheels","цвет"],category:"Color",hidden:!0,params:x,shaders:m,renderer:{passes:[],buildPasses:function(e){let r,o=e.effectParams,i=(e,t,a)=>({shader:e,uniforms:{u_time:0,u_progress:0,u_frame:0,u_params:t.slice(0,32)},...a&&a.length>0?{textures:a}:{}}),n=[i(f,[c(o,"exposure",0),1+c(o,"contrast",0)/100,1+c(o,"saturation",0)/100,c(o,"vibrance",0)/100,c(o,"temperature",0)/100,c(o,"tint",0)/100,c(o,"highlights",0)/100,c(o,"shadows",0)/100,c(o,"whites",0)/100,c(o,"blacks",0)/100])];if(!w("curves",o)){let e=(e,t)=>c(o,h(e,t),v[t])/100;n.push(i(`${f}.curves`,[...[0,1,2,3].map(t=>e("m",t)),...[0,1,2,3].map(t=>e("r",t)),...[0,1,2,3].map(t=>e("g",t)),...[0,1,2,3].map(t=>e("b",t)),e("m",4),e("r",4),e("g",4),e("b",4)]))}if(!w("hsl",o)){let e=e=>p.map(t=>c(o,g(e,t.id),0)/100);n.push(i(`${f}.hsl`,[...e("h"),...e("s"),...e("l")]))}w("wheels",o)||n.push(i(`${f}.wheels`,y.flatMap(e=>[c(o,b(e.id,"x"),0),c(o,b(e.id,"y"),0),c(o,b(e.id,"level"),0)/200,0])));let s="none"===(r="string"==typeof o.look?o.look:"none")?null:"custom"===r?"string"==typeof o.lutData&&o.lutData?(0,t.customLutTextureId)(o.lutData):null:(0,t.lookTextureId)(r);return(s||c(o,"vignette",0)>0)&&n.push(i(`${f}.look`,[c(o,"vignette",0)/100,c(o,"lookIntensity",100)/100,a.LUT_SIZE,+!!s],s?[s]:void 0)),n}}},"curveKey",0,h,"hslKey",0,g,"isColorGroupNeutral",()=>w,"resetColorGroup",()=>S,"wheelKey",0,b],66290)},85271,e=>{"use strict";var t=e.i(66290),a=e.i(19549);let r="Camera",o="Light",c="Style",i="Retro",n=`
fn effect(uv: vec2f) -> vec4f {
    let amount = P0().x;
    let attack = max(P0().y, 0.001);
    let blur = P0().z;
    let k = ease_out_cubic(fx.time / attack);
    let s = 1.0 + amount * k;
    let c = vec2f(P1().x, P1().y);
    // short zoom blur while the punch is moving
    let smear = blur * amount * (1.0 - clamp(fx.time / attack, 0.0, 1.0));
    var acc = vec4f(0.0);
    for (var i = 0; i < 8; i++) {
        let f = f32(i) / 7.0;
        acc += src_bounded(zoom_uv(uv, c, s * (1.0 - smear * f * 0.5)));
    }
    return acc / 8.0;
}`,s=(0,a.defineShaderEffect)({type:"studio.zoomPunch",name:"Zoom Punch",keywords:["zoom","punch","наезд","зум","пунч"],category:r,params:[(0,a.numberParam)("amount","Amount, %",15,0,60,1),(0,a.numberParam)("attack","Speed, s",.12,.02,1,.01),(0,a.numberParam)("blur","Motion blur",.6,0,1,.05),(0,a.numberParam)("centerX","Center X",50,0,100,1),(0,a.numberParam)("centerY","Center Y",45,0,100,1)],wgsl:n,pack:({p:e})=>[(0,a.num)(e,"amount",15)/100,(0,a.num)(e,"attack",.12),(0,a.num)(e,"blur",.6),0,(0,a.num)(e,"centerX",50)/100,(0,a.num)(e,"centerY",45)/100],thumbnailParams:{attack:.5}}),l=`
fn effect(uv: vec2f) -> vec4f {
    let amount = P0().x;
    let zoom_out = P0().y;
    let drift = P0().z;
    let e = ease_in_out_sine(fx.progress);
    let k = select(e, 1.0 - e, zoom_out > 0.5);
    let s = 1.0 + amount * k;
    let c = vec2f(0.5 + drift * (e - 0.5), 0.5);
    return src_bounded(zoom_uv(uv, c, s));
}`,f=(0,a.defineShaderEffect)({type:"studio.kenBurns",name:"Slow Push-In",keywords:["ken burns","push","наезд","дыхание"],category:r,params:[(0,a.numberParam)("amount","Amount, %",8,0,40,1),{key:"zoomOut",label:"Zoom out",type:"boolean",default:!1},(0,a.numberParam)("drift","Drift, %",2,-10,10,.5)],wgsl:l,pack:({p:e})=>[(0,a.num)(e,"amount",8)/100,(0,a.bool)(e,"zoomOut"),(0,a.num)(e,"drift",2)/100]}),m=`
fn effect(uv: vec2f) -> vec4f {
    let amp = P0().x;
    let freq = P0().y;
    let rot_deg = P0().z;
    let decay = P0().w;
    let seed = P1().x;
    let t = fx.time;
    let env = select(1.0, exp(-t / max(decay, 0.001)), decay > 0.0);
    let x = t * freq + seed;
    let off = vec2f(
        vnoise(x) * 0.7 + vnoise(x * 2.13 + 11.0) * 0.3,
        vnoise(x + 37.0) * 0.7 + vnoise(x * 1.91 + 53.0) * 0.3
    ) * amp * env;
    let rot = (vnoise(x + 71.0) * rot_deg * env) * 0.0174533;
    let zoom = 1.0 + amp * 2.2 + abs(rot_deg) * 0.006;
    let a = aspect();
    var p = (uv - vec2f(0.5)) * vec2f(a, 1.0);
    p = rotate2(p, -rot) / zoom;
    let suv = p / vec2f(a, 1.0) + vec2f(0.5) - off * vec2f(1.0, a);
    return src_bounded(suv);
}`,u=(0,a.defineShaderEffect)({type:"studio.shake",name:"Shake",keywords:["shake","impact","тряска","удар"],category:r,params:[(0,a.numberParam)("amplitude","Amount, %",2.5,0,10,.1),(0,a.numberParam)("frequency","Frequency, Hz",12,.2,30,.1),(0,a.numberParam)("rotation","Rotation, °",1.5,0,10,.1),(0,a.numberParam)("decay","Decay, s",.35,0,5,.05),(0,a.numberParam)("seed","Seed",0,0,99,1)],wgsl:m,pack:({p:e})=>[(0,a.num)(e,"amplitude",2.5)/100,(0,a.num)(e,"frequency",12),(0,a.num)(e,"rotation",1.5),(0,a.num)(e,"decay",.35),17.31*(0,a.num)(e,"seed",0)]}),d=(0,a.defineShaderEffect)({type:"studio.handheld",name:"Handheld",keywords:["handheld","drift","телефон","рука"],category:r,shader:"studio.shake",params:[(0,a.numberParam)("amplitude","Amount, %",.6,0,3,.05),(0,a.numberParam)("frequency","Frequency, Hz",.9,.1,5,.05),(0,a.numberParam)("rotation","Rotation, °",.3,0,3,.05),(0,a.numberParam)("seed","Seed",0,0,99,1)],wgsl:m,pack:({p:e})=>[(0,a.num)(e,"amplitude",.6)/100,(0,a.num)(e,"frequency",.9),(0,a.num)(e,"rotation",.3),0,17.31*(0,a.num)(e,"seed",0)+5]}),v=`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let strength = P0().x;
    let len = max(P0().y, 0.04);
    let period = P0().z;
    let col = P1().xyz;
    var t = fx.time;
    if (period > 0.0) { t = t - floor(t / period) * period; }
    let attack = 1.0 / 30.0;
    let up = clamp(t / attack, 0.0, 1.0);
    let down = 1.0 - clamp((t - attack) / len, 0.0, 1.0);
    let e = up * down * down * strength;
    return vec4f(mix(c.rgb, col, e), c.a);
}`,h=(0,a.defineShaderEffect)({type:"studio.flash",name:"Flash",keywords:["flash","вспышка","белый"],category:o,params:[(0,a.numberParam)("strength","Amount",.9,0,1,.05),(0,a.numberParam)("length","Length, s",.2,.04,1.5,.01),(0,a.numberParam)("rate","Repeats per second",0,0,3,.5),{key:"color",label:"Color",type:"color",default:"#ffffff"}],wgsl:v,pack:({p:e})=>{let t=Math.min(3,Math.max(0,(0,a.num)(e,"rate",0)));return[(0,a.num)(e,"strength",.9),(0,a.num)(e,"length",.2),t>0?1/t:0,0,...(0,a.rgb)(e,"color",[1,1,1])]}}),p=`
fn effect(uv: vec2f) -> vec4f {
    let decay = P0().y;
    let env = select(1.0, exp(-fx.time / max(decay, 0.001)), decay > 0.0);
    let amount = P0().x * env;
    let c = vec2f(P0().z, P0().w);
    var acc = vec4f(0.0);
    for (var i = 0; i < 24; i++) {
        let f = f32(i) / 23.0;
        acc += src_bounded(c + (uv - c) * (1.0 - amount * f));
    }
    return acc / 24.0;
}`,g=(0,a.defineShaderEffect)({type:"studio.zoomBlur",name:"Zoom Blur",keywords:["zoom blur","radial","рывок","зум"],category:r,params:[(0,a.numberParam)("amount","Amount",.25,0,.8,.01),(0,a.numberParam)("decay","Decay, s",0,0,3,.05),(0,a.numberParam)("centerX","Center X",50,0,100,1),(0,a.numberParam)("centerY","Center Y",50,0,100,1)],wgsl:p,pack:({p:e})=>[(0,a.num)(e,"amount",.25),(0,a.num)(e,"decay",0),(0,a.num)(e,"centerX",50)/100,(0,a.num)(e,"centerY",50)/100]}),y=`
fn effect(uv: vec2f) -> vec4f {
    let pulse = P0().z;
    var env = 1.0;
    if (pulse > 0.0) {
        let ph = fx.time * pulse;
        env = exp(-(ph - floor(ph)) * 5.0);
    }
    let amount = P0().x * env;
    let radial = P0().y;
    let dir = select(vec2f(1.0, 0.0), (uv - vec2f(0.5)) * 2.0, radial > 0.5);
    let d = dir * amount * vec2f(1.0, aspect());
    let r = src_bounded(uv + d);
    let g = src(uv);
    let b = src_bounded(uv - d);
    return vec4f(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,b=(0,a.defineShaderEffect)({type:"studio.rgbSplit",name:"RGB Split",keywords:["rgb","chromatic","aberration","хроматическая"],category:c,params:[(0,a.numberParam)("amount","Amount, %",.8,0,5,.05),{key:"radial",label:"Radial",type:"boolean",default:!1},(0,a.numberParam)("pulse","Pulses per second",0,0,3,.25)],wgsl:y,pack:({p:e})=>[(0,a.num)(e,"amount",.8)/100,(0,a.bool)(e,"radial"),(0,a.num)(e,"pulse",0)]}),x=`
fn effect(uv: vec2f) -> vec4f {
    let intensity = P0().x;
    let freq = P0().y;
    let split = P0().z;
    let fr = floor(fx.frame / 2.0);
    let gate = step(hash11(fr * 1.37 + 0.5), freq * 0.7);
    let amt = intensity * gate;
    var u = uv;
    for (var i = 0; i < 6; i++) {
        let bi = f32(i);
        let y0 = hash11(fr * 7.13 + bi * 13.31);
        let h = 0.015 + 0.07 * hash11(fr * 3.37 + bi * 5.11);
        let inside = step(y0, uv.y) * step(uv.y, y0 + h);
        u.x = u.x + (hash11(fr * 9.71 + bi * 2.93) - 0.5) * 0.3 * amt * inside;
    }
    let d = vec2f(split * amt, 0.0);
    let r = src_bounded(u + d);
    let g = src_bounded(u);
    let b = src_bounded(u - d);
    var c = vec4f(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
    let line = step(0.5, fract(uv.y * fx.resolution.y / 3.0));
    c = vec4f(c.rgb * (1.0 - 0.18 * amt * line), c.a);
    return c;
}`,k=(0,a.defineShaderEffect)({type:"studio.glitch",name:"Glitch",keywords:["glitch","глитч","сбой","digital"],category:c,params:[(0,a.numberParam)("intensity","Amount",.6,0,1,.05),(0,a.numberParam)("frequency","Frequency",.5,0,1,.05),(0,a.numberParam)("split","Color split, %",.8,0,4,.05)],wgsl:x,pack:({p:e})=>[(0,a.num)(e,"intensity",.6),(0,a.num)(e,"frequency",.5),(0,a.num)(e,"split",.8)/100]}),P=`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let amount = P0().x;
    let size = max(P0().y, 0.5);
    let cell = floor(uv * fx.resolution / size);
    let n = hash12(cell + vec2f(fx.frame * 17.13, fx.frame * 31.71)) - 0.5;
    let y = luma(c.rgb);
    let w = 1.0 - abs(y * 2.0 - 1.0) * 0.6;
    let g = n * amount * 0.45 * w;
    return vec4f(clamp(c.rgb + vec3f(g), vec3f(0.0), vec3f(1.0)), c.a);
}`,w=(0,a.defineShaderEffect)({type:"studio.grain",name:"Film Grain",keywords:["grain","film","зерно","плёнка","шум"],category:i,params:[(0,a.numberParam)("amount","Amount",.25,0,1,.01),(0,a.numberParam)("size","Size, px",1.5,.5,4,.1)],wgsl:P,pack:({p:e,height:t})=>[(0,a.num)(e,"amount",.25),(0,a.num)(e,"size",1.5)*Math.max(1,t/1920)]}),S=`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let intensity = P0().x;
    let radius = P0().y;
    let softness = max(P0().z, 0.01);
    let a = aspect();
    let p = (uv - vec2f(0.5)) * vec2f(min(a, 1.0), min(1.0 / a, 1.0)) * 2.0;
    let d = length(p) / 1.41421;
    let k = smoothstep(radius - softness, radius, d * 1.25);
    return vec4f(c.rgb * (1.0 - intensity * k), c.a);
}`,_=(0,a.defineShaderEffect)({type:"studio.vignette",name:"Vignette",keywords:["vignette","виньетка","края"],category:o,params:[(0,a.numberParam)("intensity","Amount",.5,0,1,.01),(0,a.numberParam)("radius","Radius",.9,.2,1.5,.01),(0,a.numberParam)("softness","Softness",.6,.05,1.2,.01)],wgsl:S,pack:({p:e})=>[(0,a.num)(e,"intensity",.5),(0,a.num)(e,"radius",.9),(0,a.num)(e,"softness",.6)]}),E=`
fn rgb2yiq(c: vec3f) -> vec3f {
    return vec3f(
        dot(c, vec3f(0.299, 0.587, 0.114)),
        dot(c, vec3f(0.596, -0.274, -0.322)),
        dot(c, vec3f(0.211, -0.523, 0.312))
    );
}
fn yiq2rgb(c: vec3f) -> vec3f {
    return vec3f(
        c.x + 0.956 * c.y + 0.621 * c.z,
        c.x - 0.272 * c.y - 0.647 * c.z,
        c.x - 1.106 * c.y + 1.703 * c.z
    );
}
fn effect(uv: vec2f) -> vec4f {
    let amount = P0().x;
    let tracking = P0().y;
    let px = texel().x;
    // tracking band rolling down the frame
    let band_y = fract(fx.time * 0.12);
    let in_band = smoothstep(0.0, 0.04, uv.y - band_y) * (1.0 - smoothstep(0.04, 0.09, uv.y - band_y));
    let line_jit = (hash11(floor(uv.y * fx.resolution.y / 2.0) + fx.frame * 3.1) - 0.5) * px * 2.0 * amount;
    var u = uv + vec2f(line_jit + in_band * tracking * amount * 0.02 * (hash11(fx.frame) - 0.3), 0.0);
    let base = src_bounded(u);
    // horizontal chroma smear
    var chroma = vec3f(0.0);
    for (var i = 0; i < 6; i++) {
        let o = (f32(i) - 1.0) * px * 3.0 * amount;
        chroma += rgb2yiq(src_bounded(u - vec2f(o, 0.0)).rgb);
    }
    chroma = chroma / 6.0;
    var yiq = vec3f(rgb2yiq(base.rgb).x, chroma.y * (1.0 - 0.2 * amount), chroma.z * (1.0 - 0.2 * amount));
    var c = yiq2rgb(yiq);
    // RGB split 3 px
    let rs = src_bounded(u + vec2f(px * 3.0 * amount, 0.0)).r;
    c.r = mix(c.r, rs, 0.5 * amount);
    // noise + scanlines
    let n = hash12(uv * fx.resolution + vec2f(fx.frame * 13.0, fx.frame * 7.0)) - 0.5;
    c = c + vec3f(n * 0.08 * amount) + vec3f(in_band * tracking * amount * 0.12 * n);
    let line = step(0.5, fract(uv.y * fx.resolution.y / 2.0));
    c = c * (1.0 - 0.1 * amount * line);
    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), base.a);
}`,M=(0,a.defineShaderEffect)({type:"studio.vhs",name:"VHS",keywords:["vhs","кассета","ретро","retro"],category:i,params:[(0,a.numberParam)("amount","Amount",.7,0,1,.05),{key:"tracking",label:"Tracking band",type:"boolean",default:!0}],wgsl:E,pack:({p:e})=>[(0,a.num)(e,"amount",.7),(0,a.bool)(e,"tracking")]}),T=`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let amount = P0().x;
    let speed = P0().y;
    let col = P1().xyz;
    let t = fx.time * speed;
    let a = aspect();
    let p = uv * vec2f(a, 1.0);
    let c1 = vec2f((0.15 + 0.25 * sin(t * 0.7)) * a, 0.2 + 0.3 * cos(t * 0.5));
    let c2 = vec2f((0.85 + 0.2 * cos(t * 0.6 + 1.7)) * a, 0.75 + 0.2 * sin(t * 0.8 + 0.4));
    let g1 = exp(-pow(length(p - c1) / (0.45 * max(a, 1.0)), 2.0));
    let g2 = exp(-pow(length(p - c2) / (0.35 * max(a, 1.0)), 2.0));
    let leak = clamp((col * g1 + mix(col, vec3f(1.0, 0.3, 0.45), 0.5) * g2 * 0.8) * amount, vec3f(0.0), vec3f(1.0));
    let screen = vec3f(1.0) - (vec3f(1.0) - c.rgb) * (vec3f(1.0) - leak);
    return vec4f(screen, c.a);
}`,z=(0,a.defineShaderEffect)({type:"studio.lightLeak",name:"Light Leak",keywords:["light leak","засветка","плёнка","тёплый"],category:o,params:[(0,a.numberParam)("amount","Amount",.6,0,1,.01),(0,a.numberParam)("speed","Speed",1,0,4,.1),{key:"color",label:"Color",type:"color",default:"#ff7326"}],wgsl:T,pack:({p:e})=>[(0,a.num)(e,"amount",.6),(0,a.num)(e,"speed",1),0,0,...(0,a.rgb)(e,"color",[1,.45,.15])]}),I=`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let amount = P0().x;
    let r = texel() * P0().y;
    var blur = vec3f(0.0);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            blur += src(uv + vec2f(f32(x), f32(y)) * r).rgb;
        }
    }
    blur = blur / 9.0;
    return vec4f(clamp(c.rgb + (c.rgb - blur) * amount, vec3f(0.0), vec3f(1.0)), c.a);
}`,A=(0,a.defineShaderEffect)({type:"studio.sharpen",name:"Sharpen",keywords:["sharpen","резкость","чёткость"],category:c,params:[(0,a.numberParam)("amount","Amount",.6,0,3,.05),(0,a.numberParam)("radius","Radius, px",1.5,.5,6,.1)],wgsl:I,pack:({p:e,width:t})=>[(0,a.num)(e,"amount",.6),(0,a.num)(e,"radius",1.5)*Math.max(1,t/1080)]}),L=`
fn PX() -> f32 { return fx.resolution.x / 1920.0; }
fn sobel(uv: vec2f, r: vec2f) -> f32 {
    let tl = luma(src(uv + vec2f(-r.x, -r.y)).rgb);
    let t = luma(src(uv + vec2f(0.0, -r.y)).rgb);
    let tr = luma(src(uv + vec2f(r.x, -r.y)).rgb);
    let l = luma(src(uv + vec2f(-r.x, 0.0)).rgb);
    let rr = luma(src(uv + vec2f(r.x, 0.0)).rgb);
    let bl = luma(src(uv + vec2f(-r.x, r.y)).rgb);
    let b = luma(src(uv + vec2f(0.0, r.y)).rgb);
    let br = luma(src(uv + vec2f(r.x, r.y)).rgb);
    let gx = -tl - 2.0 * l - bl + tr + 2.0 * rr + br;
    let gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    return length(vec2f(gx, gy));
}
fn disk_blur(uv: vec2f, radius: vec2f) -> vec4f {
    var acc = vec4f(0.0);
    for (var n = 0; n < 16; n++) {
        let f = f32(n);
        let ang = f * 2.39996323;
        let rad = sqrt((f + 0.5) / 16.0);
        acc += src(uv + vec2f(cos(ang), sin(ang)) * rad * radius);
    }
    return acc / 16.0;
}
fn grain_at(uv: vec2f, seed: f32) -> f32 {
    return hash12(floor(uv * fx.resolution / max(1.0, 1.5 * PX())) + vec2f(seed * 17.13, seed * 31.71)) - 0.5;
}
fn overlay(base: vec3f, blend: vec3f) -> vec3f {
    return select(vec3f(1.0) - 2.0 * (vec3f(1.0) - base) * (vec3f(1.0) - blend), 2.0 * base * blend, base < vec3f(0.5));
}
`,F=e=>`${L}${e}`,C="Film",N="Graphic",q="Distort",R="Camera",D="Color",O="Style",B=[(0,a.defineShaderEffect)({type:"kadr.effect.blackWhite",name:"Black & White",keywords:["mono","bw","grayscale","чб"],category:D,params:[(0,a.numberParam)("red","Red",.3,-1,2,.01),(0,a.numberParam)("green","Green",.59,-1,2,.01),(0,a.numberParam)("blue","Blue",.11,-1,2,.01),(0,a.numberParam)("contrast","Contrast",1,.5,2,.01),(0,a.numberParam)("toneAmount","Tone",0,0,1,.01),{key:"toneColor",label:"Tone color",type:"color",default:"#dbb885"}],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    var y = dot(c.rgb, P0().xyz);
    y = clamp((y - 0.5) * P0().w + 0.5, 0.0, 1.0);
    let tone = P1().yzw / max(luma(P1().yzw), 0.001) * y;
    return vec4f(clamp(mix(vec3f(y), tone, P1().x), vec3f(0.0), vec3f(1.0)), c.a);
}`),pack:({p:e})=>[(0,a.num)(e,"red",.3),(0,a.num)(e,"green",.59),(0,a.num)(e,"blue",.11),(0,a.num)(e,"contrast",1),(0,a.num)(e,"toneAmount",0),...(0,a.rgb)(e,"toneColor",[.86,.72,.52])]}),(0,a.defineShaderEffect)({type:"kadr.effect.duotone",name:"Duotone",keywords:["duotone","two tone","gradient map"],category:N,params:[{key:"shadows",label:"Shadows",type:"color",default:"#1f0d59"},{key:"highlights",label:"Highlights",type:"color",default:"#ff8c59"}],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    return vec4f(mix(P0().xyz, P1().xyz, luma(c.rgb)), c.a);
}`),pack:({p:e})=>[...(0,a.rgb)(e,"shadows",[.12,.05,.35]),0,...(0,a.rgb)(e,"highlights",[1,.55,.35])]}),(0,a.defineShaderEffect)({type:"kadr.effect.posterize",name:"Posterize",keywords:["posterize","levels","pop art"],category:N,params:[(0,a.numberParam)("levels","Levels",6,2,30,1)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let l = max(P0().x, 2.0);
    return vec4f(floor(c.rgb * l + 0.5) / l, c.a);
}`),pack:({p:e})=>[(0,a.num)(e,"levels",6)]}),(0,a.defineShaderEffect)({type:"kadr.effect.halftone",name:"Halftone",keywords:["halftone","dots","print","cmyk"],category:N,params:[(0,a.numberParam)("size","Dot size, px",8,2,40,.5),{key:"cmyk",label:"CMYK colour",type:"boolean",default:!0}],wgsl:F(`
fn dot_cov(uv: vec2f, angle: f32, size: f32, channel: i32, cmyk: bool) -> f32 {
    let px = uv * fx.resolution;
    let p = rotate2(px, angle);
    let cell = (floor(p / size) + vec2f(0.5)) * size;
    let center = rotate2(cell, -angle) / fx.resolution;
    let s = src(center).rgb;
    var v = 1.0 - luma(s);
    if (cmyk) {
        let k = 1.0 - max(s.r, max(s.g, s.b));
        let d = max(1.0 - k, 0.001);
        if (channel == 0) { v = (1.0 - s.r - k) / d; }
        if (channel == 1) { v = (1.0 - s.g - k) / d; }
        if (channel == 2) { v = (1.0 - s.b - k) / d; }
        if (channel == 3) { v = k; }
    }
    let r = sqrt(clamp(v, 0.0, 1.0)) * size * 0.72;
    return 1.0 - smoothstep(r - 0.8, r + 0.8, length(p - cell));
}
fn effect(uv: vec2f) -> vec4f {
    let a = src(uv).a;
    let size = max(2.0, P0().x * PX());
    if (P0().y < 0.5) {
        let k = dot_cov(uv, 0.785398, size, 4, false);
        return vec4f(vec3f(1.0 - k), a);
    }
    let cc = dot_cov(uv, 0.261799, size, 0, true);
    let mm = dot_cov(uv, 1.308997, size, 1, true);
    let yy = dot_cov(uv, 0.0, size, 2, true);
    let kk = dot_cov(uv, 0.785398, size, 3, true);
    return vec4f((1.0 - kk) * vec3f(1.0 - cc, 1.0 - mm, 1.0 - yy), a);
}`),pack:({p:e})=>[(0,a.num)(e,"size",8),(0,a.bool)(e,"cmyk")||void 0===e.cmyk?1:0]}),(0,a.defineShaderEffect)({type:"kadr.effect.comic",name:"Comic",keywords:["comic","cartoon","ink"],category:N,params:[(0,a.numberParam)("ink","Ink",1,0,2,.05)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let e = sobel(uv, texel() * 1.5 * PX());
    let ink = 1.0 - smoothstep(0.15, 0.45, e * P0().x);
    let y = luma(c.rgb);
    let sat = mix(vec3f(y), c.rgb, 1.5);
    let poster = floor(clamp(sat, vec3f(0.0), vec3f(1.0)) * 4.0 + 0.5) / 4.0;
    return vec4f(poster * ink, c.a);
}`),pack:({p:e})=>[(0,a.num)(e,"ink",1)]}),(0,a.defineShaderEffect)({type:"kadr.effect.neon",name:"Neon Edges",keywords:["neon","edges","glow","outline"],category:N,params:[{key:"color",label:"Color",type:"color",default:"#33e6ff"},(0,a.numberParam)("glow","Glow",.8,0,2,.05),(0,a.numberParam)("darken","Darken",.7,0,1,.05)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let r = texel() * PX();
    let e = clamp(sobel(uv, r) * 3.0, 0.0, 1.0);
    var halo = 0.0;
    for (var n = 0; n < 4; n++) {
        let ang = f32(n) * 1.5707963 + 0.785398;
        halo += clamp(sobel(uv + vec2f(cos(ang), sin(ang)) * r * 8.0, r) * 3.0, 0.0, 1.0);
    }
    let edge = clamp(e + halo * 0.25 * P1().x, 0.0, 1.0);
    let dark = c.rgb * exp2(-3.0 * P1().y);
    return vec4f(clamp(dark + P0().xyz * edge * (1.0 + P1().x), vec3f(0.0), vec3f(1.0)), c.a);
}`),pack:({p:e})=>[...(0,a.rgb)(e,"color",[.2,.9,1]),0,(0,a.num)(e,"glow",.8),(0,a.num)(e,"darken",.7)]}),(0,a.defineShaderEffect)({type:"kadr.effect.filmLook",name:"Film Look",keywords:["film","halation","cinematic","kodak"],category:C,params:[(0,a.numberParam)("halation","Halation",.5,0,1,.01),(0,a.numberParam)("grain","Grain",.35,0,1,.01)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let glow = disk_blur(uv, texel() * 18.0 * PX());
    let hi = clamp((glow.rgb - vec3f(0.55)) * 2.2, vec3f(0.0), vec3f(1.0));
    let halo = vec3f(luma(hi)) * vec3f(1.0, 0.35, 0.2) * P0().x;
    var o = vec3f(1.0) - (vec3f(1.0) - c.rgb) * (vec3f(1.0) - halo);
    o = (o - vec3f(0.5)) * 0.94 + vec3f(0.5);
    o = mix(vec3f(luma(o)), o, 0.92) * vec3f(1.03, 1.0, 0.96);
    let g = grain_at(uv, fx.frame) * 0.18 * P0().y + 0.5;
    o = mix(o, overlay(clamp(o, vec3f(0.0), vec3f(1.0)), vec3f(g)), 0.9);
    return vec4f(clamp(o, vec3f(0.0), vec3f(1.0)), c.a);
}`),pack:({p:e})=>[(0,a.num)(e,"halation",.5),(0,a.num)(e,"grain",.35)]}),(0,a.defineShaderEffect)({type:"kadr.effect.oldFilm",name:"Old Film",keywords:["old film","sepia","scratches","vintage"],category:C,params:[(0,a.numberParam)("age","Age",.7,0,1,.01)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let age = P0().x;
    let y = luma(c.rgb);
    let sepia = vec3f(y * 1.07, y * 0.74, y * 0.43) + vec3f(0.08, 0.04, 0.0);
    var o = mix(c.rgb, sepia, 0.8 * age);
    o = o * exp2((hash11(fx.frame * 1.31) - 0.5) * 0.3 * age);
    let a = aspect();
    let d = length((uv - vec2f(0.5)) * vec2f(a, 1.0)) / length(vec2f(a, 1.0));
    o = o * (1.0 - smoothstep(0.25, 0.75, d) * 0.85 * age);
    let col = floor(uv.x * fx.resolution.x / max(1.0, 2.0 * PX()));
    let scratch = step(0.997, hash11(col * 3.7 + floor(fx.frame / 2.0) * 11.0)) * (0.5 + 0.5 * hash11(uv.y * 40.0 + fx.frame));
    o = vec3f(1.0) - (vec3f(1.0) - o) * (1.0 - scratch * 0.35 * age);
    let g = grain_at(uv, fx.frame) * 0.15 * age + 0.5;
    o = overlay(clamp(o, vec3f(0.0), vec3f(1.0)), vec3f(g));
    return vec4f(clamp(o, vec3f(0.0), vec3f(1.0)), c.a);
}`),pack:({p:e})=>[(0,a.num)(e,"age",.7)]}),(0,a.defineShaderEffect)({type:"kadr.effect.letterbox",name:"Cinematic Bars",keywords:["letterbox","bars","cinema","2.39"],category:C,params:[{key:"ratio",label:"Ratio",type:"select",default:"2.39",options:[{value:"2.39",label:"2.39:1"},{value:"2.0",label:"2:1"},{value:"1.85",label:"1.85:1"},{value:"1.33",label:"4:3"}]}],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let ratio = P0().x;
    let a = aspect();
    var bar = 0.0;
    if (a < ratio) {
        let h = (1.0 - a / ratio) / 2.0;
        bar = step(uv.y, h) + step(1.0 - h, uv.y);
    } else {
        let wd = (1.0 - ratio / a) / 2.0;
        bar = step(uv.x, wd) + step(1.0 - wd, uv.x);
    }
    return select(c, vec4f(0.0, 0.0, 0.0, 1.0), bar > 0.5);
}`),pack:({p:e})=>[Number.parseFloat(String(e.ratio??"2.39"))||2.39]}),(0,a.defineShaderEffect)({type:"kadr.effect.kaleidoscope",name:"Kaleidoscope",keywords:["kaleidoscope","mirror","psychedelic"],category:q,params:[(0,a.numberParam)("count","Segments",6,2,24,1),(0,a.numberParam)("angle","Angle, °",0,0,360,1)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let a = aspect();
    let p = (uv - vec2f(0.5)) * vec2f(a, 1.0);
    let seg = 6.2831853 / max(P0().x, 2.0);
    var ang = atan2(p.y, p.x) - P0().y;
    ang = ang - floor(ang / seg) * seg;
    ang = abs(ang - seg * 0.5) + P0().y;
    let q = vec2f(cos(ang), sin(ang)) * length(p);
    let suv = q / vec2f(a, 1.0) + vec2f(0.5);
    return src(vec2f(1.0) - abs(fract(suv * 0.5) * 2.0 - vec2f(1.0)));
}`),pack:({p:e})=>[(0,a.num)(e,"count",6),(0,a.num)(e,"angle",0)*Math.PI/180]}),(0,a.defineShaderEffect)({type:"kadr.effect.mirror",name:"Mirror",keywords:["mirror","symmetry","reflect"],category:q,params:[{key:"axis",label:"Axis",type:"select",default:"vertical",options:[{value:"vertical",label:"Left → right"},{value:"horizontal",label:"Top → bottom"}]}],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    var q = uv;
    if (P0().x < 0.5) { if (q.x > 0.5) { q.x = 1.0 - q.x; } } else { if (q.y > 0.5) { q.y = 1.0 - q.y; } }
    return src(q);
}`),pack:({p:e})=>[+("horizontal"===e.axis)]}),(0,a.defineShaderEffect)({type:"kadr.effect.tiltShift",name:"Tilt-Shift",keywords:["tilt shift","miniature","toy"],category:"Lens",params:[(0,a.numberParam)("radius","Blur, px",14,0,60,.5),(0,a.numberParam)("center","Center",.5,0,1,.01),(0,a.numberParam)("band","Sharp band",.18,.02,.8,.01)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let half = P0().z * 0.5;
    let m = smoothstep(half, half * 3.0, abs(uv.y - P0().y));
    let c = disk_blur(uv, texel() * P0().x * PX() * m * 1.6);
    let y = luma(c.rgb);
    return vec4f(clamp(mix(vec3f(y), c.rgb, 1.2), vec3f(0.0), vec3f(1.0)), c.a);
}`),pack:({p:e})=>[(0,a.num)(e,"radius",14),(0,a.num)(e,"center",.5),(0,a.num)(e,"band",.18)]}),(0,a.defineShaderEffect)({type:"kadr.effect.nightVision",name:"Night Vision",keywords:["night vision","green","spy"],category:R,params:[(0,a.numberParam)("noise","Noise",.25,0,1,.01)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    var o = vec3f(0.2, 1.0, 0.3) * luma(c.rgb) * exp2(0.6);
    let n = max(grain_at(uv, fx.frame) + 0.5, 0.0) * P0().x;
    o = vec3f(1.0) - (vec3f(1.0) - o) * (vec3f(1.0) - vec3f(n * 0.2, n, n * 0.3));
    let a = aspect();
    let d = length((uv - vec2f(0.5)) * vec2f(a, 1.0)) / length(vec2f(a, 1.0));
    o = o * (1.0 - smoothstep(0.2, 0.62, d));
    return vec4f(clamp(o, vec3f(0.0), vec3f(1.0)), c.a);
}`),pack:({p:e})=>[(0,a.num)(e,"noise",.25)]}),(0,a.defineShaderEffect)({type:"kadr.effect.thermal",name:"Thermal",keywords:["thermal","heat","infrared"],category:R,params:[],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let t = clamp(luma(c.rgb), 0.0, 1.0) * 4.0;
    let i = floor(min(t, 3.999));
    let f = t - i;
    var a = vec3f(0.0, 0.0, 0.0);
    var b = vec3f(0.1, 0.0, 0.8);
    if (i > 0.5) { a = vec3f(0.1, 0.0, 0.8); b = vec3f(0.85, 0.0, 0.6); }
    if (i > 1.5) { a = vec3f(0.85, 0.0, 0.6); b = vec3f(1.0, 0.45, 0.0); }
    if (i > 2.5) { a = vec3f(1.0, 0.45, 0.0); b = vec3f(1.0, 1.0, 0.6); }
    return vec4f(mix(a, b, f), c.a);
}`),pack:()=>[0]}),(0,a.defineShaderEffect)({type:"kadr.effect.glow",name:"Glow",keywords:["glow","bloom","dreamy","soft"],category:"Light",params:[(0,a.numberParam)("intensity","Intensity",.6,0,2,.01),(0,a.numberParam)("radius","Radius, px",20,0,120,1)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let b = disk_blur(uv, texel() * P0().y * PX() * 1.5);
    let bright = clamp((b.rgb - vec3f(0.6)) * 2.5, vec3f(0.0), vec3f(1.0)) * P0().x;
    return vec4f(vec3f(1.0) - (vec3f(1.0) - c.rgb) * (vec3f(1.0) - clamp(bright, vec3f(0.0), vec3f(1.0))), c.a);
}`),pack:({p:e})=>[(0,a.num)(e,"intensity",.6),(0,a.num)(e,"radius",20)]}),(0,a.defineShaderEffect)({type:"kadr.effect.mosaic",name:"Mosaic",keywords:["mosaic","pixelate","censor","blur face"],category:O,params:[(0,a.numberParam)("cellSize","Cell, px",24,2,200,1)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let cell = max(2.0, P0().x * PX()) * texel();
    let base = floor(uv / cell) * cell;
    var acc = vec4f(0.0);
    acc += src(base + cell * vec2f(0.25, 0.25));
    acc += src(base + cell * vec2f(0.75, 0.25));
    acc += src(base + cell * vec2f(0.25, 0.75));
    acc += src(base + cell * vec2f(0.75, 0.75));
    return acc / 4.0;
}`),pack:({p:e})=>[(0,a.num)(e,"cellSize",24)]}),(0,a.defineShaderEffect)({type:"kadr.effect.chromaKey",name:"Chroma Key",keywords:["chroma key","green screen","keying","хромакей"],category:"Keying",params:[{key:"keyColor",label:"Key color",type:"color",default:"#1acc40"},(0,a.numberParam)("tolerance","Tolerance",.3,0,1,.01),(0,a.numberParam)("softness","Softness",.2,0,1,.01),(0,a.numberParam)("spill","Spill",.6,0,1,.01),{key:"matte",label:"Show matte",type:"boolean",default:!1}],wgsl:F(`
fn cbcr(c: vec3f) -> vec2f {
    let y = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    return vec2f((c.b - y) / 1.8556, (c.r - y) / 1.5748);
}
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let key = P0().xyz;
    let d = distance(cbcr(c.rgb), cbcr(key)) * 2.0;
    let tol = P1().x * 0.5;
    let alpha = smoothstep(tol, tol + max(P1().y * 0.5, 0.001), d);
    // spill: pull the key hue out of the remaining edge pixels
    var o = c.rgb;
    let kmax = max(key.r, max(key.g, key.b));
    if (key.g >= kmax) { o.g = mix(o.g, min(o.g, (o.r + o.b) * 0.5), P1().z * (1.0 - alpha * 0.5)); }
    if (key.b >= kmax && key.g < kmax) { o.b = mix(o.b, min(o.b, (o.r + o.g) * 0.5), P1().z * (1.0 - alpha * 0.5)); }
    if (P1().w > 0.5) { return vec4f(vec3f(alpha * c.a), 1.0); }
    return vec4f(o, c.a * alpha);
}`),pack:({p:e})=>[...(0,a.rgb)(e,"keyColor",[.1,.8,.25]),0,(0,a.num)(e,"tolerance",.3),(0,a.num)(e,"softness",.2),(0,a.num)(e,"spill",.6),(0,a.bool)(e,"matte")]}),(0,a.defineShaderEffect)({type:"kadr.effect.denoise",name:"Denoise",keywords:["denoise","noise reduction","clean","smooth skin"],category:O,params:[(0,a.numberParam)("level","Level",.02,0,.1,.001)],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let sr = max(P0().x * 4.0, 0.0001);
    var acc = vec3f(0.0);
    var wsum = 0.0;
    for (var y = -2; y <= 2; y++) {
        for (var x = -2; x <= 2; x++) {
            let o = vec2f(f32(x), f32(y));
            let s = src(uv + o * texel() * PX()).rgb;
            let d = s - c.rgb;
            let wgt = exp(-dot(o, o) / 4.5) * exp(-dot(d, d) / (2.0 * sr * sr));
            acc += s * wgt;
            wsum += wgt;
        }
    }
    return vec4f(acc / wsum, c.a);
}`),pack:({p:e})=>[(0,a.num)(e,"level",.02)]}),(0,a.defineShaderEffect)({type:"kadr.effect.colorWheels",name:"Color Wheels",keywords:["color wheels","lift gamma gain","grade","tint"],category:D,thumbnailParams:{shadowsTintX:-.7,shadowsTintY:-.5,highsTintX:.8,highsTintY:.3,mids:.05},params:[(0,a.numberParam)("shadowsTintX","Shadows tint X",0,-1,1,.01),(0,a.numberParam)("shadowsTintY","Shadows tint Y",0,-1,1,.01),(0,a.numberParam)("shadows","Shadows level",0,-.5,.5,.01),(0,a.numberParam)("midsTintX","Midtones tint X",0,-1,1,.01),(0,a.numberParam)("midsTintY","Midtones tint Y",0,-1,1,.01),(0,a.numberParam)("mids","Midtones level",0,-.5,.5,.01),(0,a.numberParam)("highsTintX","Highlights tint X",0,-1,1,.01),(0,a.numberParam)("highsTintY","Highlights tint Y",0,-1,1,.01),(0,a.numberParam)("highs","Highlights level",0,-.5,.5,.01)],wgsl:F(`
fn wheel(v: vec2f) -> vec3f {
    // atan2(0, 0) is NaN on some GPUs: a centred wheel is no tint
    if (length(v) < 0.00001) { return vec3f(0.0); }
    let a = atan2(v.y, v.x);
    let r = min(1.0, length(v)) * 0.25;
    return vec3f(cos(a), cos(a - 2.094), cos(a + 2.094)) * r;
}
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let st = wheel(P0().xy);
    let mt = wheel(P1().xy);
    let ht = wheel(P2().xy);
    let sl = P0().z;
    let ml = P1().z;
    let hl = P2().z;
    let y = luma(c.rgb);
    let ws = max(0.0, 1.0 - y * 2.0);
    let wh = max(0.0, y * 2.0 - 1.0);
    let wm = 1.0 - ws - wh;
    var v = c.rgb + (st + vec3f(sl)) * ws + (ht + vec3f(hl)) * wh;
    let gamma = exp2(-(mt + vec3f(ml)) * 2.0);
    v = v + (pow(max(v, vec3f(0.0)), gamma) - v) * wm;
    return vec4f(clamp(v, vec3f(0.0), vec3f(1.0)), c.a);
}`),pack:({p:e})=>[(0,a.num)(e,"shadowsTintX",0),(0,a.num)(e,"shadowsTintY",0),(0,a.num)(e,"shadows",0),0,(0,a.num)(e,"midsTintX",0),(0,a.num)(e,"midsTintY",0),(0,a.num)(e,"mids",0),0,(0,a.num)(e,"highsTintX",0),(0,a.num)(e,"highsTintY",0),(0,a.num)(e,"highs",0)]}),(0,a.defineShaderEffect)({type:"kadr.effect.mask",name:"Shape Mask",keywords:["mask","shape","ellipse","vignette mask"],category:O,params:[{key:"shape",label:"Shape",type:"select",default:"ellipse",options:[{value:"ellipse",label:"Ellipse"},{value:"rectangle",label:"Rectangle"},{value:"linear",label:"Linear"},{value:"mirror",label:"Band"}]},(0,a.numberParam)("x","Center X",.5,0,1,.01),(0,a.numberParam)("y","Center Y",.5,0,1,.01),(0,a.numberParam)("width","Width",.6,.01,2,.01),(0,a.numberParam)("height","Height",.6,.01,2,.01),(0,a.numberParam)("rotation","Rotation, °",0,-180,180,1),(0,a.numberParam)("feather","Feather",.05,0,.5,.005),{key:"invert",label:"Invert",type:"boolean",default:!1}],wgsl:F(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let res = fx.resolution;
    // Kadr's y axis points up
    let center = vec2f(P0().y, 1.0 - P0().z) * res;
    let size = vec2f(P0().w, P1().x) * res;
    let p = rotate2(uv * res - center, P1().y);
    let shape = P0().x;
    var sd = 0.0;
    if (shape < 0.5) {
        let r = min(size.x, size.y) * 0.5;
        sd = (length(p / (size * 0.5)) - 1.0) * r;
    } else if (shape < 1.5) {
        let q = abs(p) - size * 0.5;
        sd = max(q.x, q.y);
    } else if (shape < 2.5) {
        sd = -p.y;
    } else {
        sd = abs(p.y) - size.y * 0.5;
    }
    let f = max(0.75, P1().z * min(res.x, res.y) * 1.5);
    var m = 1.0 - smoothstep(-f, f, sd);
    if (P1().w > 0.5) { m = 1.0 - m; }
    return vec4f(c.rgb, c.a * m);
}`),pack:({p:e})=>[Math.max(0,["ellipse","rectangle","linear","mirror"].indexOf(String(e.shape??"ellipse"))),(0,a.num)(e,"x",.5),(0,a.num)(e,"y",.5),(0,a.num)(e,"width",.6),(0,a.num)(e,"height",.6),(0,a.num)(e,"rotation",0)*Math.PI/180,(0,a.num)(e,"feather",.05),(0,a.bool)(e,"invert")]})],U=`
// Patterns in a fixed 1080-line frame: the preview renders smaller than the export (scanlines, grain, dots,
// pixels and edges had another size there).
fn pe_res() -> vec2f { return vec2f(1080.0 * aspect(), 1080.0); }
fn pe_px() -> vec2f { return vec2f(1.0) / pe_res(); }
fn pe_m1(x: f32) -> f32 { let t = fract(x * 0.5) * 2.0; return select(t, 2.0 - t, t > 1.0); }
fn pe_mirror(uv: vec2f) -> vec2f { return vec2f(pe_m1(uv.x), pe_m1(uv.y)); }
fn S(uv: vec2f) -> vec4f { return src(pe_mirror(uv)); }
fn pe_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x), mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn pe_fbm(p: vec2f) -> f32 {
    var s = 0.0;
    var a = 0.5;
    var q = p;
    for (var i = 0; i < 4; i++) {
        s += a * pe_noise(q);
        q = q * 2.03 + vec2f(1.7, 9.2);
        a *= 0.5;
    }
    return s;
}
fn pe_centered(uv: vec2f) -> vec2f { return (uv - vec2f(0.5)) * vec2f(aspect(), 1.0); }
fn pe_scale(uv: vec2f, c: vec2f, s: f32) -> vec2f {
    let a = aspect();
    return c + ((uv - c) * vec2f(a, 1.0) / max(s, 0.0001)) / vec2f(a, 1.0);
}
fn pe_rot(uv: vec2f, ang: f32) -> vec2f {
    let a = aspect();
    let q = rotate2((uv - vec2f(0.5)) * vec2f(a, 1.0), -ang);
    return q / vec2f(a, 1.0) + vec2f(0.5);
}
fn pe_screen(a: vec3f, b: vec3f) -> vec3f { return vec3f(1.0) - (vec3f(1.0) - clamp(a, vec3f(0.0), vec3f(1.0))) * (vec3f(1.0) - clamp(b, vec3f(0.0), vec3f(1.0))); }
fn pe_hsv(h: f32, s: f32, v: f32) -> vec3f {
    let k = vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0);
    let p = abs(fract(vec3f(h) + k) * 6.0 - vec3f(3.0));
    return v * mix(vec3f(1.0), clamp(p - vec3f(1.0), vec3f(0.0), vec3f(1.0)), s);
}
fn pe_hue_rotate(c: vec3f, a: f32) -> vec3f {
    let k = vec3f(0.57735);
    let ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
fn pe_bright(uv: vec2f, th: f32) -> vec3f { let c = S(uv).rgb; return max(c - vec3f(th), vec3f(0.0)) / max(1.0 - th, 0.01); }
fn pe_disc(i: i32, n: i32) -> vec2f {
    let ang = f32(i) * 2.3998;
    let r = sqrt((f32(i) + 0.5) / f32(n));
    return vec2f(cos(ang) / aspect(), sin(ang)) * r;
}
fn pe_edge(uv: vec2f) -> f32 {
    let px = pe_px();
    let l = luma(S(uv - vec2f(px.x, 0.0)).rgb);
    let r = luma(S(uv + vec2f(px.x, 0.0)).rgb);
    let u = luma(S(uv - vec2f(0.0, px.y)).rgb);
    let d = luma(S(uv + vec2f(0.0, px.y)).rgb);
    return length(vec2f(r - l, d - u));
}
`,G=e=>`${U}${e}`,H={shake:G(`
fn effect(uv: vec2f) -> vec4f {
    let amp = P0().x;
    let freq = P0().y;
    let rot = radians(P0().z);
    let zoom = P0().w;
    let mode = P1().x;
    let t = fx.time;
    let env = select(1.0, exp(-t * P1().y), P1().y > 0.0);
    var off = vec2f(0.0);
    var ang = 0.0;
    var kick = 0.0;
    if (mode < 0.5) {
        off = vec2f(vnoise(t * freq), vnoise(t * freq + 17.3)) * amp;
        ang = vnoise(t * freq * 0.7 + 5.1) * rot;
    } else if (mode < 1.5) {
        kick = exp(-fract(t * freq) * 7.0);
        off = vec2f(vnoise(t * 31.0), vnoise(t * 31.0 + 3.0)) * amp * kick;
        ang = vnoise(t * 23.0) * rot * kick;
    } else if (mode < 2.5) {
        off = vec2f(sin(t * freq * 6.2831853) * amp * 0.35, -abs(sin(t * freq * 3.14159265)) * amp);
        ang = sin(t * freq * 6.2831853) * rot;
    } else {
        let st = floor(t * freq);
        off = (vec2f(hash11(st), hash11(st + 9.1)) - vec2f(0.5)) * 2.0 * amp;
        ang = (hash11(st + 4.2) - 0.5) * 2.0 * rot;
    }
    let s = 1.0 + zoom + kick * zoom * 2.0 + amp * 1.2;
    return S(pe_scale(pe_rot(uv - off * env, ang * env), vec2f(0.5), s));
}`),pulse:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let rate = P0().y;
    let mode = P0().z;
    let t = fx.time;
    var k = 0.0;
    if (mode < 0.5) { k = exp(-fract(t * rate) * 6.0); }
    else if (mode < 1.5) { k = 0.5 - 0.5 * cos(t * rate * 6.2831853); }
    else if (mode < 2.5) { k = ease_in_out_sine(fx.progress); }
    else { k = abs(sin(t * rate * 3.14159265)); }
    let s = 1.0 + amt * k;
    var acc = vec4f(0.0);
    for (var i = 0; i < 8; i++) {
        acc += S(pe_scale(uv, vec2f(0.5), s * (1.0 - P0().w * amt * k * f32(i) / 7.0 * 0.3)));
    }
    return acc / 8.0;
}`),blur:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let mode = P0().y;
    var acc = vec4f(0.0);
    if (mode < 0.5) {
        for (var i = 0; i < 16; i++) { acc += S(pe_scale(uv, vec2f(0.5), 1.0 + amt * 0.25 * f32(i) / 15.0)); }
        return acc / 16.0;
    }
    if (mode < 1.5) {
        for (var i = 0; i < 16; i++) { acc += S(pe_rot(uv, (f32(i) / 15.0 - 0.5) * amt * 0.3)); }
        return acc / 16.0;
    }
    if (mode < 2.5) {
        let a = radians(P0().z);
        let d = vec2f(cos(a), sin(a)) * amt * 0.06;
        for (var i = 0; i < 16; i++) { acc += S(uv + d * (f32(i) / 15.0 - 0.5)); }
        return acc / 16.0;
    }
    if (mode < 3.5) {
        let band = max(P1().x, 0.01);
        let k = smoothstep(band, band + 0.25, abs(uv.y - P0().w)) * amt;
        for (var i = 0; i < 16; i++) { acc += S(uv + pe_disc(i, 16) * 0.014 * k); }
        let col = acc / 16.0;
        let y = luma(col.rgb);
        return vec4f(mix(vec3f(y), col.rgb, 1.0 + 0.35 * amt), col.a);
    }
    if (mode < 4.5) {
        let base = S(uv);
        for (var i = 0; i < 16; i++) { acc += S(uv + pe_disc(i, 16) * 0.025); }
        let soft = acc / 16.0;
        return vec4f(mix(base.rgb, pe_screen(base.rgb, soft.rgb * 0.75), amt), base.a);
    }
    for (var i = 0; i < 24; i++) { acc += S(uv + pe_disc(i, 24) * 0.022 * amt); }
    return acc / 24.0;
}`),glow:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let th = P0().y;
    let mode = P0().z;
    let size = P0().w;
    let base = S(uv);
    var g = vec3f(0.0);
    if (mode < 0.5) {
        for (var i = 0; i < 24; i++) { g += pe_bright(uv + pe_disc(i, 24) * 0.045 * size, th); }
        return vec4f(pe_screen(base.rgb, g / 24.0 * 2.0 * amt), base.a);
    }
    if (mode < 1.5) {
        let e = clamp(pe_edge(uv) * 6.0, 0.0, 1.0);
        var halo = 0.0;
        for (var i = 0; i < 12; i++) { halo += pe_edge(uv + pe_disc(i, 12) * 0.008 * size); }
        let lit = (e * 1.4 + clamp(halo / 12.0 * 7.0, 0.0, 1.0) * 0.8) * amt;
        return vec4f(base.rgb * (1.0 - 0.55 * amt) + P2().rgb * lit, base.a);
    }
    if (mode < 2.5) {
        for (var k = 0; k < 4; k++) {
            let ang = f32(k) * 0.785398 + 0.3927;
            let d = vec2f(cos(ang) / aspect(), sin(ang));
            for (var i = 1; i < 12; i++) {
                let f = f32(i) / 12.0;
                g += (pe_bright(uv + d * f * 0.09 * size, th) + pe_bright(uv - d * f * 0.09 * size, th)) * (1.0 - f);
            }
        }
        return vec4f(pe_screen(base.rgb, g / 24.0 * 1.8 * amt), base.a);
    }
    if (mode < 3.5) {
        for (var i = 1; i < 24; i++) {
            let f = f32(i) / 24.0;
            let o = vec2f(f * 0.28 * size, 0.0);
            g += (pe_bright(uv + o, th) + pe_bright(uv - o, th)) * (1.0 - f);
        }
        return vec4f(pe_screen(base.rgb, g / 24.0 * vec3f(0.35, 0.6, 1.0) * 2.4 * amt), base.a);
    }
    for (var i = 0; i < 16; i++) { g += pe_bright(uv + pe_disc(i, 16) * 0.014 * size, th); }
    return vec4f(pe_screen(base.rgb, g / 16.0 * vec3f(1.0, 0.28, 0.1) * 1.6 * amt), base.a);
}`),chroma:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let mode = P0().y;
    let t = fx.time * P0().z;
    let a = S(uv).a;
    if (mode < 0.5) {
        let c = uv - vec2f(0.5);
        let k = amt * 0.025 * (0.3 + dot(c, c) * 3.0);
        return vec4f(S(uv + c * k).r, S(uv).g, S(uv - c * k).b, a);
    }
    if (mode < 1.5) {
        let w = amt * 0.012;
        let r = S(uv + vec2f(sin(uv.y * 28.0 + t * 4.0) * w, 0.0)).r;
        let g = S(uv + vec2f(sin(uv.y * 28.0 + t * 4.0 + 2.1) * w, 0.0)).g;
        let b = S(uv + vec2f(sin(uv.y * 28.0 + t * 4.0 + 4.2) * w, 0.0)).b;
        return vec4f(r, g, b, a);
    }
    let o = vec2f(amt * 0.018, amt * 0.006);
    let l = S(uv - o).rgb;
    let m = S(uv).rgb;
    let r2 = S(uv + o).rgb;
    let prism = vec3f(l.r, m.g, r2.b);
    return vec4f(mix(m, prism * 1.05, clamp(amt, 0.0, 1.0)), a);
}`),glitch:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let rate = max(P0().y, 0.1);
    let mode = P0().z;
    let tick = floor(fx.time * rate * 12.0);
    let burst = step(0.45, hash11(floor(fx.time * rate * 3.0) + 0.37));
    let k = amt * (0.35 + 0.65 * burst);
    if (mode < 0.5) {
        let row = floor(uv.y * 30.0);
        let on = step(0.7, hash12(vec2f(row, tick)));
        let q = uv + vec2f((hash12(vec2f(row * 1.3, tick)) - 0.5) * 0.12 * k * on, 0.0);
        let s = 0.012 * k;
        return vec4f(S(q + vec2f(s, 0.0)).r, S(q).g, S(q - vec2f(s, 0.0)).b, S(q).a);
    }
    if (mode < 1.5) {
        let cell = floor(uv * vec2f(16.0, 9.0) * max(P0().w, 0.3));
        let on = step(1.0 - 0.35 * k, hash12(cell + vec2f(tick * 0.31, tick * 0.17)));
        let off = (vec2f(hash12(cell + 4.0), hash12(cell + 8.0)) - vec2f(0.5)) * 0.15 * on;
        let c = S(uv + off);
        return vec4f(mix(c.rgb, c.gbr, on * 0.6), c.a);
    }
    if (mode < 2.5) {
        let line = floor(uv.y * 160.0);
        let band = step(0.65, pe_noise(vec2f(uv.y * 10.0, tick * 0.5)));
        let shift = (hash12(vec2f(line, tick)) - 0.5) * 0.16 * k * (0.2 + band);
        let c = S(uv + vec2f(shift, 0.0));
        let scan = 1.0 - 0.2 * k * step(0.5, fract(uv.y * 135.0));
        return vec4f(c.rgb * scan, c.a);
    }
    if (mode < 3.5) {
        let base = S(uv);
        var acc = base;
        var n = 1.0;
        for (var i = 1; i < 12; i++) {
            let q = uv - vec2f(0.0, f32(i) * 0.01 * k);
            let s = S(q);
            let w = step(0.5, hash12(floor(q * vec2f(40.0, 22.0)) + tick)) * k;
            acc += s * w;
            n += w;
        }
        return acc / n;
    }
    if (mode < 4.5) {
        let row = floor(uv.y * 60.0);
        let drop = step(1.0 - 0.25 * k, hash12(vec2f(row, tick)));
        let nz = hash12(floor(uv * vec2f(192.0, 108.0)) + tick);
        let c = S(uv + vec2f(drop * 0.05, 0.0));
        let snow = mix(c.rgb, vec3f(nz), drop * 0.8 + 0.12 * k);
        return vec4f(snow * (1.0 - 0.3 * k * step(0.92, hash11(tick))), c.a);
    }
    let base = S(uv);
    var acc = base;
    var n = 1.0;
    for (var i = 1; i < 16; i++) {
        let s = S(uv - vec2f(0.0, f32(i) * 0.008 * k));
        let w = smoothstep(0.5, 0.85, luma(s.rgb));
        acc += s * w;
        n += w;
    }
    return acc / n;
}`),vhs:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let mode = P0().w;
    let t = fx.time;
    let wob = sin(uv.y * 90.0 + t * 25.0) * 0.0015 * amt + (pe_noise(vec2f(uv.y * 40.0, t * 3.0)) - 0.5) * 0.004 * amt;
    var q = vec2f(uv.x + wob, uv.y);
    var track = 0.0;
    if (mode > 0.5 && mode < 1.5) {
        let y0 = fract(t * 0.35);
        track = exp(-pow((uv.y - y0) * 14.0, 2.0)) * amt;
        q.x += track * 0.03 * sin(uv.y * 300.0 + t * 50.0);
    }
    let bleed = P0().z * 0.006;
    let r = S(q + vec2f(bleed, 0.0)).r;
    let g = S(q).g;
    let b = S(q - vec2f(bleed, 0.0)).b;
    var col = vec3f(r, g, b);
    let y = luma(col);
    col = mix(col, vec3f(y), 0.15 * amt);
    let nz = hash12(floor(uv * vec2f(192.0, 108.0)) + floor(fx.time * 30.0)) - 0.5;
    col += vec3f(nz * P0().y * 0.18);
    col = mix(col, vec3f(hash12(uv * 900.0 + floor(fx.time * 30.0))), clamp(track, 0.0, 0.85));
    if (mode > 1.5 && mode < 2.5) {
        col = vec3f(y * 0.25, y * 1.05, y * 0.3) * 1.2 + vec3f(nz * 0.15);
    }
    if (mode > 2.5) {
        col = mix(col, col * vec3f(1.05, 1.02, 0.92), amt) * (1.0 + 0.08 * amt);
    }
    let scan = 1.0 - 0.12 * amt * step(0.5, fract(uv.y * 135.0));
    let c = pe_centered(uv);
    let vig = 1.0 - 0.35 * amt * dot(c, c);
    return vec4f(col * scan * vig, S(q).a);
}`),film:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let mode = P0().w;
    let tick = floor(fx.time * 24.0);
    var q = uv;
    if (mode > 1.5 && mode < 4.5) {
        let wv = select(0.004, 0.0015, mode > 2.5 && mode < 3.5);
        q += (vec2f(hash11(tick), hash11(tick + 3.3)) - vec2f(0.5)) * wv * amt;
    }
    let base = S(q);
    var col = base.rgb;
    if (mode > 0.5 && mode < 1.5) {
        let y = luma(col);
        col = mix(col, vec3f(y * 1.07, y * 0.9, y * 0.68), 0.8 * amt);
    }
    if (mode > 1.5 && mode < 2.5) {
        col = mix(col, col * vec3f(1.08, 1.0, 0.82), amt);
    }
    let g = (hash12(floor(uv * pe_res() / 3.0) + vec2f(tick * 1.7, tick)) - 0.5) * P0().y;
    col += vec3f(g * 0.22 * (1.2 - luma(col)));
    let dust = step(0.9975, hash12(floor(uv * pe_res() / 3.0) + tick)) * P0().z;
    let sx = hash11(tick * 1.31);
    let scratch = exp(-pow((uv.x - sx) * pe_res().x / 1.6, 2.0)) * step(0.6, hash11(tick + 2.0)) * P0().z;
    col = col - vec3f(dust * 0.75) + vec3f(scratch * 0.3);
    let flick = 1.0 + (hash11(tick + 5.0) - 0.5) * 0.12 * amt * select(0.3, 1.0, mode > 0.5);
    col *= flick;
    let c = pe_centered(uv);
    var vig = 1.0 - select(0.15, 0.55, mode > 0.5) * amt * dot(c, c);
    if (mode > 4.5) {
        let e = max(abs(uv.x - 0.5) * 2.0, abs(uv.y - 0.5) * 2.0);
        let burn = smoothstep(0.7, 1.0, e + (pe_fbm(uv * 6.0 + fx.time * 0.3) - 0.5) * 0.25);
        col = mix(col, vec3f(1.0, 0.45, 0.1) * 0.9, burn * amt * 0.8);
        vig = 1.0 - 0.3 * amt * dot(c, c);
    }
    return vec4f(col * vig, base.a);
}`),leak:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let sp = P0().y;
    let mode = P0().z;
    let t = fx.time * sp;
    let base = S(uv);
    var light = vec3f(0.0);
    if (mode < 0.5) {
        let n = pe_fbm(uv * vec2f(1.6, 1.1) + vec2f(t * 0.25, -t * 0.1));
        let m = smoothstep(0.45, 0.85, n + 0.35 * (1.0 - uv.x));
        light = P2().rgb * m * 1.3;
    } else if (mode < 1.5) {
        let d = length(pe_centered(uv) - vec2f(-0.7, -0.45));
        let m = smoothstep(1.1, 0.0, d + (pe_noise(uv * 3.0 + t) - 0.5) * 0.25);
        light = P2().rgb * m * m * 1.6;
    } else if (mode < 2.5) {
        let a = radians(P0().w);
        let x = dot(uv - vec2f(0.5), vec2f(cos(a), sin(a)));
        let pos = fract(t * 0.25) * 2.2 - 1.1;
        light = P2().rgb * (exp(-pow((x - pos) * 9.0, 2.0)) * 1.3 + exp(-pow((x - pos) * 40.0, 2.0)) * 0.8);
    } else if (mode < 3.5) {
        let f = pe_noise(vec2f(t * 6.0, 0.0));
        light = P2().rgb * smoothstep(0.35, 0.9, f) * (0.6 + 0.4 * uv.y);
    } else {
        let n = pe_fbm(uv * 1.3 + vec2f(t * 0.2, t * 0.05));
        let m = smoothstep(0.4, 0.9, n + 0.3 * uv.x);
        light = pe_hsv(fract(uv.x * 0.6 + uv.y * 0.3 + t * 0.08), 0.75, 1.0) * m * 1.2;
    }
    return vec4f(pe_screen(base.rgb, light * amt), base.a);
}`),flash:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let rate = max(P0().y, 0.1);
    let mode = P0().z;
    let t = fx.time;
    let base = S(uv);
    var k = 0.0;
    var col = P2().rgb;
    if (mode < 0.5) { k = exp(-t * rate * 6.0); }
    else if (mode < 1.5) { k = step(0.5, fract(t * rate)) * 0.85; }
    else if (mode < 2.5) { k = exp(-fract(t * rate) * 14.0) * step(fract(t * rate * 0.5), 0.5); }
    else {
        k = exp(-fract(t * rate) * 5.0);
        col = pe_hsv(fract(floor(t * rate) * 0.17), 0.7, 1.0);
    }
    return vec4f(mix(base.rgb, pe_screen(base.rgb, col), clamp(k * amt, 0.0, 1.0)), base.a);
}`),style:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let size = max(P0().y, 1.0);
    let mode = P0().z;
    let base = S(uv);
    var col = base.rgb;
    if (mode < 0.5) {
        let c = uv - vec2f(0.5);
        let q = vec2f(0.5) + c * (1.0 + dot(c, c) * 0.25 * amt);
        col = S(q).rgb;
        let px = q * pe_res() / 4.0;
        let mask = vec3f(
            0.8 + 0.2 * step(fract(px.x / 3.0), 0.34),
            0.8 + 0.2 * step(abs(fract(px.x / 3.0) - 0.5), 0.17),
            0.8 + 0.2 * step(0.66, fract(px.x / 3.0)));
        let scan = 0.75 + 0.25 * sin(px.y * 3.14159265 / 2.0);
        let edge = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
        col = mix(base.rgb, col * mask * scan * 1.25 * edge, amt);
    } else if (mode < 1.5) {
        let cells = pe_res() / size;
        let q = (floor(uv * cells) + vec2f(0.5)) / cells;
        let c = S(q).rgb;
        let lv = max(P0().w, 2.0);
        col = mix(base.rgb, floor(c * lv + vec3f(0.5)) / lv, amt);
    } else if (mode < 2.5) {
        let a = 0.785398;
        let p = rotate2(uv * pe_res() / size, a);
        let cell = fract(p) - vec2f(0.5);
        let y = luma(S(uv).rgb);
        let dot_ = step(length(cell), sqrt(1.0 - y) * 0.62);
        col = mix(base.rgb, mix(vec3f(0.97, 0.96, 0.92), P2().rgb, dot_), amt);
    } else if (mode < 3.5) {
        let lv = max(P0().w, 2.0);
        col = mix(base.rgb, floor(base.rgb * lv + vec3f(0.5)) / lv, amt);
    } else if (mode < 4.5) {
        let y = luma(base.rgb);
        col = mix(base.rgb, mix(P2().rgb, P3().rgb, smoothstep(0.05, 0.95, y)), amt);
    } else if (mode < 5.5) {
        let y = luma(base.rgb);
        let heat = select(select(mix(vec3f(1.0, 0.0, 0.0), vec3f(1.0, 1.0, 0.0), (y - 0.66) * 3.0), mix(vec3f(0.6, 0.0, 0.8), vec3f(1.0, 0.0, 0.0), (y - 0.33) * 3.0), y < 0.66), mix(vec3f(0.0, 0.0, 0.35), vec3f(0.6, 0.0, 0.8), y * 3.0), y < 0.33);
        col = mix(base.rgb, heat, amt);
    } else if (mode < 6.5) {
        let y = luma(base.rgb);
        let nz = hash12(floor(uv * pe_res() / 2.0) + floor(fx.time * 30.0)) - 0.5;
        let c = pe_centered(uv);
        let g = vec3f(0.15, 1.0, 0.25) * (y * 1.6 + nz * 0.25) * (1.0 - 0.9 * dot(c, c));
        col = mix(base.rgb, g, amt);
    } else if (mode < 7.5) {
        let lv = 4.0;
        let p = floor(base.rgb * lv + vec3f(0.5)) / lv;
        let e = smoothstep(0.08, 0.2, pe_edge(uv));
        let cell = fract(rotate2(uv * pe_res() / 6.0, 0.4)) - vec2f(0.5);
        let dots = step(length(cell), 0.25) * step(luma(base.rgb), 0.55) * 0.12;
        col = mix(base.rgb, (p - vec3f(dots)) * (1.0 - e), amt);
    } else if (mode < 8.5) {
        let e = pe_edge(uv);
        let y = luma(base.rgb);
        let pencil = vec3f(1.0 - clamp(e * 5.0, 0.0, 1.0)) * (0.9 + 0.1 * y);
        let paper = vec3f(0.98, 0.96, 0.9);
        col = mix(base.rgb, pencil * paper, amt);
    } else if (mode < 9.5) {
        let px = pe_px();
        let e = luma(S(uv - px).rgb) - luma(S(uv + px).rgb);
        col = mix(base.rgb, vec3f(0.5 + e * 2.0), amt);
    } else {
        let y = luma(base.rgb);
        let bayer = fract(sin(dot(floor(uv * pe_res() / size), vec2f(12.9898, 78.233))) * 43758.5453);
        let on = step(bayer, y);
        col = mix(base.rgb, mix(P3().rgb, P2().rgb, on), amt);
    }
    return vec4f(col, base.a);
}`),mirror:G(`
fn effect(uv: vec2f) -> vec4f {
    let mode = P0().x;
    let n = max(P0().y, 2.0);
    var q = uv;
    if (mode < 0.5) { q = vec2f(select(uv.x, 1.0 - uv.x, uv.x > 0.5), uv.y); }
    else if (mode < 1.5) { q = vec2f(uv.x, select(uv.y, 1.0 - uv.y, uv.y > 0.5)); }
    else if (mode < 2.5) { q = vec2f(select(uv.x, 1.0 - uv.x, uv.x > 0.5), select(uv.y, 1.0 - uv.y, uv.y > 0.5)); }
    else if (mode < 3.5) {
        let c = pe_centered(uv);
        let r = length(c) / max(P0().w, 0.2);
        var a = atan2(c.y, c.x) + fx.time * P0().z;
        let seg = 6.2831853 / n;
        a = abs((a - seg * floor(a / seg)) - seg * 0.5);
        q = vec2f(cos(a), sin(a)) * r / vec2f(aspect(), 1.0) + vec2f(0.5);
    } else {
        q = fract(uv * n);
    }
    return S(q);
}`),distort:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let t = fx.time * P0().y;
    let mode = P0().z;
    let sc = max(P0().w, 0.1);
    let c = pe_centered(uv);
    let r = length(c);
    var q = uv;
    if (mode < 0.5) {
        q = c / (1.0 + amt * r * r) / vec2f(aspect(), 1.0) + vec2f(0.5);
    } else if (mode < 1.5) {
        let k = 1.0 - amt * 0.6 * smoothstep(0.5 * sc, 0.0, r);
        q = c * k / vec2f(aspect(), 1.0) + vec2f(0.5);
    } else if (mode < 2.5) {
        let k = 1.0 + amt * 0.8 * smoothstep(0.5 * sc, 0.0, r);
        q = c * k / vec2f(aspect(), 1.0) + vec2f(0.5);
    } else if (mode < 3.5) {
        let a = amt * 4.0 * smoothstep(0.6 * sc, 0.0, r) + t * 0.0;
        q = rotate2(c, a) / vec2f(aspect(), 1.0) + vec2f(0.5);
    } else if (mode < 4.5) {
        q = uv + vec2f(sin(uv.y * 12.0 / sc + t * 3.0), cos(uv.x * 10.0 / sc + t * 2.5)) * 0.012 * amt;
    } else if (mode < 5.5) {
        let w = sin(r * 40.0 / sc - t * 6.0) * 0.01 * amt;
        q = uv + normalize(c + vec2f(0.0001)) / vec2f(aspect(), 1.0) * w;
    } else if (mode < 6.5) {
        let w = vec2f(pe_fbm(uv * 3.0 / sc + vec2f(t * 0.4, 0.0)), pe_fbm(uv * 3.0 / sc + vec2f(5.2, t * 0.4))) - vec2f(0.5);
        q = uv + w * 0.06 * amt;
    } else if (mode < 7.5) {
        let cell = floor(uv * vec2f(12.0, 7.0) / sc);
        let o = (vec2f(hash12(cell), hash12(cell + 3.1)) - vec2f(0.5)) * 0.03 * amt;
        q = uv + o;
    } else {
        let w = sin(t * 6.0) * exp(-fract(t * 0.5) * 2.0);
        q = vec2f(0.5) + (uv - vec2f(0.5)) * vec2f(1.0 + 0.06 * amt * w, 1.0 - 0.06 * amt * w) + vec2f(sin(uv.y * 8.0 + t * 5.0) * 0.006 * amt, 0.0);
    }
    return S(q);
}`),frame:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let mode = P0().z;
    let base = S(uv);
    var col = base.rgb;
    let c = pe_centered(uv);
    if (mode < 0.5 || mode > 3.5) {
        let want = max(P0().y, 1.0);
        let bar = clamp((1.0 - aspect() / want) * 0.5, 0.0, 0.45) * amt;
        let inside = smoothstep(bar, bar + 0.002, uv.y) * smoothstep(bar, bar + 0.002, 1.0 - uv.y);
        col = col * inside;
        if (mode > 3.5) {
            var g = vec3f(0.0);
            for (var i = 1; i < 16; i++) {
                let f = f32(i) / 16.0;
                g += (pe_bright(uv + vec2f(f * 0.25, 0.0), 0.75) + pe_bright(uv - vec2f(f * 0.25, 0.0), 0.75)) * (1.0 - f);
            }
            col = pe_screen(col * vec3f(0.96, 0.99, 1.04), g / 16.0 * vec3f(0.3, 0.55, 1.0) * 1.6) * inside;
        }
    } else if (mode < 1.5) {
        let v = smoothstep(0.85 + P0().w * 0.4, 0.25, length(c * vec2f(0.8, 1.0)));
        col = col * mix(1.0, v, amt);
    } else if (mode < 2.5) {
        let e = length(c * vec2f(1.0 / aspect(), 1.0) * vec2f(1.0, 1.25));
        let v = 1.0 - smoothstep(0.42, 0.42 + 0.1 + P0().w * 0.3, e);
        col = col * mix(1.0, v, amt);
    } else {
        let smudge = smoothstep(0.55, 0.85, pe_fbm(uv * vec2f(4.0, 3.0) + vec2f(3.1, 1.7)));
        var lit = vec3f(0.0);
        for (var i = 0; i < 12; i++) { lit += pe_bright(uv + pe_disc(i, 12) * 0.12, 0.6); }
        col = pe_screen(col, lit / 12.0 * smudge * 2.2 * amt + vec3f(smudge * 0.05 * amt));
    }
    return vec4f(col, base.a);
}`),weather:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let t = fx.time * P0().y;
    let mode = P0().z;
    let size = max(P0().w, 0.2);
    let base = S(uv);
    var col = base.rgb;
    let a = aspect();
    if (mode < 0.5) {
        var r = 0.0;
        for (var l = 0; l < 3; l++) {
            let fl = f32(l);
            let sc = vec2f(80.0 + fl * 40.0, 6.0 + fl * 3.0) / size;
            let p = vec2f(uv.x * a + uv.y * 0.15, uv.y + t * (1.6 + fl * 0.5)) * sc;
            let cell = floor(p);
            let f = fract(p);
            let on = step(0.92, hash12(cell + fl * 7.0));
            r += on * smoothstep(0.08, 0.0, abs(f.x - 0.5)) * smoothstep(0.0, 0.5, f.y) * smoothstep(1.0, 0.5, f.y) * (0.5 + 0.2 * fl);
        }
        col = mix(col * (1.0 - 0.15 * amt), vec3f(0.85, 0.9, 1.0), clamp(r * amt, 0.0, 0.8));
    } else if (mode < 1.5) {
        var s = 0.0;
        for (var l = 0; l < 3; l++) {
            let fl = f32(l);
            let sc = (8.0 + fl * 6.0) / size;
            let p = vec2f(uv.x * a + sin(t * 0.7 + fl) * 0.1, uv.y - t * (0.12 + fl * 0.06)) * sc;
            let cell = floor(p);
            let f = fract(p) - vec2f(0.5) - (vec2f(hash12(cell), hash12(cell + 1.3)) - vec2f(0.5)) * 0.6;
            s += smoothstep(0.08 - fl * 0.015, 0.0, length(f)) * step(0.55, hash12(cell + 5.0));
        }
        col = mix(col, vec3f(1.0), clamp(s * amt, 0.0, 1.0));
    } else if (mode < 2.5) {
        var d = 0.0;
        for (var l = 0; l < 2; l++) {
            let fl = f32(l);
            let p = (vec2f(uv.x * a, uv.y) + vec2f(t * 0.02 * (fl + 1.0), -t * 0.01)) * (14.0 + fl * 10.0) / size;
            let cell = floor(p);
            let f = fract(p) - vec2f(0.5);
            d += smoothstep(0.06, 0.0, length(f)) * step(0.85, hash12(cell + fl * 3.0)) * (0.5 + 0.5 * sin(t * 2.0 + hash12(cell) * 6.0));
        }
        col = pe_screen(col, vec3f(1.0, 0.95, 0.85) * d * 0.7 * amt);
    } else if (mode < 3.5) {
        let p = vec2f(uv.x * a, uv.y) * 18.0 / size;
        let cell = floor(p);
        let f = fract(p) - vec2f(0.5);
        let on = step(0.88, hash12(cell));
        let tw = pow(0.5 + 0.5 * sin(t * 6.0 + hash12(cell + 2.0) * 30.0), 6.0);
        let star = (smoothstep(0.04, 0.0, abs(f.x)) * smoothstep(0.35, 0.0, abs(f.y)) + smoothstep(0.04, 0.0, abs(f.y)) * smoothstep(0.35, 0.0, abs(f.x))) * on * tw;
        col = pe_screen(col, vec3f(1.0, 0.95, 0.8) * star * amt * 1.5);
    } else if (mode < 4.5) {
        var b = vec3f(0.0);
        for (var i = 0; i < 18; i++) {
            let fi = f32(i);
            let cpos = vec2f(fract(hash11(fi * 3.1) + t * 0.02 * (hash11(fi) - 0.5)), fract(hash11(fi * 7.7) - t * 0.015));
            let rr = (0.03 + 0.06 * hash11(fi * 1.9)) * size;
            let dd = length((uv - cpos) * vec2f(a, 1.0));
            b += pe_hsv(hash11(fi * 4.3), 0.35, 1.0) * (1.0 - smoothstep(rr * 0.85, rr, dd)) * 0.35;
        }
        col = pe_screen(col, b * amt);
    } else {
        let f = pe_fbm(uv * vec2f(2.0, 3.0) / size + vec2f(t * 0.05, 0.0));
        let fog = smoothstep(0.2, 0.9, f + uv.y * 0.35);
        col = mix(col, vec3f(0.86, 0.88, 0.9), fog * amt * 0.7);
    }
    return vec4f(col, base.a);
}`),party:G(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let t = fx.time * P0().y;
    let mode = P0().z;
    let base = S(uv);
    var col = base.rgb;
    let a = aspect();
    if (mode < 0.5) {
        var l = vec3f(0.0);
        for (var i = 0; i < 6; i++) {
            let fi = f32(i);
            let cpos = vec2f(0.5 + 0.45 * sin(t * (0.6 + fi * 0.13) + fi * 2.1), 0.5 + 0.4 * cos(t * (0.5 + fi * 0.11) + fi * 1.3));
            let d = length((uv - cpos) * vec2f(a, 1.0));
            l += pe_hsv(fract(fi / 6.0 + t * 0.05), 0.8, 1.0) * smoothstep(0.32, 0.0, d);
        }
        col = col * (1.0 - 0.45 * amt) + col * l * 1.4 * amt + l * 0.15 * amt;
    } else if (mode < 1.5) {
        let k = 0.5 + 0.5 * sin(t * 6.2831853);
        col = mix(col, pe_screen(col, pe_hsv(fract(t * 0.1), 0.85, 1.0) * 0.6), k * amt);
    } else if (mode < 2.5) {
        col = mix(col, pe_hue_rotate(col, t * 1.5), amt);
    } else if (mode < 3.5) {
        var b = vec3f(0.0);
        for (var i = 0; i < 5; i++) {
            let fi = f32(i);
            let ang = sin(t * (0.7 + fi * 0.2) + fi) * 0.9 + 1.5708;
            let origin = vec2f(0.2 + fi * 0.15, 1.05);
            let dir = vec2f(cos(ang), -sin(ang));
            let rel = (uv - origin) * vec2f(a, 1.0);
            let dist = abs(rel.x * dir.y - rel.y * dir.x);
            b += pe_hsv(fract(fi * 0.21 + 0.5), 0.9, 1.0) * smoothstep(0.006, 0.0, dist) * step(0.0, dot(rel, dir));
            b += pe_hsv(fract(fi * 0.21 + 0.5), 0.9, 1.0) * smoothstep(0.04, 0.0, dist) * 0.25 * step(0.0, dot(rel, dir));
        }
        col = pe_screen(col * (1.0 - 0.3 * amt), b * amt);
    } else {
        let on = step(0.5, fract(t * 2.0));
        col = mix(col, col * pe_hsv(fract(floor(t * 2.0) * 0.23), 0.75, 1.3), on * amt);
    }
    return vec4f(col, base.a);
}`)},W="Lens",X="Camera",$="Blur",Z="Light",Y="Glitch",V="Retro",K="Film",j="Style",J="Distort",Q="Frame",ee="Weather",et="Party",ea=[s,g,u,d,h,k,b,w,M,_,A,z,f,...B,...[{id:"heartbeat",name:"Heartbeat",ru:"сердцебиение",family:"shake",category:X,base:[.004,1.2,.5,.05,1,0],strengthSlots:[0,3],speed:[1,1.2]},{id:"drunk",name:"Drunk",ru:"пьяная камера",family:"shake",category:X,base:[.02,.4,5,.06,0,0],strengthSlots:[0,2],speed:[1,.4]},{id:"bounce",name:"Bounce",ru:"прыжки",family:"shake",category:X,base:[.025,1.5,1,.04,2,0],strengthSlots:[0,2],speed:[1,1.5]},{id:"stepShake",name:"Glitch Shake",ru:"рывки",family:"shake",category:X,base:[.015,8,1.5,.03,3,0],strengthSlots:[0,2],speed:[1,8]},{id:"beatPulse",name:"Beat Pulse",ru:"пульс под бит",family:"pulse",category:X,base:[.12,2,0,.6],speed:[1,2]},{id:"breathe",name:"Breathe",ru:"дыхание",family:"pulse",category:X,base:[.05,.4,1,0],speed:[1,.4]},{id:"zoomBounce",name:"Zoom Bounce",ru:"зум-прыжок",family:"pulse",category:X,base:[.1,1.5,3,.3],speed:[1,1.5]},{id:"spinBlur",name:"Spin Blur",ru:"вращение",family:"blur",category:$,base:[1,1,0,.5]},{id:"motionBlur",name:"Motion Blur",ru:"смаз движения",family:"blur",category:$,base:[1,2,0,.5],params:[{key:"angle",label:"Angle, °",slot:2,default:0,min:0,max:180,step:1}]},{id:"softGlow",name:"Soft Glow",ru:"мягкое свечение",family:"blur",category:$,base:[.7,4,0,.5]},{id:"defocus",name:"Defocus",ru:"расфокус",family:"blur",category:$,base:[1,5,0,.5]},{id:"bloom",name:"Bloom",ru:"блум",family:"glow",category:Z,base:[.8,.6,0,1]},{id:"starFilter",name:"Star Filter",ru:"звёздный фильтр",family:"glow",category:Z,base:[1,.7,2,1]},{id:"anamorphicStreak",name:"Anamorphic Streak",ru:"анаморфный блик",family:"glow",category:Z,base:[1,.72,3,1]},{id:"halation",name:"Halation",ru:"ореол плёнки",family:"glow",category:K,base:[.8,.6,4,1]},{id:"rgbWave",name:"RGB Wave",ru:"RGB волна",family:"chroma",category:Y,base:[1,1,1],speed:[2,1]},{id:"prism",name:"Prism",ru:"призма",family:"chroma",category:Z,base:[1,2,1]},{id:"digitalGlitch",name:"Digital Glitch",ru:"цифровой глитч",family:"glitch",category:Y,base:[1,1,0,1],speed:[1,1]},{id:"blockGlitch",name:"Block Glitch",ru:"блоки",family:"glitch",category:Y,base:[1,1,1,1],speed:[1,1]},{id:"scanTear",name:"Scan Tear",ru:"разрыв строк",family:"glitch",category:Y,base:[1,1,2,1],speed:[1,1]},{id:"dataSmear",name:"Data Smear",ru:"датамош",family:"glitch",category:Y,base:[1,1,3,1],speed:[1,1]},{id:"signalLoss",name:"Signal Loss",ru:"потеря сигнала",family:"glitch",category:Y,base:[1,1,4,1],speed:[1,1]},{id:"pixelSort",name:"Pixel Sort",ru:"сортировка пикселей",family:"glitch",category:Y,base:[1,1,5,1],speed:[1,1]},{id:"vhsPro",name:"VHS Tape",ru:"кассета VHS",family:"vhs",category:V,base:[1,1,1,0]},{id:"vhsTracking",name:"VHS Tracking",ru:"трекинг VHS",family:"vhs",category:V,base:[1,1,1,1]},{id:"nightCam",name:"Night Cam",ru:"ночная камера",family:"vhs",category:V,base:[1,1.4,.6,2]},{id:"camcorder90s",name:"Camcorder 90s",ru:"камкордер 90-х",family:"vhs",category:V,base:[.8,.8,.8,3]},{id:"crt",name:"CRT Screen",ru:"кинескоп",family:"style",category:V,base:[1,1,0,0]},{id:"pixelArt",name:"Pixel Art",ru:"пиксель-арт",family:"style",category:V,base:[1,8,1,6]},{id:"gameboy",name:"Handheld Console",ru:"консоль",family:"style",category:V,base:[1,4,10,0],color:"#9bbc0f",color2:"#0f380f"},{id:"film8mm",name:"8mm",ru:"8 мм",family:"film",category:K,base:[1,1.4,.8,2]},{id:"film16mm",name:"16mm",ru:"16 мм",family:"film",category:K,base:[1,.8,.4,3]},{id:"gateWeave",name:"Gate Weave",ru:"дрожание кадра",family:"film",category:K,base:[1,.4,0,4]},{id:"burnedEdges",name:"Burned Edges",ru:"прожжённые края",family:"film",category:K,base:[1,.6,.3,5]},{id:"leakRainbow",name:"Rainbow Leak",ru:"радужный засвет",family:"leak",category:Z,base:[.8,1,4,0],speed:[1,1]},{id:"cornerBurn",name:"Corner Burn",ru:"угловой засвет",family:"leak",category:Z,base:[.9,1,1,0],speed:[1,1],color:"#ff6a1a"},{id:"lightSweep",name:"Light Sweep",ru:"световая полоса",family:"leak",category:Z,base:[.8,1,2,30],speed:[1,1],color:"#fff2d6"},{id:"flickerLight",name:"Flicker Light",ru:"мерцание",family:"leak",category:Z,base:[.7,1,3,0],speed:[1,1],color:"#ffd7a1"},{id:"cameraFlash",name:"Camera Flash",ru:"фотовспышка",family:"flash",category:Z,base:[1,1.5,2],speed:[1,1.5],color:"#ffffff"},{id:"sketch",name:"Sketch",ru:"скетч",family:"style",category:j,base:[1,1,8,0]},{id:"emboss",name:"Emboss",ru:"тиснение",family:"style",category:j,base:[1,1,9,0]},{id:"dither",name:"1-bit Dither",ru:"дизеринг",family:"style",category:j,base:[1,2,10,0],color:"#f2f2f2",color2:"#111111"},{id:"mirrorQuad",name:"Quad Mirror",ru:"четыре зеркала",family:"mirror",category:W,base:[2,2,0,1],strengthSlots:[]},{id:"tiles",name:"Tiles",ru:"плитка",family:"mirror",category:W,base:[4,2,0,1],strengthSlots:[],params:[{key:"tiles",label:"Tiles per side",slot:1,default:2,min:2,max:6,step:1}]},{id:"fisheye",name:"Fisheye",ru:"рыбий глаз",family:"distort",category:J,base:[1.2,1,0,1]},{id:"bulge",name:"Bulge",ru:"выпуклость",family:"distort",category:J,base:[1,1,1,1]},{id:"pinch",name:"Pinch",ru:"щипок",family:"distort",category:J,base:[1,1,2,1]},{id:"swirl",name:"Swirl",ru:"водоворот",family:"distort",category:J,base:[1,1,3,1]},{id:"wave",name:"Wave",ru:"волна",family:"distort",category:J,base:[1,1,4,1],speed:[1,1]},{id:"ripple",name:"Ripple",ru:"рябь",family:"distort",category:J,base:[1,1,5,1],speed:[1,1]},{id:"water",name:"Water",ru:"вода",family:"distort",category:J,base:[1,1,6,1],speed:[1,1]},{id:"glass",name:"Glass Blocks",ru:"стеклоблоки",family:"distort",category:J,base:[1,1,7,1]},{id:"jelly",name:"Jelly",ru:"желе",family:"distort",category:J,base:[1,1,8,1],speed:[1,1]},{id:"vignetteOval",name:"Vignette Oval",ru:"виньетка овал",family:"frame",category:Q,base:[1,0,2,.3]},{id:"lensDirt",name:"Lens Dirt",ru:"грязь на линзе",family:"frame",category:Q,base:[1,0,3,0]},{id:"anamorphicLook",name:"Anamorphic Look",ru:"анаморфот",family:"frame",category:Q,base:[1,2.39,4,0]},{id:"rain",name:"Rain",ru:"дождь",family:"weather",category:ee,base:[1,1,0,1],speed:[1,1]},{id:"snow",name:"Snow",ru:"снег",family:"weather",category:ee,base:[1,1,1,1],speed:[1,1]},{id:"dust",name:"Floating Dust",ru:"пылинки",family:"weather",category:ee,base:[1,1,2,1],speed:[1,1]},{id:"sparkles",name:"Sparkles",ru:"блёстки",family:"weather",category:ee,base:[1,1,3,1],speed:[1,1]},{id:"bokehLights",name:"Bokeh Lights",ru:"боке",family:"weather",category:ee,base:[1,1,4,1],speed:[1,1]},{id:"fog",name:"Fog",ru:"туман",family:"weather",category:ee,base:[1,1,5,1],speed:[1,1]},{id:"disco",name:"Disco Lights",ru:"диско",family:"party",category:et,base:[1,1,0],speed:[1,1]},{id:"neonPulse",name:"Neon Pulse",ru:"неоновый пульс",family:"party",category:et,base:[.8,1,1],speed:[1,1]},{id:"colorCycle",name:"Colour Cycle",ru:"переливы цвета",family:"party",category:et,base:[1,1,2],speed:[1,1]},{id:"lasers",name:"Lasers",ru:"лазеры",family:"party",category:et,base:[1,1,3],speed:[1,1]},{id:"colorStrobe",name:"Colour Strobe",ru:"цветной строб",family:"party",category:et,base:[.8,1,4],speed:[1,1]}].map(function(e){let t=e.strengthSlots??[0],r=[];for(let o of(t.length>0&&r.push((0,a.numberParam)("strength","Strength, %",100,0,200,1)),e.speed&&r.push((0,a.numberParam)("speed","Speed",e.speed[1],.05,Math.max(10,3*e.speed[1]),.05)),e.color&&r.push({key:"color",label:"Colour",type:"color",default:e.color}),e.color2&&r.push({key:"color2",label:"Colour 2",type:"color",default:e.color2}),e.params??[]))r.push((0,a.numberParam)(o.key,o.label,o.default,o.min,o.max,o.step));return(0,a.defineShaderEffect)({type:`pro.fx.${e.id}`,name:e.name,keywords:[e.name.toLowerCase(),e.ru,e.family],category:e.category,params:r,shader:`pro.fx.family.${e.family}`,wgsl:H[e.family],pack:({p:r})=>{let o=Array(32).fill(0);e.base.forEach((e,t)=>{o[t]=e});let c=(0,a.num)(r,"strength",100)/100;for(let a of t)o[a]=e.base[a]*c;for(let t of(e.speed&&(o[e.speed[0]]=(0,a.num)(r,"speed",e.speed[1])),e.params??[]))o[t.slot]=(0,a.num)(r,t.key,t.default);if(e.color){let[e,t,c]=(0,a.rgb)(r,"color",[1,1,1]);o[8]=e,o[9]=t,o[10]=c}if(e.color2){let[e,t,c]=(0,a.rgb)(r,"color2",[0,0,0]);o[12]=e,o[13]=t,o[14]=c}return o}})}),t.colorEffect];e.s(["studioEffectDefinitions",0,ea],85271)},61725,e=>e.a(async(t,a)=>{try{var r=e.i(67157),o=e.i(71110),c=e.i(85271),i=t([r]);[r]=i.then?(await i)():i;let s=[...c.studioEffectDefinitions,o.blurEffectDefinition],l="Trending",f=[l,"Camera","Light","Glitch","Retro","Film","Blur","Style","Distort","Frame","Weather","Party","Lens","Tools"],m={"studio.zoomPunch":{category:l},"studio.shake":{category:l},"studio.glitch":{category:l},"studio.zoomBlur":{category:l},"studio.rgbSplit":{category:l},"studio.vhs":{category:l},"studio.lightLeak":{category:l},"kadr.effect.oldFilm":{category:l},"studio.handheld":{category:"Camera"},"studio.kenBurns":{category:"Camera"},"studio.flash":{category:"Light"},"kadr.effect.glow":{category:"Light"},"studio.vignette":{category:"Light"},"studio.grain":{category:"Retro"},"kadr.effect.filmLook":{category:"Retro"},"kadr.effect.letterbox":{category:"Retro"},"kadr.effect.duotone":{category:"Style"},"kadr.effect.blackWhite":{category:"Style"},"kadr.effect.posterize":{category:"Style"},"kadr.effect.halftone":{category:"Style"},"kadr.effect.comic":{category:"Style"},"kadr.effect.neon":{category:"Style"},"kadr.effect.nightVision":{category:"Style"},"kadr.effect.thermal":{category:"Style"},"kadr.effect.kaleidoscope":{category:"Lens"},"kadr.effect.mirror":{category:"Lens"},"kadr.effect.tiltShift":{category:"Lens"},"kadr.effect.mosaic":{category:"Lens"},blur:{category:"Lens"},"studio.sharpen":{category:"Tools"},"kadr.effect.colorWheels":{hidden:!0},"kadr.effect.denoise":{hidden:!0},"kadr.effect.mask":{hidden:!0},"kadr.effect.chromaKey":{hidden:!0}};function n(){for(let e of s)r.effectsRegistry.has(e.type)||r.effectsRegistry.register({key:e.type,definition:function(e){let t=m[e.type];return t?{...e,...t}:e}(e)})}e.s(["EFFECT_CATEGORY_ORDER",0,f,"EFFECT_TRENDING",0,l,"registerDefaultEffects",()=>n]),a()}catch(e){a(e)}},!1),3747,e=>e.a(async(t,a)=>{try{e.s(["EFFECT_TARGET_ELEMENT_TYPES",()=>d,"buildDefaultEffectInstance",()=>u,"buildEffectTimeContext",()=>m,"resolveEffectPasses",()=>f]);var r=e.i(99184),o=e.i(5087),c=e.i(67157),i=e.i(11978),n=e.i(96714),s=e.i(61725),l=t([o,c,i,s]);function f({definition:e,effectParams:t,width:a,height:r,time:c}){return(e.params.some(e=>!(e.key in t))&&(t={...(0,o.buildDefaultParamValues)(e.params),...t}),e.renderer.buildPasses)?e.renderer.buildPasses({effectParams:t,width:a,height:r,time:c}):e.renderer.passes.map(e=>({shader:e.shader,uniforms:e.uniforms({effectParams:t,width:a,height:r,time:c})}))}function m({localTicks:e,durationTicks:t,ticksPerSecond:a,fps:r}){let o=Math.max(0,e/a),c=Math.max(0,t/a);return{time:o,duration:c,progress:c>0?Math.min(1,o/c):0,frame:Math.round(o*(r>0?r:30))}}[o,c,i,s]=l.then?(await l)():l;let d=n.VISUAL_ELEMENT_TYPES;function u({effectType:e}){let t=c.effectsRegistry.get(e),a=(0,o.buildDefaultParamValues)(t.params);return{id:(0,r.generateUUID)(),type:e,params:a,enabled:!0}}a()}catch(e){a(e)}},!1),61997,e=>{"use strict";function t({string:e}){return e.charAt(0).toUpperCase()+e.slice(1)}function a({string:e}){return e.toUpperCase()}e.s(["capitalizeFirstLetter",()=>t,"uppercase",()=>a])},99153,e=>e.a(async(t,a)=>{try{e.s(["buildEffectElement",()=>_,"buildElementFromMedia",()=>T,"buildGraphicElement",()=>M,"buildLibraryAudioElement",()=>z,"buildStickerElement",()=>E,"buildTextElement",()=>S,"canElementBeHidden",()=>b,"canElementHaveAudio",()=>h,"getElementFontFamilies",()=>A,"getElementsAtTime",()=>I,"hasElementEffects",()=>x,"hasMediaId",()=>k,"isMaskableElement",()=>g,"isRetimableElement",()=>y,"isVisualElement",()=>p,"requiresMediaId",()=>P]);var r=e.i(19619),o=e.i(11978),c=e.i(96714),i=e.i(63295),n=e.i(3747),s=e.i(67157),l=e.i(69214),f=e.i(5087),m=e.i(61997),u=e.i(21836),d=e.i(20476),v=t([r,o,i,n,s,l,f,u,d]);function h(e){return"audio"===e.type||"video"===e.type}function p(e){return c.VISUAL_ELEMENT_TYPES.includes(e.type)}function g(e){return c.MASKABLE_ELEMENT_TYPES.includes(e.type)}function y(e){return c.RETIMABLE_ELEMENT_TYPES.includes(e.type)}function b(e){return p(e)}function x({element:e}){return p(e)&&(e.effects?.length??0)>0}function k(e){return"mediaId"in e}function P({element:e}){return"video"===e.type||"image"===e.type||"audio"===e.type&&"upload"===e.sourceType}function w({type:e}){return(0,f.buildDefaultParamValues)((0,f.getBuiltInElementParams)({type:e}))}function S({raw:e,startTime:t}){return{type:"text",name:e.name??i.DEFAULTS.text.element.name,duration:e.duration??r.DEFAULT_NEW_ELEMENT_DURATION,startTime:t,trimStart:d.ZERO_MEDIA_TIME,trimEnd:d.ZERO_MEDIA_TIME,params:{...w({type:"text"}),...e.params??{}}}}function _({effectType:e,startTime:t,duration:a}){let o=(0,n.buildDefaultEffectInstance)({effectType:e});return{type:"effect",name:s.effectsRegistry.get(e).name||(0,m.capitalizeFirstLetter)({string:o.type}),effectType:e,params:o.params,duration:a??r.DEFAULT_NEW_ELEMENT_DURATION,startTime:t,trimStart:d.ZERO_MEDIA_TIME,trimEnd:d.ZERO_MEDIA_TIME}}function E({stickerId:e,name:t,startTime:a,intrinsicWidth:o,intrinsicHeight:c}){let i=e.split(":").slice(1).pop()?.replaceAll("-"," ")??e;return{type:"sticker",name:t??i,stickerId:e,intrinsicWidth:o,intrinsicHeight:c,duration:r.DEFAULT_NEW_ELEMENT_DURATION,startTime:a,trimStart:d.ZERO_MEDIA_TIME,trimEnd:d.ZERO_MEDIA_TIME,params:w({type:"sticker"})}}function M({definitionId:e,name:t,startTime:a,params:o}){let c=(0,l.buildDefaultGraphicInstance)({definitionId:e});return{type:"graphic",name:t??(0,m.capitalizeFirstLetter)({string:c.definitionId}),definitionId:c.definitionId,params:function({base:e,overrides:t}){let a={...e};for(let[e,r]of Object.entries(t??{}))void 0!==r&&(a[e]=r);return a}({base:{...w({type:"graphic"}),...c.params},overrides:o}),duration:r.DEFAULT_NEW_ELEMENT_DURATION,startTime:a,trimStart:d.ZERO_MEDIA_TIME,trimEnd:d.ZERO_MEDIA_TIME}}function T({mediaId:e,mediaType:t,name:a,duration:r,startTime:o,buffer:c}){switch(t){case"audio":return function({mediaId:e,name:t,duration:a,startTime:r,buffer:o}){let c={type:"audio",sourceType:"upload",mediaId:e,name:t,duration:a,startTime:r,trimStart:d.ZERO_MEDIA_TIME,trimEnd:d.ZERO_MEDIA_TIME,sourceDuration:a,params:w({type:"audio"})};return o&&(c.buffer=o),c}({mediaId:e,name:a,duration:r,startTime:o,buffer:c});case"video":return function({mediaId:e,name:t,duration:a,startTime:r}){return{type:"video",mediaId:e,name:t,duration:a,startTime:r,trimStart:d.ZERO_MEDIA_TIME,trimEnd:d.ZERO_MEDIA_TIME,sourceDuration:a,isSourceAudioEnabled:!0,hidden:!1,params:w({type:"video"})}}({mediaId:e,name:a,duration:r,startTime:o});case"image":return function({mediaId:e,name:t,duration:a,startTime:r}){return{type:"image",mediaId:e,name:t,duration:a,startTime:r,trimStart:d.ZERO_MEDIA_TIME,trimEnd:d.ZERO_MEDIA_TIME,hidden:!1,params:w({type:"image"})}}({mediaId:e,name:a,duration:r,startTime:o})}}function z({sourceUrl:e,name:t,duration:a,startTime:r,buffer:o}){let c={type:"audio",sourceType:"library",sourceUrl:e,name:t,duration:a,startTime:r,trimStart:d.ZERO_MEDIA_TIME,trimEnd:d.ZERO_MEDIA_TIME,sourceDuration:a,params:w({type:"audio"})};return o&&(c.buffer=o),c}function I({tracks:e,time:t}){let a=[];for(let r of[...e.overlay,e.main,...e.audio])for(let e of r.elements){let o=e.startTime,c=e.startTime+e.duration;t>o&&t<c&&a.push({trackId:r.id,elementId:e.id})}return a}function A({tracks:e}){let t=new Set;for(let a of[...e.overlay,e.main,...e.audio])for(let e of a.elements)if("text"===e.type&&"string"==typeof e.params.fontFamily&&t.add(e.params.fontFamily),"masks"in e)for(let a of e.masks??[])"text"===a.type&&a.params.fontFamily&&t.add(a.params.fontFamily);return[...t]}[r,o,i,n,s,l,f,u,d]=v.then?(await v)():v,a()}catch(e){a(e)}},!1),39738,e=>e.a(async(t,a)=>{try{var r=e.i(53078),o=e.i(56323),c=e.i(63295),i=t([r,o,c]);function n({element:e}){return!1!==e.isSourceAudioEnabled}function s({element:e}){return!n({element:e})}function l(e,t){return"video"===e.type&&n({element:e})&&!!t&&!1!==t.hasAudio}function f(e,t){return"video"===e.type&&s({element:e})||l(e,t)}function m({element:e,mediaAsset:t}){return"audio"===e.type||!!t&&!1!==t.hasAudio&&n({element:e})}function u({video:e,tracks:t}){let a=e=>[e.trimStart,e.trimStart+e.duration*(e.retime&&e.retime.rate>0?e.retime.rate:1)],r=e=>[e.startTime,e.startTime+e.duration],o=(e,t)=>e[0]<t[1]&&e[1]>t[0],c=a(e),i=[...t.overlay,t.main].flatMap(e=>e.elements.filter(e=>"video"===e.type)),n=new Map(i.map(e=>[e.id,e])),s=t.audio.flatMap(t=>t.elements.filter(t=>"upload"===t.sourceType&&t.mediaId===e.mediaId).map(e=>({trackId:t.id,element:e}))),l=t=>i.find(c=>c.id!==e.id&&!1===c.isSourceAudioEnabled&&c.mediaId===t.mediaId&&o(a(c),a(t))&&o(r(c),r(t))),f=[],m=[];for(let{trackId:t,element:r}of s){if(!r.detachedFrom)continue;let i=n.get(r.detachedFrom);if(!(r.detachedFrom===e.id||o(a(r),c)&&(!i||i.mediaId!==e.mediaId||!o(a(i),a(r)))))continue;let s=l(r);s?m.push({trackId:t,elementId:r.id,to:s.id}):f.push({trackId:t,elementId:r.id})}if(f.length||m.length)return{remove:f,retag:m};let u=s.filter(({element:e})=>!e.detachedFrom&&o(a(e),c)).sort((t,a)=>Math.abs(t.element.startTime-e.startTime)-Math.abs(a.element.startTime-e.startTime))[0];return{remove:u?[{trackId:u.trackId,elementId:u.element.id}]:[],retag:[]}}function d({sourceElement:e}){return{type:"audio",sourceType:"upload",mediaId:e.mediaId,detachedFrom:e.id,name:e.name,duration:e.duration,startTime:e.startTime,trimStart:e.trimStart,trimEnd:e.trimEnd,sourceDuration:e.sourceDuration,params:{volume:"number"==typeof e.params.volume?e.params.volume:c.DEFAULTS.element.volume,muted:!0===e.params.muted},retime:e.retime?{rate:e.retime.rate,maintainPitch:e.retime.maintainPitch}:void 0,animations:function({animations:e}){let t=e?.volume;if(t)return(0,o.cloneAnimations)({animations:{volume:t},shouldRegenerateKeyframeIds:!0})}({animations:e.animations})}}function v({element:e}){return s({element:e})?"Recover audio":"Extract audio"}[r,o,c]=i.then?(await i)():i,e.s(["buildSeparatedAudioElement",()=>d,"canExtractSourceAudio",()=>l,"canToggleSourceAudio",()=>f,"detachedSoundOf",()=>u,"doesElementHaveEnabledAudio",()=>m,"getSourceAudioActionLabel",()=>v,"isSourceAudioSeparated",()=>s]),a()}catch(e){a(e)}},!1),94774,e=>{"use strict";e.s(["BASE_TIMELINE_PIXELS_PER_SECOND",0,50,"TIMELINE_ZOOM_MAX",0,100,"TIMELINE_ZOOM_MIN",0,.1])},10278,e=>e.a(async(t,a)=>{try{var r=e.i(94774),o=e.i(21836),c=e.i(20476),i=t([o,c]);function n({duration:e,containerWidth:t}){let a=Number.isFinite(e)?Math.max(e/c.TICKS_PER_SECOND,1):1,o="number"==typeof t&&Number.isFinite(t)&&t>0?t:1e3,i=.25*o/(a*r.BASE_TIMELINE_PIXELS_PER_SECOND);return Math.max(1e-6,Math.min(r.TIMELINE_ZOOM_MAX,i))}function s({containerWidth:e,zoomLevel:t,minZoom:a}){let o=Number.isFinite(e)&&e>0?e:0,c=Math.max(0,Math.min(1,function({zoomLevel:e,minZoom:t}){let a=r.TIMELINE_ZOOM_MAX-t;return a>0?(e-t)/a:0}({zoomLevel:t,minZoom:a}))),i=Math.min(c/.2,1);return o*(.75-.6*i)}function l({minZoom:e,maxZoom:t}){return Number.isFinite(e)&&e>0&&(!Number.isFinite(t)||t>e)?e:Number.isFinite(t)&&t>0?t/100:.001}function f({sliderPosition:e,minZoom:t,maxZoom:a=r.TIMELINE_ZOOM_MAX}){let o=Math.max(0,Math.min(1,e)),c=l({minZoom:t,maxZoom:a}),i=Number.isFinite(a)&&a>c?a:100*c;return c*(i/c)**o}function m({zoomLevel:e,minZoom:t,maxZoom:a=r.TIMELINE_ZOOM_MAX}){let o=l({minZoom:t,maxZoom:a}),c=Number.isFinite(a)&&a>o?a:100*o,i=Math.max(o,Math.min(c,Number.isFinite(e)?e:o));return Math.log(i/o)/Math.log(c/o)}[o,c]=i.then?(await i)():i,e.s(["getTimelinePaddingPx",()=>s,"getTimelineZoomMin",()=>n,"sliderToZoom",()=>f,"zoomToSlider",()=>m]),a()}catch(e){a(e)}},!1),30789,e=>{"use strict";let t=[{value:24e3/1001,rate:{numerator:24e3,denominator:1001}},{value:24,rate:{numerator:24,denominator:1}},{value:25,rate:{numerator:25,denominator:1}},{value:3e4/1001,rate:{numerator:3e4,denominator:1001}},{value:30,rate:{numerator:30,denominator:1}},{value:48,rate:{numerator:48,denominator:1}},{value:50,rate:{numerator:50,denominator:1}},{value:6e4/1001,rate:{numerator:6e4,denominator:1001}},{value:60,rate:{numerator:60,denominator:1}},{value:120,rate:{numerator:120,denominator:1}}],a=[24e3/1001,3e4/1001,48e3/1001,6e4/1001,12e4/1001];function r(e){if(Number.isFinite(e)&&!(e<=0))return a.find(t=>.01>=Math.abs(e-t))??Math.round(e)}function o(e){return e.numerator/e.denominator}function c({a:e,b:t}){return e.numerator===t.numerator&&e.denominator===t.denominator}function i(e){let a=t.find(t=>.01>=Math.abs(e-t.value));if(a)return a.rate;if(Number.isInteger(e))return{numerator:e,denominator:1};let r=Math.round(1e6*e),o=function({left:e,right:t}){let a=Math.abs(e),r=Math.abs(t);for(;0!==r;){let e=a%r;a=r,r=e}return a||1}({left:r,right:1e6});return{numerator:r/o,denominator:1e6/o}}function n({mediaAssets:e}){let t=null;for(let a of e){let e=a.fps??NaN;"video"===a.type&&Number.isFinite(e)&&!(e<=0)&&(t=null===t?e:Math.max(t,e))}return t}function s({currentFps:e,importedAssets:t}){let a=n({mediaAssets:t}),r=o(e);return null===a||a<=r?null:i(a)}e.s(["floatToFrameRate",()=>i,"frameRateToFloat",()=>o,"frameRatesEqual",()=>c,"getHighestImportedVideoFps",()=>n,"getRaisedProjectFpsForImportedMedia",()=>s,"normalizeMediaFps",()=>r])},20601,e=>{"use strict";var t=e.i(94774),a=e.i(30789);let r=[2,3,5,10,15],o=[1,2,3,5,10,15],c=[1,2,3,5,10,15,30,60,120,300,600,900,1800,3600];function i({zoomLevel:e,fps:i}){let s=(0,a.frameRateToFloat)(i),l=Number.isFinite(s)&&s>0?s:30,f=Number.isFinite(e)&&e>0?e:1,m=t.BASE_TIMELINE_PIXELS_PER_SECOND*f,u=m/l,d=n({pixelsPerFrame:u,pixelsPerSecond:m,fps:l,minSpacingPx:120,frameIntervals:r}),v=function({tickIntervalSeconds:e,labelIntervalSeconds:t,pixelsPerFrame:a,pixelsPerSecond:r,fps:i}){let n=Math.round(t*i);if(n%Math.round(e*i)==0)return e;for(let e of o)if(n%e==0&&a*e>=18)return e/i;for(let e of c){let a=t/e;if(1e-4>Math.abs(a-Math.round(a))&&r*e>=18)return e}return t}({tickIntervalSeconds:n({pixelsPerFrame:u,pixelsPerSecond:m,fps:l,minSpacingPx:18,frameIntervals:o}),labelIntervalSeconds:d,pixelsPerFrame:u,pixelsPerSecond:m,fps:l});return{labelIntervalSeconds:d,tickIntervalSeconds:v}}function n({pixelsPerFrame:e,pixelsPerSecond:t,fps:a,minSpacingPx:r,frameIntervals:o}){for(let t of o)if(e*t>=r)return t/a;for(let e of c)if(t*e>=r)return e;return 60}function s({time:e,labelIntervalSeconds:t}){let a=e%t;return a<1e-4||a>t-1e-4}function l({timeInSeconds:e,fps:t}){let r=(0,a.frameRateToFloat)(t),o=Number.isFinite(r)&&r>0?r:30;if(function({timeInSeconds:e,fps:t}){let a=Number.isFinite(t)&&t>0?Math.min(.01,.5/t):1e-4,r=e%1;return r<a||r>1-a}({timeInSeconds:e,fps:o}))return function({timeInSeconds:e}){let t=Math.round(e),a=Math.floor(t/3600),r=Math.floor(t%3600/60).toString().padStart(2,"0"),o=(t%60).toString().padStart(2,"0");return a>0?`${a}:${r}:${o}`:`${r}:${o}`}({timeInSeconds:e});let c=function({timeInSeconds:e,fps:t}){return Math.min(Math.max(0,Math.ceil(t)-1),Math.max(0,Math.floor(e%1*t+1e-6)))}({timeInSeconds:e,fps:o});return`${c}f`}e.s(["formatRulerLabel",()=>l,"getRulerConfig",()=>i,"shouldShowLabel",()=>s])},92621,e=>e.a(async(t,a)=>{try{var r=e.i(94774),o=e.i(21836),c=e.i(20476),i=t([o,c]);function n({zoomLevel:e}){return r.BASE_TIMELINE_PIXELS_PER_SECOND*e}function s({time:e,zoomLevel:t}){return e/c.TICKS_PER_SECOND*n({zoomLevel:t})}function l({time:e,zoomLevel:t,devicePixelRatio:a}){let r=s({time:e,zoomLevel:t});return function({pixel:e,devicePixelRatio:t}){let a=function({devicePixelRatio:e}){return"number"==typeof e&&Number.isFinite(e)&&e>0?e:Number.isFinite(window.devicePixelRatio)&&window.devicePixelRatio>0?window.devicePixelRatio:1}({devicePixelRatio:t});return Math.round(e*a)/a}({pixel:r,devicePixelRatio:a})}function f({centerPixel:e,lineWidthPx:t=2}){return e-t/2}[o,c]=i.then?(await i)():i,e.s(["TIMELINE_INDICATOR_LINE_WIDTH_PX",0,2,"getCenteredLineLeft",()=>f,"getTimelinePixelsPerSecond",()=>n,"timelineTimeToPixels",()=>s,"timelineTimeToSnappedPixels",()=>l]),a()}catch(e){a(e)}},!1),11978,e=>e.a(async(t,a)=>{try{e.s(["calculateTotalDuration",()=>f]);var r=e.i(21836),o=e.i(20476);e.i(96714),e.i(31996),e.i(61383),e.i(56038);var c=e.i(99153),i=e.i(39738),n=e.i(10278);e.i(20601);var s=e.i(92621),l=t([r,o,c,i,n,s]);function f({tracks:e}){let t=[...e.overlay,e.main,...e.audio];if(0===t.length)return o.ZERO_MEDIA_TIME;let a=o.ZERO_MEDIA_TIME;for(let e of t)for(let t of e.elements){let e=(0,o.addMediaTime)({a:t.startTime,b:t.duration});e>a&&(a=e)}return a}[r,o,c,i,n,s]=l.then?(await l)():l,a()}catch(e){a(e)}},!1),9486,e=>{"use strict";var t=e.i(20200),a=e.i(3123);function r({clipTime:e,retime:a,duration:r}){return Math.max(0,(0,t.getSourceTimeAtClipTime)({clipTime:e,retime:a,duration:r}))}function o({retime:e,splitClipTime:r,duration:o}){let c=(0,t.getRetimeCurveTable)(e);if(!e||!c||!e.curve||!o||o<=0)return{left:e,right:e};let i=Math.min(.999,Math.max(.001,(0,a.sourceFractionAt)(c,r/o))),n=(0,a.subCurve)(e.curve,0,i),s=(0,a.subCurve)(e.curve,i,1);return{left:{...e,curve:n,rate:(0,a.getCurveTable)(n).rate},right:{...e,curve:s,rate:(0,a.getCurveTable)(s).rate}}}e.s(["getSourceSpanAtClipTime",()=>r,"splitRetimeAtClipTime",()=>o])},74819,e=>{"use strict";let t=`
self.onmessage = async (event) => {
	const { id, path, name, parts } = event.data;
	try {
		let dir = await navigator.storage.getDirectory();
		for (const segment of path) dir = await dir.getDirectoryHandle(segment, { create: true });
		const handle = await dir.getFileHandle(name, { create: true });
		const access = await handle.createSyncAccessHandle();
		try {
			await access.truncate(0);
			let at = 0;
			for (const part of parts) {
				if (part instanceof Blob) {
					const reader = part.stream().getReader();
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						access.write(value, { at });
						at += value.byteLength;
					}
				} else {
					const bytes =
						typeof part === "string"
							? new TextEncoder().encode(part)
							: ArrayBuffer.isView(part)
								? new Uint8Array(part.buffer, part.byteOffset, part.byteLength)
								: new Uint8Array(part);
					access.write(bytes, { at });
					at += bytes.byteLength;
				}
			}
			await access.flush();
		} finally {
			await access.close();
		}
		self.postMessage({ id, ok: true });
	} catch (error) {
		self.postMessage({ id, ok: false, name: error && error.name, message: String((error && error.message) || error) });
	}
};
`,a=null,r=0,o=new Map;async function c({handle:e,path:c,name:i,parts:n}){if("function"==typeof e.createWritable){let t=await e.createWritable();try{for(let e of n)await t.write(e);await t.close()}catch(e){try{await t.abort()}catch{}throw e}return}await new Promise((e,s)=>{let l=++r;o.set(l,{resolve:e,reject:s});try{(function(){if(a)return a;let e=new Worker(URL.createObjectURL(new Blob([t],{type:"text/javascript"})));return e.onmessage=e=>{let t=o.get(e.data.id);if(!t)return;if(o.delete(e.data.id),e.data.ok)return t.resolve();let a=Error(e.data.message||"The file could not be written");e.data.name&&(a.name=e.data.name),t.reject(a)},e.onerror=()=>{let t=Error("The file writer could not start");for(let e of o.values())e.reject(t);o.clear(),a===e&&(a=null)},a=e,e})().postMessage({id:l,path:c,name:i,parts:n})}catch(e){o.delete(l),s(e instanceof Error?e:Error(String(e)))}})}e.s(["writeOpfsFile",()=>c])}]);