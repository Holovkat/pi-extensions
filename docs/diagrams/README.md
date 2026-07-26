# README Diagrams

The root README references pre-rendered PNGs so GitHub clients that do not invoke Mermaid still display the diagrams. Each PNG is generated from the same-named `.mmd` source file.

Regenerate the assets from the repository root with:

```bash
for source_file in docs/diagrams/*.mmd; do
  output_file="${source_file%.mmd}.png"
  npx --yes @mermaid-js/mermaid-cli@11.16.0 \
    --quiet \
    --theme default \
    --width 1600 \
    --height 1200 \
    --scale 2 \
    --backgroundColor white \
    --input "$source_file" \
    --output "$output_file"
done
```
