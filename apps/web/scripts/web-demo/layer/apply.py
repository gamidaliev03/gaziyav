#!/usr/bin/env python3
"""The browser edition's few changes to EXISTING files of the editor (apps/web), as exact anchored edits.

    python3 apps/web/scripts/web-demo/layer/apply.py <apps/web of a build copy>   (zsh apps/web/scripts/web-demo.sh layer)

Every change is guarded by NEXT_PUBLIC_GAZIYAV_DEMO (src/demo/flag.ts): with the flag unset (the desktop build) each
one is a no-op. Idempotent: an edit already there is skipped; an anchor that is missing stops the run (exit 3, the file named)
BEFORE anything is written, so a drifted tree is noticed, never half-patched. Run only on a build copy (web-demo.sh
layer); the tree itself, which the desktop app builds from, is never changed.
"""
import re
import sys
from pathlib import Path

if len(sys.argv) != 2 or not (Path(sys.argv[1]) / "src").is_dir():
    raise SystemExit("usage: apply.py <apps/web of a BUILD COPY of the tree>")
WEB = Path(sys.argv[1])
done, skipped = [], []
texts = {}  # every edit lands here first; the files are written only when ALL of them applied


def fail(rel, why):
    sys.stderr.write(f"PATCH FAILED: {rel}: {why}\n  (main changed this file: look at it and update web-demo/layer/apply.py; nothing was written)\n")
    sys.exit(3)


def edit(rel, old, new, marker, regex=False):
    p = WEB / rel
    if rel not in texts:
        if not p.is_file():
            fail(rel, "the file is gone")
        texts[rel] = p.read_text()
    s = texts[rel]
    if marker in s:
        skipped.append(f"{rel}: {marker}")
        return
    if regex:
        s2, n = re.subn(old, new, s, count=1, flags=re.S)
        if n != 1:
            fail(rel, f"anchor not found: {old[:90]!r}")
    else:
        if old not in s:
            fail(rel, f"anchor not found: {old[:90]!r}")
        s2 = s.replace(old, new, 1)
    if marker not in s2:
        fail(rel, f"the edit did not leave its marker {marker[:60]!r}")
    texts[rel] = s2
    done.append(f"{rel}: {marker}")


# 1. next.config.ts — the static export of the editor, only with the flag
edit(
    "next.config.ts",
    "export default withContentCollections(nextConfig);",
    '''// The browser edition (script/web-demo.sh): NEXT_PUBLIC_GAZIYAV_DEMO=1 makes a static export of the editor — its own
// route tree (app/*.demo.tsx: one page; no API routes, no proxy), every file under a placeholder prefix that the
// script turns into relative paths (the site works under any /<repo>/), and the motion-graphics renderer (Remotion:
// a company licence for teams) replaced by empty stand-ins. Without the flag this is the desktop config unchanged.
const DEMO = process.env.NEXT_PUBLIC_GAZIYAV_DEMO === "1";
const DEMO_STUB = "./src/demo/stubs/remotion.tsx";
const demoConfig: NextConfig = DEMO
	? {
			...nextConfig,
			env: { ...nextConfig.env, NEXT_PUBLIC_GAZIYAV_DEMO: "1", NEXT_PUBLIC_GAZIYAV_DEMO_LOOP: process.env.NEXT_PUBLIC_GAZIYAV_DEMO_LOOP ?? "" },
			pageExtensions: ["demo.tsx"],
			output: "export",
			assetPrefix: "/__GZDEMO__",
			trailingSlash: true,
			images: { ...nextConfig.images, unoptimized: true },
			turbopack: {
				...nextConfig.turbopack,
				resolveAlias: Object.fromEntries(
					["remotion", "@remotion/player", "@remotion/shapes", "@remotion/paths", "@remotion/noise", "@remotion/google-fonts"].map((m) => [m, DEMO_STUB]),
				),
			},
		}
	: nextConfig;

export default withContentCollections(demoConfig);''',
    "const demoConfig",
)

