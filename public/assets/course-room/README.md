Place the custom course room GLBs here:

- `room-first.glb`
- `room-middle.glb`
- `room-last.glb`

This file is used only by the course 3D world.

Current loader path:

- `public/assets/course-room/room-first.glb`
- `public/assets/course-room/room-middle.glb`
- `public/assets/course-room/room-last.glb`

Optional fallback:

- `public/assets/course-room/room-shell.glb`

Notes for the artist:

- Keep the totem out of this file for now. The platform beacon still renders separately.
- The model should represent only the room shell: floor, walls, doorway styling, trims, props fixed to the room.
- If the files contain helper meshes named with `navmesh` or `collision`, they will be hidden by the current visual-only integration.

If one of the role-specific files is missing, the app falls back to another available room shell automatically.
If no room shell files are available, the app falls back to the procedural room shell automatically.
