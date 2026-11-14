# Rewrites the background alias of a mounted DMG volume the way Finder (macOS 15) resolves it: an ejectable disk,
# the image in /.background/, the volume's real creation date and the file's real CNIDs.
import os, sys, shutil
from ds_store import DSStore
from mac_alias import Alias
vol = sys.argv[1]
ds = os.path.join(vol, ".DS_Store")
with DSStore.open(ds, "r+") as d:
    icvp = d["."]["icvp"]
    old = Alias.from_bytes(icvp["backgroundImageAlias"])
    src = os.path.join(vol, old.target.posix_path.lstrip("/"))
    os.makedirs(os.path.join(vol, ".background"), exist_ok=True)
    dst = os.path.join(vol, ".background", "background" + os.path.splitext(src)[1])
    if src != dst:
        shutil.move(src, dst)
    a = Alias.for_file(dst)
    a.volume.disk_type = 5            # ejectable
    a.volume.attribute_flags = 3330   # what Finder writes for a mounted disk image
    icvp["backgroundImageAlias"] = a.to_bytes()
    d["."]["icvp"] = icvp
print("alias ->", a.target.posix_path, a.target.folder_cnid, a.target.cnid, a.volume.creation_date)