# 2. the editor page: its body takes the project id (the browser edition's page opens it without a route param)
edit(
    "src/app/editor/[project_id]/page.tsx",
    r"export default function Editor\(\) \{\n\tconst params = useParams\(\);\n\tconst projectId = params\.project_id as string;\n\n\treturn \(",
    """export default function Editor() {
	const params = useParams();
	return <EditorBody projectId={params.project_id as string} />;
}

/** The editor of one project (the app's /editor/<id>, and the browser edition's one page: src/app/page.demo.tsx). */
export function EditorBody({ projectId }: { projectId: string }) {
	const demo = process.env.NEXT_PUBLIC_GAZIYAV_DEMO === "1";
	return (""",
    "export function EditorBody",
    regex=True,
)
edit(
    "src/app/editor/[project_id]/page.tsx",
    r"(\t+)<PanelErrorBoundary name=\"Menu bridge\"(.*?)</PanelErrorBoundary>\n\t+<PanelErrorBoundary name=\"Claude bridge\"(.*?)</PanelErrorBoundary>",
    r"""\1{/* the browser edition has neither the Mac's menu nor Claude's connector */}
\1{!demo && (<PanelErrorBoundary name="Menu bridge"\2</PanelErrorBoundary>)}
\1{!demo && (<PanelErrorBoundary name="Claude bridge"\3</PanelErrorBoundary>)}""",
    "the browser edition has neither",
    regex=True,
)

# 2b. a phone or a tablet gets the touch arrangement (src/mobile): the page's header + layout become the «desktop» side
#     of the switch — on a computer DeviceSwitch returns them as they are
edit(
    "src/app/editor/[project_id]/page.tsx",
    r"""(\t+)<PanelErrorBoundary name="Header" className=\{COMPACT_ERROR\}>\n\t+<EditorHeader />\n\t+</PanelErrorBoundary>\n\t+<div className="min-h-0 min-w-0 flex-1">\n\t+<EditorLayout />\n\t+</div>""",
    r"""\1<DeviceSwitch
\1	desktop={
\1		<>
\1			<PanelErrorBoundary name="Header" className={COMPACT_ERROR}>
\1				<EditorHeader />
\1			</PanelErrorBoundary>
\1			<div className="min-h-0 min-w-0 flex-1">
\1				<EditorLayout />
\1			</div>
\1		</>
\1	}
\1/>""",
    "<DeviceSwitch",
    regex=True,
)
edit(
    "src/app/editor/[project_id]/page.tsx",
    'const COMPACT_ERROR = ',
    'import { DeviceSwitch } from "@/mobile/shell/device-switch";\n\nconst COMPACT_ERROR = ',
    'from "@/mobile/shell/device-switch"',
)

# 3. the header: the site / File / Themes / Help / language strip instead of the sections; Export of the browser
H = "src/components/editor/editor-header.tsx"
edit(H, 'import { AgentPill } from "@/agentview/components/agent-view";', 'import { AgentPill } from "@/agentview/components/agent-view";\nimport { DEMO } from "@/demo/flag";\nimport { DemoBar, DemoExportButton } from "@/demo/ui";', "@/demo/ui")
edit(
    H,
    r'<div className="flex min-w-0 items-center gap-3 pl-\[73px\]">\n(\t+)<SectionSwitch />',
    r'<div className={cn("flex min-w-0 items-center gap-3", DEMO ? "pl-0" : "pl-[73px]")}>' + "\n" + r"\1{DEMO ? <DemoBar /> : <SectionSwitch />}",
    "<DemoBar />",
    regex=True,
)
edit(
    H,
    r"(\t+)<JobsChip />\n\t+<ToolSearchButton />\n\t+<AgentPill />\n\t+<AssembleMount />\n(.*?)<span className=\"flex items-center gap-px\">\n\t+<ExportButton />\n\t+<ShareButton />\n\t+</span>",
    r"""\1{!DEMO && <JobsChip />}
\1{!DEMO && <ToolSearchButton />}
\1{!DEMO && <AgentPill />}
\1{!DEMO && <AssembleMount />}
\2{DEMO ? (
\1	<DemoExportButton />
\1) : (
\1	<span className="flex items-center gap-px">
\1		<ExportButton />
\1		<ShareButton />
\1	</span>
\1)}""",
    "<DemoExportButton />",
    regex=True,
)
edit(H, "<ToolSearch />\n\t\t</header>", "{!DEMO && <ToolSearch />}\n\t\t</header>", "{!DEMO && <ToolSearch />}")
edit(
    H,
    r"(\t+)(<DropdownMenuItem onClick=\{exit\}.*?</DropdownMenuItem>)\n\t+<DropdownMenuSeparator />",
    r"\1{!DEMO && (\2)}" + "\n" + r"\1{!DEMO && <DropdownMenuSeparator />}",
    "{!DEMO && (<DropdownMenuItem onClick={exit}",
    regex=True,
)
edit(H, r"(\t+)(<DropdownMenuItem onClick=\{\(\) => setVersionsOpen\(true\)\}.*?</DropdownMenuItem>)", r"\1{!DEMO && (\2)}", "{!DEMO && (<DropdownMenuItem onClick={() => setVersionsOpen", regex=True)
edit(H, r"(\t+)(<DropdownMenuItem\n\t+onClick=\{\(\) => void collect\(\)\}.*?</DropdownMenuItem>)", r"\1{!DEMO && (\2)}", "{!DEMO && (<DropdownMenuItem\n", regex=True)
edit(H, r"(\t+)(<DropdownMenuItem onClick=\{\(\) => invokeAction\(\"open-assemble\"\)\}.*?</DropdownMenuItem>)", r"\1{!DEMO && (\2)}", '{!DEMO && (<DropdownMenuItem onClick={() => invokeAction("open-assemble")', regex=True)
edit(
    H,
    r"(\t+)<DropdownMenuSeparator />\n(\t+)(<DropdownMenuItem\n\t+variant=\"destructive\".*?</DropdownMenuItem>)",
    r"\1{!DEMO && <DropdownMenuSeparator />}" + "\n" + r"\2{!DEMO && (\3)}",
    '{!DEMO && (<DropdownMenuItem\n\t\t\t\t\tvariant="destructive"',
    regex=True,
)

