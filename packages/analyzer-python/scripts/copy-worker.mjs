import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../dist/python/", import.meta.url), { recursive: true });
await copyFile(new URL("../python/analyze.py", import.meta.url), new URL("../dist/python/analyze.py", import.meta.url));

