# Maps Folder

Place your map GLB files here. Each map is a folder containing a GLB file.

## Expected Structure

```
maps/
  mapa_cidade/
    mapa_cidade.glb      ← main map model
    mapa_cidade.png      ← optional thumbnail/icon
  mapa_floresta/
    mapa_floresta.glb
    mapa_floresta.png
```

## GLB Naming Conventions

Inside each GLB (in Blender), name your objects with these prefixes so the game can handle them correctly:

| Prefix      | Behavior                                              |
|-------------|-------------------------------------------------------|
| `wall_*`    | Rendered wall — becomes transparent when blocking camera |
| `collision_*` | Invisible collision mesh (for precise physics)      |
| `floor_*`   | Floor geometry — used by surface detection           |
| (no prefix) | Static decoration — rendered, no special behavior    |

## Loading

Currently the folder is ready for map files. Map selection logic (multiple servers per map) is planned for a future version.

To load a map manually, use the future `placeMap` system or drop the GLB as a structure via the context menu.