# 4. the materials panel: no sound library, no captions; «AI» = the one card (or the browser AI module's panel)
P = "src/components/editor/panels/assets/assets-panel-store.tsx"
edit(P, 'import { HugeiconsIcon, type IconSvgElement } from "@/components/ui/icon";', 'import { HugeiconsIcon, type IconSvgElement } from "@/components/ui/icon";\nimport { DEMO } from "@/demo/flag";', '@/demo/flag')
edit(
    P,
    r"export const TAB_GROUPS = \[(.*?)\] as const satisfies ReadonlyArray<\{ key: Tab; tabs: readonly Tab\[\] \}>;",
    r"""const ALL_TAB_GROUPS = [\1] as const satisfies ReadonlyArray<{ key: Tab; tabs: readonly Tab[] }>;
// The browser edition: no sound library and no captions (both need the desktop app); «AI» is one card.
export const TAB_GROUPS = (
	DEMO
		? [
				{ key: "media", tabs: ["media"] },
				{ key: "text", tabs: ["text"] },
				{ key: "effects", tabs: ["effects", "transitions", "filters"] },
				{ key: "avatar", tabs: ["avatar"] },
			]
		: ALL_TAB_GROUPS
) as typeof ALL_TAB_GROUPS;""",
    "ALL_TAB_GROUPS",
    regex=True,
)
I = "src/components/editor/panels/assets/index.tsx"
edit(I, 'import { PanelErrorBoundary } from "@/reliability/panel-error-boundary";', 'import { PanelErrorBoundary } from "@/reliability/panel-error-boundary";\nimport { DEMO } from "@/demo/flag";\nimport { DemoLipsyncCard } from "@/demo/ui";\nimport { TryCard } from "@/demo/try-card";', "@/demo/try-card")
edit(I, "avatar: <AvatarTab />,", "avatar: DEMO ? <DemoLipsyncCard /> : <AvatarTab />,", "DemoLipsyncCard />")
edit(I, r"(\t+)<LibraryMediaSync />\n\t+<CloudPauseWatcher />\n\t+<SpendDialog />", r"\1{!DEMO && <LibraryMediaSync />}" + "\n" + r"\1{!DEMO && <CloudPauseWatcher />}" + "\n" + r"\1{!DEMO && <SpendDialog />}", "{!DEMO && <LibraryMediaSync />}", regex=True)
edit(
    I,
    r"(\t+)(<PanelErrorBoundary\n\t+name=\"Add from a link\".*?<YouTubeDialog />\n\t+</PanelErrorBoundary>)",
    r"\1{DEMO && <TryCard />}" + "\n" + r"\1{!DEMO && (\2)}",
    "{DEMO && <TryCard />}",
    regex=True,
)
T = "src/text/components/assets-view.tsx"
edit(T, 'import { MaterialsLayout, type NavItem } from "@/components/editor/panels/assets/materials-nav";', 'import { MaterialsLayout, type NavItem } from "@/components/editor/panels/assets/materials-nav";\nimport { DEMO } from "@/demo/flag";', "@/demo/flag")
edit(
    T,
    r"const TEXT_NAV: NavItem\[\] = \[(.*?)\n\];",
    r"""const TEXT_NAV: NavItem[] = ([\1
] as NavItem[]).filter((item) => !DEMO || (item.key !== "motion" && item.key !== "layouts")); // the browser edition: no motion graphics""",
    "the browser edition: no motion graphics",
    regex=True,
)

