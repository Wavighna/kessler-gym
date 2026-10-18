# Optional project extras

These files are separate from the working HTML/JavaScript demo. They provide
small, usable examples rather than additional application services.

- `analyze_weights.py`: Python standard-library policy-parameter inspection.
- `mission-guide.mdx`: a guide for a separate MDX-enabled documentation host.
- `preview.sh`: a Bash helper for serving the existing demo locally.
- `Dockerfile`: a container example for serving the static demo.
- The root `mission-dashboard.prototype.tsx` remains a separate React,
  TypeScript and Tailwind interface prototype; it is not connected to the demo.

## Inspect the existing weights

```sh
python extras/analyze_weights.py
python extras/analyze_weights.py --output extras/artifacts/weights-summary.json
```

## Preview locally

```sh
bash extras/preview.sh 8000
```

## Preview in Docker

```sh
docker build -f extras/Dockerfile -t kessler-preview .
docker run --rm -p 127.0.0.1:8080:8080 kessler-preview
```

## Tracking and ignored files

The `extras/` directory is listed in `.gitignore`. The selected source files in
this folder were explicitly committed, so they remain tracked. New scratch
files, Python caches and generated reports added here are ignored by default.
No changes to the live site's build configuration are required.