# 5. Settings: Edit, General, Themes only
S = "src/settings/settings-dialog.tsx"
edit(S, 'import { AppearanceSection } from "@/themes/appearance-section";', 'import { AppearanceSection } from "@/themes/appearance-section";\nimport { DEMO } from "@/demo/flag";', "@/demo/flag")
edit(
    S,
    r"const SECTIONS: Array<\{ id: SettingsSection; label: string \}> = \[(.*?)\n\];",
    r"""const SECTIONS: Array<{ id: SettingsSection; label: string }> = ([\1
] as Array<{ id: SettingsSection; label: string }>).filter((s) => !DEMO || s.id === "edit" || s.id === "general" || s.id === "appearance");""",
    's.id === "appearance");',
    regex=True,
)
edit(S, 'SECTIONS.some((s) => s.id === aliased) ? aliased : "projects";', 'SECTIONS.some((s) => s.id === aliased) ? aliased : DEMO ? "appearance" : "projects";', 'DEMO ? "appearance" : "projects"')

# 6. storage: the browser edition's own database / folder names
V = "src/services/storage/service.ts"
edit(V, 'import { roundMediaTime } from "@/wasm";', 'import { roundMediaTime } from "@/wasm";\nimport { demoName } from "@/demo/flag";', "@/demo/flag")
edit(V, 'projectsDb: "video-editor-projects",', 'projectsDb: demoName("video-editor-projects"),', 'demoName("video-editor-projects")')
edit(V, 'mediaDb: "video-editor-media",', 'mediaDb: demoName("video-editor-media"),', 'demoName("video-editor-media")')
edit(V, 'savedSoundsDb: "video-editor-saved-sounds",', 'savedSoundsDb: demoName("video-editor-saved-sounds"),', 'demoName("video-editor-saved-sounds")')
edit(V, "new OPFSAdapter(`media-files-${projectId}`)", "new OPFSAdapter(demoName(`media-files-${projectId}`))", "demoName(`media-files-")
for rel, old in (("src/services/storage/migrations/runner.ts", 'dbName: "video-editor-projects",'), ("src/services/storage/recovery.ts", 'dbName: "opencut-project-backups",')):
    name = old.split('"')[1]
    edit(rel, old, f'dbName: demoName("{name}"),', f'demoName("{name}")')
    edit(rel, "", 'import { demoName } from "@/demo/flag";\n', 'import { demoName } from "@/demo/flag";')

# 7. fonts: only the fonts shipped with the site (no server to fetch one on first use), from its own folder
F = "src/fonts/bundled.ts"
edit(F, 'import { REMOTE_FONTS } from "./remote-catalog";', 'import { REMOTE_FONTS } from "./remote-catalog";\nimport { DEMO } from "@/demo/flag";', "@/demo/flag")
edit(F, "export const BUNDLED_FONTS: BundledFont[] = [", "const ALL_FONTS: BundledFont[] = [", "const ALL_FONTS")
edit(
    F,
    'const BUNDLED_FONT_PATH = "/fonts/bundled/";',
    '''// The browser edition has no server to fetch a font on first use: only the fonts shipped with it, from its own folder.
export const BUNDLED_FONTS: BundledFont[] = DEMO ? ALL_FONTS.filter((font) => !REMOTE_FONTS[font.family]) : ALL_FONTS;
const BUNDLED_FONT_PATH = DEMO ? "fonts/bundled/" : "/fonts/bundled/";''',
    "DEMO ? ALL_FONTS",
)

# 8. the Russian lines of the browser edition
R = "src/i18n/ru.ts"
edit(R, r'(import \{ RU_SPEED \} from "\./ru-speed";)', r'\1' + '\nimport { RU_PUBDEMO } from "./ru-pubdemo";', "RU_PUBDEMO }", regex=True)
edit(R, r"\n\};\s*$", "\n\t...RU_PUBDEMO,\n};\n", "...RU_PUBDEMO", regex=True)

for rel, text in texts.items():
    (WEB / rel).write_text(text)
print(f"apply.py: {len(done)} edits in {len(texts)} files applied, {len(skipped)} already there")
print("\n".join(["changed:"] + [f"  {d}" for d in done] + (["already there:"] + [f"  {s}" for s in skipped] if skipped else [])))
